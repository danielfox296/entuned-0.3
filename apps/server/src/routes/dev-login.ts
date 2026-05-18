// Dev-only login bypass.
//
// Lets Claude Code (and other verification tooling) acquire an authenticated
// session against any non-production environment without going through magic
// links or operator passwords. Two modes:
//
//   - mode='cookie'  → sets the `entuned_session` cookie (customer dashboard).
//   - mode='bearer'  → returns a Bearer token (operator / Dash / Player).
//
// Gating: the route is disabled entirely when `DEV_LOGIN_TOKEN` is unset
// (responds 404 as if the route doesn't exist). Production Railway must
// never have this env var set. A constant-time compare guards the secret;
// the account must already exist (no create-if-missing — a leaked token
// shouldn't be able to seed new accounts).
//
// Usage from preview_eval / curl:
//   curl -X POST -c jar https://api.dev.entuned.co/dev-login \
//        -H 'content-type: application/json' \
//        -d '{"token":"$DEV_LOGIN_TOKEN","email":"dev@entuned.co","mode":"cookie"}'

import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../db.js'
import { signAccountToken } from '../lib/auth.js'
import { setSessionCookie } from '../lib/session.js'

const bodySchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  mode: z.enum(['cookie', 'bearer']).default('cookie'),
})

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const devLoginRoutes: FastifyPluginAsync = async (app) => {
  app.post('/dev-login', async (request, reply) => {
    const expected = process.env.DEV_LOGIN_TOKEN
    if (!expected || expected.length < 16) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() })
    }
    const { token, email, mode } = parsed.data

    if (!tokenMatches(token, expected)) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const acc = await prisma.account.findUnique({ where: { email: email.trim().toLowerCase() } })
    if (!acc || acc.disabledAt) {
      return reply.code(404).send({ error: 'account_not_found' })
    }

    if (mode === 'bearer') {
      const { token: bearer } = signAccountToken(acc)
      return reply.send({
        mode: 'bearer',
        token: bearer,
        account: { id: acc.id, email: acc.email, isAdmin: acc.isAdmin },
      })
    }

    setSessionCookie(reply, acc.id, acc.tokenVersion)
    return reply.send({
      mode: 'cookie',
      account: { id: acc.id, email: acc.email, isAdmin: acc.isAdmin },
    })
  })
}
