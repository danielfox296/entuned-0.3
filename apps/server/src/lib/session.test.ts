import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'

// TST-1 (session half): exercise the REAL cookie-session crypto. Route tests
// mock lib/session.js, so verifySessionToken / setSessionCookie / requireAuth
// have never run under test. This file imports the real module.
//
// getJwtSecret() reads process.env.JWT_SECRET at CALL time (not module load), so
// setting it in vi.hoisted keeps every path — including the sign inside
// setSessionCookie — using a stable known key.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-session-jwt-secret-32bytes-min'
})

// session.ts imports prisma from '../db.js' at module scope (db.ts news up a
// PrismaClient on import). Mock it so the import doesn't require DATABASE_URL —
// attachSession is internal/unexported so none of these tests touch Prisma.
vi.mock('../db.js', () => ({
  prisma: { account: { findUnique: vi.fn() } },
}))

import jwt from 'jsonwebtoken'
import { setSessionCookie, clearSessionCookie, verifySessionToken, requireAuth } from './session.js'

const JWT_SECRET = 'test-session-jwt-secret-32bytes-min'

// Minimal FastifyReply stand-in capturing setCookie / clearCookie / code / send.
function makeReply() {
  return {
    statusCode: 0 as number,
    body: undefined as unknown,
    cookies: [] as Array<{ name: string; value: string; opts: Record<string, unknown> }>,
    cleared: [] as Array<{ name: string; opts: Record<string, unknown> }>,
    setCookie(name: string, value: string, opts: Record<string, unknown>) {
      this.cookies.push({ name, value, opts })
      return this
    },
    clearCookie(name: string, opts: Record<string, unknown>) {
      this.cleared.push({ name, opts })
      return this
    },
    code(c: number) {
      this.statusCode = c
      return this
    },
    send(b: unknown) {
      this.body = b
      return this
    },
  }
}

let savedNodeEnv: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedNodeEnv = process.env.NODE_ENV
})
afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedNodeEnv
})

// ── setSessionCookie → verifySessionToken round-trip ────────────────────────
describe('setSessionCookie / verifySessionToken', () => {
  it('signs a cookie whose token decodes back to the same accountId + tv', () => {
    const reply = makeReply()
    const token = setSessionCookie(reply as unknown as FastifyReply, 'acct-1', 4)

    // The token was written to the entuned_session cookie.
    expect(reply.cookies).toHaveLength(1)
    expect(reply.cookies[0].name).toBe('entuned_session')
    expect(reply.cookies[0].value).toBe(token)

    const payload = verifySessionToken(token)
    expect(payload).toEqual({ accountId: 'acct-1', tv: 4 })
  })

  it('sets httpOnly + sameSite=lax + 30-day maxAge cookie options', () => {
    const reply = makeReply()
    setSessionCookie(reply as unknown as FastifyReply, 'acct-1', 0)
    const opts = reply.cookies[0].opts
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
    expect(opts.path).toBe('/')
    expect(opts.maxAge).toBe(30 * 24 * 60 * 60)
  })

  it('marks the cookie secure only in production', () => {
    process.env.NODE_ENV = 'production'
    const prodReply = makeReply()
    setSessionCookie(prodReply as unknown as FastifyReply, 'acct-1', 0)
    expect(prodReply.cookies[0].opts.secure).toBe(true)

    process.env.NODE_ENV = 'development'
    const devReply = makeReply()
    setSessionCookie(devReply as unknown as FastifyReply, 'acct-1', 0)
    expect(devReply.cookies[0].opts.secure).toBe(false)
  })

  it('defaults tv to 0 when the token payload omits it', () => {
    // A legacy token without `tv` — verify normalizes the missing field to 0.
    const legacy = jwt.sign({ accountId: 'acct-legacy' }, JWT_SECRET, { expiresIn: 3600 })
    expect(verifySessionToken(legacy)).toEqual({ accountId: 'acct-legacy', tv: 0 })
  })

  it('rejects an expired token', () => {
    const expired = jwt.sign({ accountId: 'acct-1', tv: 0 }, JWT_SECRET, { expiresIn: '-1s' })
    expect(verifySessionToken(expired)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const foreign = jwt.sign({ accountId: 'acct-1', tv: 0 }, 'a-different-jwt-secret-000000000', { expiresIn: 3600 })
    expect(verifySessionToken(foreign)).toBeNull()
  })

  it('rejects a tampered token', () => {
    const token = jwt.sign({ accountId: 'acct-1', tv: 0 }, JWT_SECRET, { expiresIn: 3600 })
    const parts = token.split('.')
    const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}` // corrupt the payload segment
    expect(verifySessionToken(tampered)).toBeNull()
  })

  it('rejects a well-signed token that carries no accountId', () => {
    const noAccount = jwt.sign({ foo: 'bar' }, JWT_SECRET, { expiresIn: 3600 })
    expect(verifySessionToken(noAccount)).toBeNull()
  })

  it('rejects garbage input', () => {
    expect(verifySessionToken('')).toBeNull()
    expect(verifySessionToken('not-a-jwt')).toBeNull()
  })

  it('rejects an unsigned alg:none token (algorithms pinned to HS256)', () => {
    // Forge a token with the "none" algorithm and an empty signature. verify()
    // pins algorithms:['HS256'], so this must be rejected rather than accepted
    // as an unsigned payload.
    const none = jwt.sign({ accountId: 'acct-attacker', tv: 0 }, '', {
      algorithm: 'none',
      expiresIn: 3600,
    })
    expect(verifySessionToken(none)).toBeNull()
  })
})

// ── clearSessionCookie ──────────────────────────────────────────────────────
describe('clearSessionCookie', () => {
  it('clears the entuned_session cookie at path /', () => {
    const reply = makeReply()
    clearSessionCookie(reply as unknown as FastifyReply)
    expect(reply.cleared).toHaveLength(1)
    expect(reply.cleared[0].name).toBe('entuned_session')
    expect(reply.cleared[0].opts.path).toBe('/')
  })
})

// ── requireAuth preHandler ──────────────────────────────────────────────────
describe('requireAuth', () => {
  it('401s when there is no authenticated user on the request', async () => {
    const reply = makeReply()
    await requireAuth({} as FastifyRequest, reply as unknown as FastifyReply)
    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'unauthorized' })
  })

  it('passes through (sends nothing) when request.user is present', async () => {
    const reply = makeReply()
    const req = { user: { id: 'acct-1', email: 'u@x.com', name: null } } as unknown as FastifyRequest
    await requireAuth(req, reply as unknown as FastifyReply)
    expect(reply.statusCode).toBe(0)
    expect(reply.body).toBeUndefined()
  })
})
