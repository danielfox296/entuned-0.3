import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'

// TST-1: exercise the REAL auth implementation, not the mock. Every other test
// file `vi.mock('./auth.js')` or `vi.mock('../lib/auth.js')` — so the crypto in
// sign/verify, the bcrypt path in login(), the token-version revocation check in
// requireAdmin, and the per-store authz boundary in isAccountAuthorizedForStore
// have never actually run under test. This file imports the real module and
// mocks ONLY the Prisma account/storeAssignment lookups.
//
// AUTH_SECRET is captured once at module-load time (`const SECRET = ...` in
// auth.ts). ESM imports are hoisted above plain top-level statements, so the env
// mutation must run inside vi.hoisted() to land before auth.ts initializes.
// See TESTING.md "ESM hoisting and process.env".
vi.hoisted(() => {
  process.env.AUTH_SECRET = 'test-secret-deterministic-hmac-key-000'
})

vi.mock('../db.js', () => ({
  prisma: {
    account: { findUnique: vi.fn() },
    storeAssignment: { findUnique: vi.fn() },
  },
}))

import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import {
  verify,
  signAccountToken,
  login,
  isAccountAuthorizedForStore,
  requireAdmin,
} from './auth.js'
import { prisma } from '../db.js'

const accountFindUnique = prisma.account.findUnique as unknown as ReturnType<typeof vi.fn>
const storeAssignmentFindUnique = prisma.storeAssignment.findUnique as unknown as ReturnType<typeof vi.fn>

// Minimal FastifyReply stand-in that records the status + body requireAdmin sends.
function makeReply() {
  const reply = {
    statusCode: 0 as number,
    body: undefined as unknown,
    code(c: number) {
      this.statusCode = c
      return this
    },
    send(b: unknown) {
      this.body = b
      return this
    },
  }
  return reply
}

function makeReq(authHeader?: string): FastifyRequest {
  return { headers: authHeader ? { authorization: authHeader } : {} } as unknown as FastifyRequest
}

beforeEach(() => vi.clearAllMocks())

// ── sign → verify round-trip + tamper/expiry rejection ──────────────────────
describe('signAccountToken / verify', () => {
  const acc = { id: 'acct-1', email: 'op@example.com', isAdmin: true, tokenVersion: 3 }

  it('round-trips: a freshly signed token verifies back to the same payload', () => {
    const { token, payload } = signAccountToken(acc)
    const decoded = verify(token)
    expect(decoded).not.toBeNull()
    expect(decoded).toEqual(payload)
    expect(decoded?.accountId).toBe('acct-1')
    expect(decoded?.email).toBe('op@example.com')
    expect(decoded?.isAdmin).toBe(true)
    expect(decoded?.tv).toBe(3)
  })

  it('rejects an expired token (exp in the past)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const { token } = signAccountToken(acc) // exp = now + 7 days
      // Advance 8 days — past the 7-day TTL baked into the token.
      vi.setSystemTime(new Date('2026-01-09T00:00:00Z'))
      expect(verify(token)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a token whose body was tampered with (signature no longer matches)', () => {
    const { token } = signAccountToken(acc)
    const [body, sig] = token.split('.')
    // Forge a payload but keep the original signature — the HMAC check must fail.
    const forged = Buffer.from(
      JSON.stringify({ accountId: 'attacker', email: 'evil@x.com', isAdmin: true, tv: 0, exp: Date.now() + 1_000_000 }),
    ).toString('base64url')
    expect(verify(`${forged}.${sig}`)).toBeNull()
    // A one-char flip in the signature is also rejected.
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    expect(verify(`${body}.${flipped}`)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    // Simulate a foreign secret by HMAC-signing the same body ourselves with the
    // wrong key. verify() must reject it because its own SECRET differs.
    const body = Buffer.from(
      JSON.stringify({ accountId: 'acct-1', email: 'op@example.com', isAdmin: true, tv: 0, exp: Date.now() + 1_000_000 }),
    ).toString('base64url')
    const wrongSig = createHmac('sha256', 'a-totally-different-secret').update(body).digest('base64url')
    expect(verify(`${body}.${wrongSig}`)).toBeNull()
  })

  it('rejects malformed tokens (missing dot / empty)', () => {
    expect(verify('')).toBeNull()
    expect(verify('nodothere')).toBeNull()
    expect(verify('only.')).toBeNull()
  })
})

// ── login (real bcrypt path) ────────────────────────────────────────────────
describe('login', () => {
  it('returns a token + payload for a correct password', async () => {
    const passwordHash = await bcrypt.hash('hunter2', 10)
    accountFindUnique.mockResolvedValue({
      id: 'acct-1',
      email: 'op@example.com',
      isAdmin: false,
      tokenVersion: 0,
      disabledAt: null,
      passwordHash,
    })

    const res = await login('  OP@Example.com ', 'hunter2') // also proves normalization
    expect(res).not.toBeNull()
    expect(accountFindUnique).toHaveBeenCalledWith({ where: { email: 'op@example.com' } })
    expect(verify(res!.token)).not.toBeNull()
    expect(res!.account.accountId).toBe('acct-1')
  })

  it('returns null for a wrong password', async () => {
    const passwordHash = await bcrypt.hash('hunter2', 10)
    accountFindUnique.mockResolvedValue({
      id: 'acct-1', email: 'op@example.com', isAdmin: false, tokenVersion: 0, disabledAt: null, passwordHash,
    })
    expect(await login('op@example.com', 'wrong')).toBeNull()
  })

  it('returns null when the account has no passwordHash (magic-link / Google only)', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'acct-1', email: 'op@example.com', isAdmin: false, tokenVersion: 0, disabledAt: null, passwordHash: null,
    })
    expect(await login('op@example.com', 'anything')).toBeNull()
  })

  it('returns null for a disabled account even with the right password', async () => {
    const passwordHash = await bcrypt.hash('hunter2', 10)
    accountFindUnique.mockResolvedValue({
      id: 'acct-1', email: 'op@example.com', isAdmin: false, tokenVersion: 0, disabledAt: new Date(), passwordHash,
    })
    expect(await login('op@example.com', 'hunter2')).toBeNull()
  })

  it('returns null when the account does not exist', async () => {
    accountFindUnique.mockResolvedValue(null)
    expect(await login('ghost@example.com', 'whatever')).toBeNull()
  })
})

// ── isAccountAuthorizedForStore (the per-store authz boundary) ───────────────
describe('isAccountAuthorizedForStore', () => {
  it('allows an admin account without consulting store assignments', async () => {
    accountFindUnique.mockResolvedValue({ id: 'acct-admin', disabledAt: null, isAdmin: true })
    expect(await isAccountAuthorizedForStore('acct-admin', 'store-1')).toBe(true)
    expect(storeAssignmentFindUnique).not.toHaveBeenCalled()
  })

  it('allows a non-admin account that has an assignment to the store', async () => {
    accountFindUnique.mockResolvedValue({ id: 'acct-1', disabledAt: null, isAdmin: false })
    storeAssignmentFindUnique.mockResolvedValue({ accountId: 'acct-1', storeId: 'store-1' })
    expect(await isAccountAuthorizedForStore('acct-1', 'store-1')).toBe(true)
    expect(storeAssignmentFindUnique).toHaveBeenCalledWith({
      where: { accountId_storeId: { accountId: 'acct-1', storeId: 'store-1' } },
    })
  })

  it('denies a non-admin account with no assignment to a foreign/cross store', async () => {
    accountFindUnique.mockResolvedValue({ id: 'acct-1', disabledAt: null, isAdmin: false })
    storeAssignmentFindUnique.mockResolvedValue(null)
    expect(await isAccountAuthorizedForStore('acct-1', 'someone-elses-store')).toBe(false)
  })

  it('denies a disabled account even if an assignment row exists', async () => {
    accountFindUnique.mockResolvedValue({ id: 'acct-1', disabledAt: new Date(), isAdmin: false })
    expect(await isAccountAuthorizedForStore('acct-1', 'store-1')).toBe(false)
    // Short-circuits on disabledAt — never reaches the assignment lookup.
    expect(storeAssignmentFindUnique).not.toHaveBeenCalled()
  })

  it('denies when the account does not exist', async () => {
    accountFindUnique.mockResolvedValue(null)
    expect(await isAccountAuthorizedForStore('ghost', 'store-1')).toBe(false)
  })
})

// ── requireAdmin (token-version revocation + admin guard) ────────────────────
describe('requireAdmin', () => {
  it('returns the operator for a valid admin token whose tv matches the account', async () => {
    const { token } = signAccountToken({ id: 'acct-admin', email: 'admin@x.com', isAdmin: true, tokenVersion: 5 })
    accountFindUnique.mockResolvedValue({ id: 'acct-admin', email: 'admin@x.com', isAdmin: true, disabledAt: null, tokenVersion: 5 })
    const reply = makeReply()
    const op = await requireAdmin(makeReq(`Bearer ${token}`), reply as unknown as FastifyReply)
    expect(op).toEqual({ accountId: 'acct-admin', email: 'admin@x.com', isAdmin: true })
    expect(reply.statusCode).toBe(0) // nothing sent
  })

  it('rejects a revoked token (payload tv < account.tokenVersion) with 401 token_revoked', async () => {
    // Token minted at tv=1, but the account has since bumped to tv=2 (password
    // change / admin revoke). This is the revocation path.
    const { token } = signAccountToken({ id: 'acct-admin', email: 'admin@x.com', isAdmin: true, tokenVersion: 1 })
    accountFindUnique.mockResolvedValue({ id: 'acct-admin', email: 'admin@x.com', isAdmin: true, disabledAt: null, tokenVersion: 2 })
    const reply = makeReply()
    const op = await requireAdmin(makeReq(`Bearer ${token}`), reply as unknown as FastifyReply)
    expect(op).toBeNull()
    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'token_revoked' })
  })

  it('rejects a valid non-admin token with 403 admin_required', async () => {
    const { token } = signAccountToken({ id: 'acct-1', email: 'op@x.com', isAdmin: false, tokenVersion: 0 })
    const reply = makeReply()
    const op = await requireAdmin(makeReq(`Bearer ${token}`), reply as unknown as FastifyReply)
    expect(op).toBeNull()
    expect(reply.statusCode).toBe(403)
    expect(reply.body).toEqual({ error: 'admin_required' })
    // Not admin ⇒ short-circuits before the account lookup.
    expect(accountFindUnique).not.toHaveBeenCalled()
  })

  it('rejects a disabled admin account with 403 admin_required', async () => {
    const { token } = signAccountToken({ id: 'acct-admin', email: 'admin@x.com', isAdmin: true, tokenVersion: 0 })
    accountFindUnique.mockResolvedValue({ id: 'acct-admin', email: 'admin@x.com', isAdmin: true, disabledAt: new Date(), tokenVersion: 0 })
    const reply = makeReply()
    const op = await requireAdmin(makeReq(`Bearer ${token}`), reply as unknown as FastifyReply)
    expect(op).toBeNull()
    expect(reply.statusCode).toBe(403)
    expect(reply.body).toEqual({ error: 'admin_required' })
  })

  it('rejects a missing/malformed Bearer header with 401 unauthorized', async () => {
    const reply = makeReply()
    const op = await requireAdmin(makeReq(undefined), reply as unknown as FastifyReply)
    expect(op).toBeNull()
    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'unauthorized' })
  })

  it('rejects a bad-signature token with 401 invalid_token', async () => {
    const reply = makeReply()
    const op = await requireAdmin(makeReq('Bearer not.a.validtoken'), reply as unknown as FastifyReply)
    expect(op).toBeNull()
    expect(reply.statusCode).toBe(401)
    expect(reply.body).toEqual({ error: 'invalid_token' })
  })
})
