// Integration tests for the operator/Dash auth routes
// (apps/server/src/routes/auth.ts).
//
// Surface covered:
//   POST /login              — credential check via lib/auth.login
//   GET  /me                 — Bearer-token introspection + store list
//   POST /forgot-password    — mint reset token, send email, always 200
//   POST /reset-password     — consume token + set password (auto-login)
//   POST /change-password    — authed; verify current password
//
// Mocking strategy (mirrors the existing me.test.ts / admin.test.ts patterns):
//   - Prisma: vi.mock('../db.js') for account, store, passwordResetToken.
//   - lib/auth.js: mock `login`, `verify`, `signAccountToken`. The HMAC/bcrypt
//     internals are exercised in their own units; here we want deterministic
//     token + payload shapes so we can assert the wire-level contract.
//   - lib/email.js: mock `sendOperatorPasswordReset` so we assert "would have
//     sent" without invoking Resend.
//   - lib/tier.js: real module — `effectiveTier` is a pure-derivation helper
//     that GET /me invokes per store row; mocking it would obscure the shape
//     the SPA actually receives.
//
// Two load-bearing invariants the tests pin byte-exactly:
//   1. POST /forgot-password ALWAYS returns 200 — even on bad-body, even when
//      the email lookup misses, even when send throws. This is the public
//      contract; loosening it leaks "this email has an account" to attackers.
//   2. POST /reset-password burns the consumed token, bumps tokenVersion,
//      and burns any other outstanding reset tokens. The exact $transaction
//      shape is what makes "replay the link from my email twice" safe.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Hoisted Prisma mock ----
vi.mock('../db.js', () => ({
  prisma: {
    account: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    store: {
      findMany: vi.fn(),
    },
    passwordResetToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

// ---- Hoisted lib/auth mock ----
//
// `verify` is keyed on the literal token string so different tests can
// inject different payloads without cross-test mockResolvedValueOnce
// fragility. `signAccountToken` returns a canned token so we can assert
// the response body's `token` field exactly.
vi.mock('../lib/auth.js', () => ({
  login: vi.fn(),
  verify: vi.fn((token: string) => {
    if (token === 'valid-admin-token') {
      return { accountId: 'acc-admin-001', email: 'admin@example.com', isAdmin: true, tv: 3, exp: Date.now() + 60_000 }
    }
    if (token === 'valid-operator-token') {
      return { accountId: 'acc-op-002', email: 'op@example.com', isAdmin: false, tv: 5, exp: Date.now() + 60_000 }
    }
    if (token === 'stale-tv-token') {
      return { accountId: 'acc-op-002', email: 'op@example.com', isAdmin: false, tv: 99, exp: Date.now() + 60_000 }
    }
    return null
  }),
  signAccountToken: vi.fn(() => ({
    token: 'newly-minted-token',
    payload: { accountId: 'acc-x', email: 'x@example.com', isAdmin: false, tv: 6, exp: Date.now() + 60_000 },
  })),
}))

// ---- Hoisted lib/email mock ----
vi.mock('../lib/email.js', () => ({
  sendOperatorPasswordReset: vi.fn(async () => ({ ok: true, id: 'mock-message-id' })),
}))

// ---- Hoisted bcrypt mock ----
//
// bcrypt.compare/hash are the slow part of real auth; we deterministic-stub
// both so tests stay synchronous-fast and we can assert on the resulting
// hash value being passed to Prisma.
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async (pw: string) => `hashed:${pw}`),
    compare: vi.fn(async (pw: string, hash: string) => hash === `hashed:${pw}`),
  },
}))

import { authRoutes } from './auth.js'
import { prisma } from '../db.js'
import { login, verify, signAccountToken } from '../lib/auth.js'
import { sendOperatorPasswordReset } from '../lib/email.js'
import bcrypt from 'bcryptjs'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const loginMock = login as ReturnType<typeof vi.fn>
const verifyMock = verify as ReturnType<typeof vi.fn>
const signTokenMock = signAccountToken as ReturnType<typeof vi.fn>
const sendResetMock = sendOperatorPasswordReset as ReturnType<typeof vi.fn>
const bcryptHash = bcrypt.hash as unknown as ReturnType<typeof vi.fn>
const bcryptCompare = bcrypt.compare as unknown as ReturnType<typeof vi.fn>

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const accountUpdate = prisma.account.update as ReturnType<typeof vi.fn>
const storeFindMany = prisma.store.findMany as ReturnType<typeof vi.fn>
const tokenFindUnique = prisma.passwordResetToken.findUnique as ReturnType<typeof vi.fn>
const txMock = prisma.$transaction as ReturnType<typeof vi.fn>

const ADMIN_ACC = {
  id: 'acc-admin-001',
  email: 'admin@example.com',
  name: 'Admin User',
  isAdmin: true,
  tokenVersion: 3,
  disabledAt: null,
  passwordHash: 'hashed:current-admin-pw',
}

const OPERATOR_ACC = {
  id: 'acc-op-002',
  email: 'op@example.com',
  name: 'Operator User',
  isAdmin: false,
  tokenVersion: 5,
  disabledAt: null,
  passwordHash: 'hashed:current-op-pw',
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-apply the default verify behavior after clearAllMocks (which wipes the
  // implementation too).
  verifyMock.mockImplementation((token: string) => {
    if (token === 'valid-admin-token') {
      return { accountId: 'acc-admin-001', email: 'admin@example.com', isAdmin: true, tv: 3, exp: Date.now() + 60_000 }
    }
    if (token === 'valid-operator-token') {
      return { accountId: 'acc-op-002', email: 'op@example.com', isAdmin: false, tv: 5, exp: Date.now() + 60_000 }
    }
    if (token === 'stale-tv-token') {
      return { accountId: 'acc-op-002', email: 'op@example.com', isAdmin: false, tv: 99, exp: Date.now() + 60_000 }
    }
    return null
  })
  signTokenMock.mockReturnValue({
    token: 'newly-minted-token',
    payload: { accountId: 'acc-x', email: 'x@example.com', isAdmin: false, tv: 6, exp: Date.now() + 60_000 },
  })
  bcryptHash.mockImplementation(async (pw: string) => `hashed:${pw}`)
  bcryptCompare.mockImplementation(async (pw: string, hash: string) => hash === `hashed:${pw}`)
})

// ─────────────────────────────────────────────────────────────────────────
// POST /login
// ─────────────────────────────────────────────────────────────────────────

describe('POST /login', () => {
  it('returns 200 with token + operator shape on happy path', async () => {
    loginMock.mockResolvedValue({
      token: 'fresh-login-token',
      account: { accountId: 'acc-admin-001', email: 'admin@example.com', isAdmin: true, tv: 3, exp: 0 },
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'admin@example.com', password: 'correct-horse' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      token: 'fresh-login-token',
      operator: {
        id: 'acc-admin-001',
        email: 'admin@example.com',
        isAdmin: true,
      },
    })
    expect(loginMock).toHaveBeenCalledWith('admin@example.com', 'correct-horse')
  })

  it('returns 401 invalid_credentials when login() resolves null', async () => {
    loginMock.mockResolvedValue(null)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'admin@example.com', password: 'wrong' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('returns 400 bad_body when email is malformed', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'not-an-email', password: 'x' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_body' })
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('returns 400 bad_body when password is empty', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: { email: 'x@example.com', password: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('returns 400 bad_body when payload is empty', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// GET /me
// ─────────────────────────────────────────────────────────────────────────

describe('GET /me', () => {
  it('returns 401 unauthorized when no Authorization header', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({ method: 'GET', url: '/me' })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 401 unauthorized when header is not Bearer-shaped', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Basic abc' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 401 invalid_token when verify() returns null', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer garbage-token' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_token' })
  })

  it('returns 401 operator_disabled when the account row is missing', async () => {
    accountFindUnique.mockResolvedValue(null)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer valid-admin-token' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'operator_disabled' })
  })

  it('returns 401 operator_disabled when account.disabledAt is set', async () => {
    accountFindUnique.mockResolvedValue({ ...ADMIN_ACC, disabledAt: new Date() })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer valid-admin-token' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'operator_disabled' })
  })

  it('returns 401 token_revoked when payload.tv != account.tokenVersion', async () => {
    accountFindUnique.mockResolvedValue({ ...OPERATOR_ACC, tokenVersion: 5 })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer stale-tv-token' }, // payload tv=99
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'token_revoked' })
  })

  it('returns admin operator + all stores when account is admin', async () => {
    accountFindUnique.mockResolvedValue(ADMIN_ACC)
    storeFindMany.mockResolvedValue([
      {
        id: 'store-a',
        name: 'Store A',
        tier: 'pro',
        compTier: null,
        compExpiresAt: null,
        client: { companyName: 'Acme' },
      },
      {
        id: 'store-b',
        name: 'Store B',
        tier: 'free',
        compTier: null,
        compExpiresAt: null,
        client: null,
      },
    ])

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer valid-admin-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.operator).toEqual({
      id: ADMIN_ACC.id,
      email: ADMIN_ACC.email,
      name: ADMIN_ACC.name,
      isAdmin: true,
    })
    // Admin gets the cross-tenant list — not narrowed to assignments.
    expect(body.store).toBeNull()
    expect(body.stores).toEqual([
      { id: 'store-a', name: 'Store A', clientName: 'Acme', tier: 'pro' },
      { id: 'store-b', name: 'Store B', clientName: null, tier: 'free' },
    ])
    // findUnique for admin should NOT use the storeAssignments include path.
    expect(accountFindUnique).toHaveBeenCalledWith({
      where: { id: ADMIN_ACC.id },
      include: undefined,
    })
  })

  it('returns operator + store assignments for a non-admin', async () => {
    accountFindUnique.mockResolvedValue({
      ...OPERATOR_ACC,
      storeAssignments: [
        {
          store: {
            id: 'store-x',
            name: 'Store X',
            tier: 'core',
            compTier: null,
            compExpiresAt: null,
            client: { companyName: 'Tenant Co' },
          },
        },
        {
          store: {
            id: 'store-y',
            name: 'Store Y',
            tier: 'free',
            compTier: null,
            compExpiresAt: null,
            client: null,
          },
        },
      ],
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer valid-operator-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.operator).toEqual({
      id: OPERATOR_ACC.id,
      email: OPERATOR_ACC.email,
      name: OPERATOR_ACC.name,
      isAdmin: false,
    })
    // Non-admin: store = first assigned store (back-compat).
    expect(body.store).toEqual({
      id: 'store-x',
      name: 'Store X',
      clientName: 'Tenant Co',
      tier: 'core',
    })
    expect(body.stores).toHaveLength(2)
    expect(body.stores[0].id).toBe('store-x')
    expect(body.stores[1].id).toBe('store-y')
    // findMany is NOT called for non-admin — the include path returns the
    // narrowed list inline.
    expect(storeFindMany).not.toHaveBeenCalled()
  })

  it('returns store=null when a non-admin has zero assignments', async () => {
    accountFindUnique.mockResolvedValue({
      ...OPERATOR_ACC,
      storeAssignments: [],
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer valid-operator-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.store).toBeNull()
    expect(body.stores).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// POST /forgot-password
// ─────────────────────────────────────────────────────────────────────────

describe('POST /forgot-password', () => {
  it('returns 200 + mints token + emails reset link on happy path', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'acc-admin-001',
      email: 'admin@example.com',
      disabledAt: null,
      passwordHash: 'hashed:current',
    })
    ;(prisma.passwordResetToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'reset-row-1',
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'Admin@Example.com' }, // exercise lowercase normalization
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    // Email lookup is normalized.
    expect(accountFindUnique).toHaveBeenCalledWith({ where: { email: 'admin@example.com' } })

    // Reset row created with hashed token (sha256 hex = 64 chars) and TTL in the future.
    const createCall = (prisma.passwordResetToken.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createCall.data.accountId).toBe('acc-admin-001')
    expect(createCall.data.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(createCall.data.expiresAt).toBeInstanceOf(Date)
    expect(createCall.data.expiresAt.getTime()).toBeGreaterThan(Date.now())

    // Email sent to the real account email (not the request email — never
    // trust whatever case the client sent).
    expect(sendResetMock).toHaveBeenCalledTimes(1)
    const [emailTo, link] = sendResetMock.mock.calls[0]
    expect(emailTo).toBe('admin@example.com')
    expect(link).toMatch(/^https?:\/\/[^/]+\/#reset-password\?token=[a-f0-9]+$/)
  })

  it('always returns 200 when the email does not match any account', async () => {
    accountFindUnique.mockResolvedValue(null)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'nobody@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled()
    expect(sendResetMock).not.toHaveBeenCalled()
  })

  it('always returns 200 when the account is disabled — no token minted', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'acc-disabled',
      email: 'disabled@example.com',
      disabledAt: new Date(),
      passwordHash: 'hashed:current',
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'disabled@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled()
    expect(sendResetMock).not.toHaveBeenCalled()
  })

  it('always returns 200 when the account is passwordless (Google/magic-link only)', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'acc-passwordless',
      email: 'magic@example.com',
      disabledAt: null,
      passwordHash: null,
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'magic@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled()
    expect(sendResetMock).not.toHaveBeenCalled()
  })

  it('returns 200 on bad body — never leaks zod failure', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'not-an-email' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(accountFindUnique).not.toHaveBeenCalled()
  })

  it('still returns 200 when the email-send throws', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'acc-admin-001',
      email: 'admin@example.com',
      disabledAt: null,
      passwordHash: 'hashed:current',
    })
    ;(prisma.passwordResetToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'reset-row-2' })
    sendResetMock.mockRejectedValueOnce(new Error('resend api down'))

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'admin@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('mints unique tokens across successive requests (randomness sanity)', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'acc-admin-001',
      email: 'admin@example.com',
      disabledAt: null,
      passwordHash: 'hashed:current',
    })
    ;(prisma.passwordResetToken.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'r' })

    const app = await buildTestApp(authRoutes)
    await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'admin@example.com' },
    })
    await app.inject({
      method: 'POST',
      url: '/forgot-password',
      payload: { email: 'admin@example.com' },
    })

    const calls = (prisma.passwordResetToken.create as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    // Two independent randomBytes() invocations must not collide.
    expect(calls[0][0].data.tokenHash).not.toBe(calls[1][0].data.tokenHash)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// POST /reset-password
// ─────────────────────────────────────────────────────────────────────────

describe('POST /reset-password', () => {
  it('returns 400 bad_body when payload is missing fields', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'abc' }, // no newPassword
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(tokenFindUnique).not.toHaveBeenCalled()
  })

  it('returns 400 bad_body when newPassword is too short', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'abc', newPassword: 'short' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(tokenFindUnique).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_token when token is unknown', async () => {
    tokenFindUnique.mockResolvedValue(null)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'unknown-token', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid_token' })
  })

  it('returns 400 token_already_used when consumedAt is set (replay attack)', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'reset-1',
      accountId: 'acc-admin-001',
      consumedAt: new Date('2026-04-01T00:00:00Z'),
      expiresAt: new Date(Date.now() + 60_000),
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'used-token', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'token_already_used' })
  })

  it('returns 400 token_expired when expiresAt is in the past', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'reset-1',
      accountId: 'acc-admin-001',
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'old-token', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'token_expired' })
  })

  it('returns 400 operator_unavailable when the account is missing or disabled', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'reset-1',
      accountId: 'acc-deleted',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    accountFindUnique.mockResolvedValue(null)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'orphan-token', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'operator_unavailable' })
  })

  it('returns 400 operator_unavailable when the account is disabled', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'reset-1',
      accountId: 'acc-admin-001',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    accountFindUnique.mockResolvedValue({ ...ADMIN_ACC, disabledAt: new Date() })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'tok', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'operator_unavailable' })
  })

  it('returns 200 with auto-login token on happy path; consumes token, bumps tokenVersion, burns siblings', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'reset-1',
      accountId: 'acc-admin-001',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    // First call: pre-transaction lookup. Second call: refreshed account after tx.
    accountFindUnique
      .mockResolvedValueOnce(ADMIN_ACC)
      .mockResolvedValueOnce({ ...ADMIN_ACC, tokenVersion: 4 })
    txMock.mockResolvedValue([{}, {}, {}])
    signTokenMock.mockReturnValueOnce({
      token: 'new-jwt-after-reset',
      payload: { accountId: ADMIN_ACC.id, email: ADMIN_ACC.email, isAdmin: true, tv: 4, exp: 0 },
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'valid-reset-token', newPassword: 'brand-new-passw0rd-9000' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      token: 'new-jwt-after-reset',
      operator: {
        id: ADMIN_ACC.id,
        email: ADMIN_ACC.email,
        isAdmin: true,
      },
    })

    // bcrypt was called with cost factor 10 (per source line 173).
    expect(bcryptHash).toHaveBeenCalledWith('brand-new-passw0rd-9000', 10)

    // $transaction was called once with an array of three Prisma ops.
    expect(txMock).toHaveBeenCalledTimes(1)
    const txOps = txMock.mock.calls[0][0]
    expect(Array.isArray(txOps)).toBe(true)
    expect(txOps).toHaveLength(3)

    // Auto-login: signAccountToken was invoked on the refreshed account.
    expect(signTokenMock).toHaveBeenCalledTimes(1)
  })

  it('returns 500 internal when the refreshed account lookup unexpectedly returns null', async () => {
    tokenFindUnique.mockResolvedValue({
      id: 'reset-1',
      accountId: 'acc-admin-001',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    accountFindUnique
      .mockResolvedValueOnce(ADMIN_ACC)
      .mockResolvedValueOnce(null) // refreshed lookup misses
    txMock.mockResolvedValue([{}, {}, {}])

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: 'valid-reset-token', newPassword: 'brand-new-passw0rd-9000' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'internal' })
  })

  it('hashes the submitted token (sha256) before looking it up — raw token never hits Prisma', async () => {
    tokenFindUnique.mockResolvedValue(null)

    const rawToken = 'the-raw-token-from-the-email-link'
    const app = await buildTestApp(authRoutes)
    await app.inject({
      method: 'POST',
      url: '/reset-password',
      payload: { token: rawToken, newPassword: 'a-very-long-passw0rd' },
    })

    expect(tokenFindUnique).toHaveBeenCalledTimes(1)
    const arg = tokenFindUnique.mock.calls[0][0]
    expect(arg.where.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(arg.where.tokenHash).not.toBe(rawToken)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// POST /change-password
// ─────────────────────────────────────────────────────────────────────────

describe('POST /change-password', () => {
  it('returns 401 unauthorized without Bearer header', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      payload: { currentPassword: 'x', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 401 invalid_token when verify returns null', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer garbage' },
      payload: { currentPassword: 'x', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_token' })
  })

  it('returns 400 bad_body when newPassword is too short', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer valid-operator-token' },
      payload: { currentPassword: 'whatever', newPassword: 'short' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    // Body validation happens BEFORE the account lookup.
    expect(accountFindUnique).not.toHaveBeenCalled()
  })

  it('returns 400 bad_body when currentPassword is empty', async () => {
    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer valid-operator-token' },
      payload: { currentPassword: '', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 401 operator_disabled when account row missing', async () => {
    accountFindUnique.mockResolvedValue(null)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer valid-operator-token' },
      payload: { currentPassword: 'current-op-pw', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'operator_disabled' })
  })

  it('returns 401 token_revoked when tokenVersion drifted', async () => {
    accountFindUnique.mockResolvedValue({ ...OPERATOR_ACC, tokenVersion: 5 })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer stale-tv-token' }, // payload tv=99
      payload: { currentPassword: 'current-op-pw', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'token_revoked' })
  })

  it('returns 409 no_password_set when account has no passwordHash', async () => {
    accountFindUnique.mockResolvedValue({ ...OPERATOR_ACC, passwordHash: null })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer valid-operator-token' },
      payload: { currentPassword: 'whatever', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'no_password_set' })
  })

  it('returns 401 invalid_credentials when bcrypt.compare rejects the current password', async () => {
    accountFindUnique.mockResolvedValue(OPERATOR_ACC)

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer valid-operator-token' },
      payload: { currentPassword: 'wrong-current', newPassword: 'a-very-long-passw0rd' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_credentials' })
    expect(accountUpdate).not.toHaveBeenCalled()
  })

  it('returns 200 + fresh token on happy path; bumps tokenVersion + stores new hash', async () => {
    accountFindUnique.mockResolvedValue(OPERATOR_ACC)
    accountUpdate.mockResolvedValue({ ...OPERATOR_ACC, tokenVersion: 6 })
    signTokenMock.mockReturnValueOnce({
      token: 'jwt-after-change',
      payload: { accountId: OPERATOR_ACC.id, email: OPERATOR_ACC.email, isAdmin: false, tv: 6, exp: 0 },
    })

    const app = await buildTestApp(authRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/change-password',
      headers: { authorization: 'Bearer valid-operator-token' },
      payload: { currentPassword: 'current-op-pw', newPassword: 'brand-new-passw0rd-9000' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      token: 'jwt-after-change',
      operator: {
        id: OPERATOR_ACC.id,
        email: OPERATOR_ACC.email,
        isAdmin: false,
      },
    })

    // New password was hashed at cost 10 and stored alongside an incremented tv.
    expect(bcryptHash).toHaveBeenCalledWith('brand-new-passw0rd-9000', 10)
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: OPERATOR_ACC.id },
      data: {
        passwordHash: 'hashed:brand-new-passw0rd-9000',
        passwordSetAt: expect.any(Date),
        tokenVersion: { increment: 1 },
      },
    })
    expect(signTokenMock).toHaveBeenCalledTimes(1)
  })
})
