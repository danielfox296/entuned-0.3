// Customer dashboard auth routes (User + Account model).
// Distinct from `routes/auth.ts`, which serves Operator (in-store player) login.
//
// Mounted under `/login` in `index.ts` so the routes resolve as
//   POST /login/magic-link, GET /login/verify, GET /login/google,
//   GET  /login/google/callback, POST /login/logout, GET /login/me
// (Operator routes still own `/auth/*`.)

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { prisma } from '../db.js'
import { sendMagicLink } from '../lib/email.js'
import { clearSessionCookie, requireAuth, setSessionCookie } from '../lib/session.js'
import { ensureFreeClientForUser } from '../lib/account.js'

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAGIC_LINK_TOKEN_BYTES = 32

const MagicLinkBody = z.object({ email: z.string().email() })

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function appUrl(): string {
  const v = process.env.APP_URL
  if (!v) throw new Error('APP_URL is not set')
  return v.replace(/\/$/, '')
}

function magicLinkBaseUrl(): string {
  const v = process.env.MAGIC_LINK_BASE_URL
  if (!v) throw new Error('MAGIC_LINK_BASE_URL is not set')
  return v
}

function googleClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env vars missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI).')
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri })
}

// --- PKCE helpers ---
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// Short-lived cookies used during the OAuth handshake.
const OAUTH_STATE_COOKIE = 'entuned_oauth_state'
const OAUTH_PKCE_COOKIE = 'entuned_oauth_pkce'

const oauthHandshakeCookieOpts = (): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: string
  domain?: string
  maxAge: number
} => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  maxAge: 10 * 60, // 10 min
})

interface GoogleUserinfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
}

async function findOrCreateUserByEmail(email: string, name?: string | null): Promise<{ id: string; email: string; name: string | null }> {
  const normalized = email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email: normalized } })
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } })
    : await prisma.user.create({
        data: { email: normalized, name: name ?? null, lastLoginAt: new Date() },
      })
  // Free-tier provisioning: every signed-in user gets a Client + Store
  // (idempotent — backfills users that pre-date this change). Also handles
  // the operator-link hook: matches existing Client.contact_email and
  // attaches membership instead of creating a duplicate Client.
  await ensureFreeClientForUser(user.id, normalized)
  return { id: user.id, email: user.email, name: user.name }
}

// Google OAuth handlers — defined but NOT registered in v1.
// TODO(google-oauth): re-enable when OAuth credentials are configured.
async function googleStartHandler(_req: FastifyRequest, reply: FastifyReply) {
  const client = googleClient()
  const state = base64url(randomBytes(16))
  const { verifier, challenge } = generatePkce()
  reply.setCookie(OAUTH_STATE_COOKIE, state, oauthHandshakeCookieOpts())
  reply.setCookie(OAUTH_PKCE_COOKIE, verifier, oauthHandshakeCookieOpts())
  const url = client.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: challenge,
    code_challenge_method: CodeChallengeMethod.S256,
    access_type: 'online',
    prompt: 'select_account',
  })
  return reply.redirect(url, 302)
}

async function googleCallbackHandler(req: FastifyRequest, reply: FastifyReply) {
  const q = (req.query as { code?: string; state?: string; error?: string } | undefined) ?? {}
  if (q.error) return reply.code(400).send({ error: 'google_oauth_error', detail: q.error })
  if (!q.code || !q.state) return reply.code(400).send({ error: 'missing_code_or_state' })

  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {}
  const expectedState = cookies[OAUTH_STATE_COOKIE]
  const codeVerifier = cookies[OAUTH_PKCE_COOKIE]
  if (!expectedState || !codeVerifier) return reply.code(400).send({ error: 'oauth_session_lost' })
  if (q.state !== expectedState) return reply.code(400).send({ error: 'state_mismatch' })

  // Clear handshake cookies regardless of outcome from here on.
  reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' })
  reply.clearCookie(OAUTH_PKCE_COOKIE, { path: '/' })

  const client = googleClient()
  let userinfo: GoogleUserinfo
  try {
    const { tokens } = await client.getToken({
      code: q.code,
      codeVerifier,
    })
    if (!tokens.id_token) return reply.code(400).send({ error: 'no_id_token' })
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID!,
    })
    const payload = ticket.getPayload()
    if (!payload || !payload.sub) return reply.code(400).send({ error: 'bad_id_token' })
    userinfo = {
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified,
      name: payload.name,
    }
  } catch (err) {
    req.log.error({ err }, 'google oauth code exchange failed')
    return reply.code(400).send({ error: 'oauth_exchange_failed' })
  }

  if (!userinfo.email || !userinfo.email_verified) {
    return reply.code(400).send({ error: 'email_not_verified' })
  }

  const normalizedEmail = userinfo.email.trim().toLowerCase()

  // 1) Match by googleSub.
  let user = await prisma.user.findUnique({ where: { googleSub: userinfo.sub } })

  // 2) Else match by email; if found and no googleSub yet, attach it.
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleSub: byEmail.googleSub ?? userinfo.sub,
          name: byEmail.name ?? userinfo.name ?? null,
          lastLoginAt: new Date(),
        },
      })
    }
  }

  // 3) Else create a brand-new User.
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: userinfo.name ?? null,
        googleSub: userinfo.sub,
        lastLoginAt: new Date(),
      },
    })
  } else {
    // Existing user logging in — bump lastLoginAt.
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  }

  setSessionCookie(reply, user.id)
  return reply.redirect(`${appUrl()}/`, 302)
}

export const loginRoutes: FastifyPluginAsync = async (app) => {
  // ----- POST /magic-link -----
  app.post(
    '/magic-link',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '15 minutes' },
      },
    },
    async (req, reply) => {
      const parsed = MagicLinkBody.safeParse(req.body)
      // Always return 200 — never leak whether an email exists or whether the body was valid.
      if (!parsed.success) return reply.code(200).send({ ok: true })
      const email = parsed.data.email.trim().toLowerCase()

      try {
        const tokenRaw = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('hex')
        const tokenHash = sha256Hex(tokenRaw)
        const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS)

        await prisma.magicLinkToken.create({
          data: { email, tokenHash, expiresAt },
        })

        const link = `${magicLinkBaseUrl()}?token=${encodeURIComponent(tokenRaw)}`
        await sendMagicLink(email, link)
      } catch (err) {
        req.log.error({ err }, 'magic-link send failed')
        // Still return 200 to avoid leaking existence / failure mode.
      }

      return reply.code(200).send({ ok: true })
    },
  )

  // ----- GET /verify?token=... -----
  app.get('/verify', async (req, reply) => {
    const token = (req.query as { token?: string } | undefined)?.token
    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'missing_token' })
    }
    const tokenHash = sha256Hex(token)
    const row = await prisma.magicLinkToken.findUnique({ where: { tokenHash } })
    if (!row) return reply.code(400).send({ error: 'invalid_token' })
    if (row.consumedAt) return reply.code(400).send({ error: 'token_already_used' })
    if (row.expiresAt.getTime() < Date.now()) return reply.code(400).send({ error: 'token_expired' })

    await prisma.magicLinkToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
    const user = await findOrCreateUserByEmail(row.email)
    setSessionCookie(reply, user.id)
    return reply.redirect(`${appUrl()}/`, 302)
  })

  app.get('/google', googleStartHandler)
  app.get('/google/callback', googleCallbackHandler)

  // ----- POST /logout -----
  app.post('/logout', async (_req, reply) => {
    clearSessionCookie(reply)
    return reply.code(204).send()
  })

  // ----- GET /me -----
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    return {
      user: req.user,
      account: req.account ?? null,
      role: req.role ?? null,
    }
  })
}
