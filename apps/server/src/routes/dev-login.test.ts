// Integration tests for the dev-login bypass route.
//
// Pins the gate (env-var presence + constant-time token match) and the two
// auth modes (cookie session for the customer dashboard, Bearer token for
// operator/Dash/Player). Mocks Prisma, lib/auth, and lib/session so the test
// never reaches a DB and the assertions are wire-level.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    account: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../lib/auth.js', () => ({
  signAccountToken: vi.fn(() => ({
    token: 'dev-bearer-token',
    payload: { accountId: 'acc-1', email: 'dev@entuned.co', isAdmin: false, tv: 0, exp: Date.now() + 60_000 },
  })),
}))

vi.mock('../lib/session.js', () => ({
  setSessionCookie: vi.fn((reply, _accountId, _tv) => {
    reply.setCookie('entuned_session', 'mock-jwt', { path: '/', httpOnly: true, sameSite: 'lax' })
    return 'mock-jwt'
  }),
}))

import fastifyCookie from '@fastify/cookie'
import Fastify from 'fastify'
import { devLoginRoutes } from './dev-login.js'
import { prisma } from '../db.js'
import { signAccountToken } from '../lib/auth.js'
import { setSessionCookie } from '../lib/session.js'

const VALID_TOKEN = 'a'.repeat(32)

async function makeApp() {
  const app = Fastify({ logger: false })
  await app.register(fastifyCookie)
  await app.register(devLoginRoutes)
  await app.ready()
  return app
}

const ACCOUNT_ROW = {
  id: 'acc-1',
  email: 'dev@entuned.co',
  name: 'Dev User',
  isAdmin: false,
  disabledAt: null,
  tokenVersion: 0,
}

describe('POST /dev-login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEV_LOGIN_TOKEN = VALID_TOKEN
  })
  afterEach(() => {
    delete process.env.DEV_LOGIN_TOKEN
  })

  it('returns 404 when DEV_LOGIN_TOKEN is not set (route effectively disabled)', async () => {
    delete process.env.DEV_LOGIN_TOKEN
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN, email: 'dev@entuned.co' },
    })
    expect(res.statusCode).toBe(404)
    expect(prisma.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when DEV_LOGIN_TOKEN is too short (defense against a stub-secret leak)', async () => {
    process.env.DEV_LOGIN_TOKEN = 'short'
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: 'short', email: 'dev@entuned.co' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 on a mismatched token', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: 'b'.repeat(32), email: 'dev@entuned.co' },
    })
    expect(res.statusCode).toBe(401)
    expect(prisma.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when the provided token has a different length (no early-exit timing leak path)', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: 'a'.repeat(8), email: 'dev@entuned.co' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 on a missing email', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when the account does not exist', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN, email: 'missing@entuned.co' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'account_not_found' })
  })

  it('returns 404 when the account is soft-disabled (matches real login behavior)', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ACCOUNT_ROW, disabledAt: new Date() })
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN, email: 'dev@entuned.co' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('cookie mode (default): sets entuned_session cookie and returns the account', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_ROW)
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN, email: 'dev@entuned.co' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      mode: 'cookie',
      account: { id: 'acc-1', email: 'dev@entuned.co', isAdmin: false },
    })
    expect(setSessionCookie).toHaveBeenCalledWith(expect.anything(), 'acc-1', 0)
    expect(signAccountToken).not.toHaveBeenCalled()
    expect(res.headers['set-cookie']).toMatch(/entuned_session=/)
  })

  it('bearer mode: returns a minted token and does NOT set the cookie', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_ROW)
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN, email: 'dev@entuned.co', mode: 'bearer' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      mode: 'bearer',
      token: 'dev-bearer-token',
      account: { id: 'acc-1', email: 'dev@entuned.co', isAdmin: false },
    })
    expect(signAccountToken).toHaveBeenCalledWith(ACCOUNT_ROW)
    expect(setSessionCookie).not.toHaveBeenCalled()
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  // SEC-2: hard prod gate. Even with a valid DEV_LOGIN_TOKEN + account, the
  // route must refuse in production so a stray token on Railway can't mint
  // admin bearers. Two independent signals gate it: NODE_ENV and the API host.
  it('returns 404 in production NODE_ENV even with a valid token (never reaches the DB)', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_ROW)
      const app = await makeApp()
      const res = await app.inject({
        method: 'POST',
        url: '/dev-login',
        payload: { token: VALID_TOKEN, email: 'dev@entuned.co', mode: 'bearer' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
      expect(prisma.account.findUnique).not.toHaveBeenCalled()
      expect(signAccountToken).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
  })

  it('returns 404 when the request host is the prod API host (api.entuned.co)', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_ROW)
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      headers: { host: 'api.entuned.co' },
      payload: { token: VALID_TOKEN, email: 'dev@entuned.co', mode: 'bearer' },
    })
    expect(res.statusCode).toBe(404)
    expect(prisma.account.findUnique).not.toHaveBeenCalled()
    expect(signAccountToken).not.toHaveBeenCalled()
  })

  it('still works for local dev (non-prod NODE_ENV, localhost host)', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_ROW)
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/dev-login',
      headers: { host: 'localhost:3000' },
      payload: { token: VALID_TOKEN, email: 'dev@entuned.co', mode: 'bearer' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ mode: 'bearer', token: 'dev-bearer-token' })
  })

  it('normalizes email to lowercase before lookup', async () => {
    ;(prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_ROW)
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/dev-login',
      payload: { token: VALID_TOKEN, email: 'Dev@Entuned.CO' },
    })
    expect(prisma.account.findUnique).toHaveBeenCalledWith({ where: { email: 'dev@entuned.co' } })
  })
})
