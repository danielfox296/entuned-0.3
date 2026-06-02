import type { FastifyPluginAsync } from 'fastify'
import type { AuthResponse, MeResponse, MeStore } from '@entuned/contracts'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { login, signAccountToken, verify } from '../lib/auth.js'
import { prisma } from '../db.js'
import { sendOperatorPasswordReset } from '../lib/email.js'
import { effectiveTier } from '../lib/tier.js'

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 60 minutes
const PASSWORD_RESET_TOKEN_BYTES = 32
const PASSWORD_MIN_LEN = 10

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function dashUrl(): string {
  // Where the SPA lives. Drives the reset-link target. Falls back to the GitHub
  // Pages preview URL during early staging.
  const v = process.env.DASH_URL ?? 'https://dash.entuned.co'
  return v.replace(/\/$/, '')
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) })
const ForgotBody = z.object({ email: z.string().email() })
const ResetBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LEN, `password must be at least ${PASSWORD_MIN_LEN} characters`),
})
const ChangeBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LEN, `password must be at least ${PASSWORD_MIN_LEN} characters`),
})

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
      },
    },
  }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const result = await login(parsed.data.email, parsed.data.password)
    if (!result) return reply.code(401).send({ error: 'invalid_credentials' })

    const body: AuthResponse = {
      token: result.token,
      // External field name kept as `operator` for the admin/Dash SPA's
      // existing reads. Internally this is an Account row.
      operator: {
        id: result.account.accountId,
        email: result.account.email,
        isAdmin: result.account.isAdmin,
      },
    }
    return body
  })

  // GET /auth/me — verify a token and return account + their store assignments.
  app.get('/me', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' })
    const payload = verify(auth.slice(7))
    if (!payload) return reply.code(401).send({ error: 'invalid_token' })

    const acc = await prisma.account.findUnique({
      where: { id: payload.accountId },
      include: payload.isAdmin ? undefined : {
        storeAssignments: { include: { store: { include: { client: { select: { companyName: true } } } } } },
      },
    })
    if (!acc || acc.disabledAt) return reply.code(401).send({ error: 'operator_disabled' })
    if (acc.tokenVersion !== payload.tv) return reply.code(401).send({ error: 'token_revoked' })

    let stores: MeStore[]
    if (acc.isAdmin) {
      const rows = await prisma.store.findMany({
        select: { id: true, name: true, tier: true, compTier: true, compExpiresAt: true, client: { select: { companyName: true } } },
      })
      stores = rows.map((s) => ({ id: s.id, name: s.name, clientName: s.client?.companyName ?? null, tier: effectiveTier(s) }))
    } else {
      stores = (acc as any).storeAssignments.map((a: any) => ({
        id: a.store.id,
        name: a.store.name,
        clientName: a.store.client?.companyName ?? null,
        tier: effectiveTier(a.store),
      }))
    }
    const store = !acc.isAdmin && stores.length > 0 ? stores[0] : null
    const body: MeResponse = {
      // External field name kept as `operator` for SPA back-compat.
      operator: { id: acc.id, email: acc.email, name: acc.name, isAdmin: acc.isAdmin },
      store,
      stores,
    }
    return body
  })

  // ── Password recovery ──────────────────────────────────────────────────
  //
  // Three endpoints:
  //   POST /auth/forgot-password   — anyone can request; rate-limited; always 200.
  //   POST /auth/reset-password    — consume token + set new password.
  //   POST /auth/change-password   — authed; verify current; set new password.
  //
  // All three bump Account.tokenVersion on success so any existing bearer JWTs
  // (this device or others) stop validating.

  app.post('/forgot-password', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
      },
    },
  }, async (req, reply) => {
    const parsed = ForgotBody.safeParse(req.body)
    // Always return 200 — never leak whether an account exists.
    if (!parsed.success) return reply.code(200).send({ ok: true })
    const email = parsed.data.email.trim().toLowerCase()

    try {
      const acc = await prisma.account.findUnique({ where: { email } })
      // Only mint + send for active accounts that have a password (passwordless
      // magic-link / Google-only accounts use the customer-dashboard flow,
      // not this admin reset path).
      if (acc && !acc.disabledAt && acc.passwordHash) {
        const tokenRaw = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('hex')
        const tokenHash = sha256Hex(tokenRaw)
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS)

        await prisma.passwordResetToken.create({
          data: { accountId: acc.id, tokenHash, expiresAt },
        })

        // Reset target lives on the Dash SPA — token is in the hash so it never
        // hits the API server's access logs.
        const link = `${dashUrl()}/#reset-password?token=${encodeURIComponent(tokenRaw)}`
        await sendOperatorPasswordReset(acc.email, link)
      }
    } catch (err) {
      req.log.error({ err }, 'forgot-password send failed')
      // Still return 200 to avoid leaking failure mode.
    }

    return reply.code(200).send({ ok: true })
  })

  app.post('/reset-password', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
      },
    },
  }, async (req, reply) => {
    const parsed = ResetBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const tokenHash = sha256Hex(parsed.data.token)
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
    if (!row) return reply.code(400).send({ error: 'invalid_token' })
    if (row.consumedAt) return reply.code(400).send({ error: 'token_already_used' })
    if (row.expiresAt.getTime() < Date.now()) return reply.code(400).send({ error: 'token_expired' })

    const acc = await prisma.account.findUnique({ where: { id: row.accountId } })
    if (!acc || acc.disabledAt) return reply.code(400).send({ error: 'operator_unavailable' })

    const newHash = await bcrypt.hash(parsed.data.newPassword, 10)
    await prisma.$transaction([
      prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
      prisma.account.update({
        where: { id: acc.id },
        data: {
          passwordHash: newHash,
          passwordSetAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      // Burn any other outstanding reset tokens for this account.
      prisma.passwordResetToken.updateMany({
        where: {
          accountId: acc.id,
          consumedAt: null,
          NOT: { id: row.id },
        },
        data: { consumedAt: new Date() },
      }),
    ])

    // Auto-login: mint a fresh token at the new tokenVersion so the SPA can
    // drop the user straight into Dash without re-prompting.
    const refreshed = await prisma.account.findUnique({ where: { id: acc.id } })
    if (!refreshed) return reply.code(500).send({ error: 'internal' })
    const { token } = signAccountToken(refreshed)

    return {
      ok: true,
      token,
      operator: { id: refreshed.id, email: refreshed.email, isAdmin: refreshed.isAdmin },
    }
  })

  app.post('/change-password', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' })
    const payload = verify(auth.slice(7))
    if (!payload) return reply.code(401).send({ error: 'invalid_token' })

    const parsed = ChangeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }

    const acc = await prisma.account.findUnique({ where: { id: payload.accountId } })
    if (!acc || acc.disabledAt) return reply.code(401).send({ error: 'operator_disabled' })
    if (acc.tokenVersion !== payload.tv) return reply.code(401).send({ error: 'token_revoked' })
    if (!acc.passwordHash) return reply.code(409).send({ error: 'no_password_set' })

    const ok = await bcrypt.compare(parsed.data.currentPassword, acc.passwordHash)
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' })

    const newHash = await bcrypt.hash(parsed.data.newPassword, 10)
    const updated = await prisma.account.update({
      where: { id: acc.id },
      data: {
        passwordHash: newHash,
        passwordSetAt: new Date(),
        tokenVersion: { increment: 1 },
      },
    })

    // Mint a fresh token at the new version so this caller stays signed in.
    const { token } = signAccountToken(updated)
    return {
      ok: true,
      token,
      operator: { id: updated.id, email: updated.email, isAdmin: updated.isAdmin },
    }
  })
}
