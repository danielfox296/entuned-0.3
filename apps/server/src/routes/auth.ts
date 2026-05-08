import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { login, signOperatorToken, verify } from '../lib/auth.js'
import { prisma } from '../db.js'
import { sendOperatorPasswordReset } from '../lib/email.js'

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

    return {
      token: result.token,
      operator: {
        id: result.operator.operatorId,
        email: result.operator.email,
        isAdmin: result.operator.isAdmin,
      },
    }
  })

  // GET /auth/me — verify a token and return operator + their store assignments.
  app.get('/me', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' })
    const payload = verify(auth.slice(7))
    if (!payload) return reply.code(401).send({ error: 'invalid_token' })

    const op = await prisma.operator.findUnique({
      where: { id: payload.operatorId },
      include: payload.isAdmin ? undefined : {
        storeAssignments: { include: { store: { include: { client: { select: { companyName: true } } } } } },
      },
    })
    if (!op || op.disabledAt) return reply.code(401).send({ error: 'operator_disabled' })
    if (op.tokenVersion !== payload.tv) return reply.code(401).send({ error: 'token_revoked' })

    type StoreOut = { id: string; name: string; clientName: string | null }
    let stores: StoreOut[]
    if (op.isAdmin) {
      const rows = await prisma.store.findMany({
        select: { id: true, name: true, client: { select: { companyName: true } } },
      })
      stores = rows.map((s) => ({ id: s.id, name: s.name, clientName: s.client?.companyName ?? null }))
    } else {
      stores = (op as any).storeAssignments.map((a: any) => ({
        id: a.store.id,
        name: a.store.name,
        clientName: a.store.client?.companyName ?? null,
      }))
    }
    const store = !op.isAdmin && stores.length > 0 ? stores[0] : null
    return {
      operator: { id: op.id, email: op.email, displayName: op.displayName, isAdmin: op.isAdmin },
      store,
      stores,
    }
  })

  // ── Password recovery ──────────────────────────────────────────────────
  //
  // Three endpoints:
  //   POST /auth/forgot-password   — anyone can request; rate-limited; always 200.
  //   POST /auth/reset-password    — consume token + set new password.
  //   POST /auth/change-password   — authed; verify current; set new password.
  //
  // All three bump Operator.tokenVersion on success so any existing bearer JWTs
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
    // Always return 200 — never leak whether an operator exists.
    if (!parsed.success) return reply.code(200).send({ ok: true })
    const email = parsed.data.email.trim().toLowerCase()

    try {
      const op = await prisma.operator.findUnique({ where: { email } })
      // Only mint + send for active operators. Disabled operators silently no-op.
      if (op && !op.disabledAt) {
        const tokenRaw = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('hex')
        const tokenHash = sha256Hex(tokenRaw)
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS)

        await prisma.operatorPasswordResetToken.create({
          data: { operatorId: op.id, tokenHash, expiresAt },
        })

        // Reset target lives on the Dash SPA — token is in the hash so it never
        // hits the API server's access logs.
        const link = `${dashUrl()}/#reset-password?token=${encodeURIComponent(tokenRaw)}`
        await sendOperatorPasswordReset(op.email, link)
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
    const row = await prisma.operatorPasswordResetToken.findUnique({ where: { tokenHash } })
    if (!row) return reply.code(400).send({ error: 'invalid_token' })
    if (row.consumedAt) return reply.code(400).send({ error: 'token_already_used' })
    if (row.expiresAt.getTime() < Date.now()) return reply.code(400).send({ error: 'token_expired' })

    const op = await prisma.operator.findUnique({ where: { id: row.operatorId } })
    if (!op || op.disabledAt) return reply.code(400).send({ error: 'operator_unavailable' })

    const newHash = await bcrypt.hash(parsed.data.newPassword, 10)
    await prisma.$transaction([
      prisma.operatorPasswordResetToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
      prisma.operator.update({
        where: { id: op.id },
        data: {
          passwordHash: newHash,
          passwordSetAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      // Burn any other outstanding reset tokens for this operator.
      prisma.operatorPasswordResetToken.updateMany({
        where: {
          operatorId: op.id,
          consumedAt: null,
          NOT: { id: row.id },
        },
        data: { consumedAt: new Date() },
      }),
    ])

    // Auto-login: mint a fresh token at the new tokenVersion so the SPA can
    // drop the user straight into Dash without re-prompting.
    const refreshed = await prisma.operator.findUnique({ where: { id: op.id } })
    if (!refreshed) return reply.code(500).send({ error: 'internal' })
    const { token } = signOperatorToken(refreshed)

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

    const op = await prisma.operator.findUnique({ where: { id: payload.operatorId } })
    if (!op || op.disabledAt) return reply.code(401).send({ error: 'operator_disabled' })
    if (op.tokenVersion !== payload.tv) return reply.code(401).send({ error: 'token_revoked' })

    const ok = await bcrypt.compare(parsed.data.currentPassword, op.passwordHash)
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' })

    const newHash = await bcrypt.hash(parsed.data.newPassword, 10)
    const updated = await prisma.operator.update({
      where: { id: op.id },
      data: {
        passwordHash: newHash,
        passwordSetAt: new Date(),
        tokenVersion: { increment: 1 },
      },
    })

    // Mint a fresh token at the new version so this caller stays signed in.
    const { token } = signOperatorToken(updated)
    return {
      ok: true,
      token,
      operator: { id: updated.id, email: updated.email, isAdmin: updated.isAdmin },
    }
  })
}
