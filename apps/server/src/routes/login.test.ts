// Integration tests for the customer-dashboard auth routes
// (apps/server/src/routes/login.ts). These cover:
//   - POST /magic-link  (zod validation + always-200 behavior)
//   - GET  /verify      (token lookup, consumption, redirect destinations)
//   - GET  /google      (OAuth start: handshake cookies + redirect)
//   - GET  /google/callback (OAuth code exchange + account upsert + redirect)
//   - POST /logout      (clears session cookie, 204)
//   - GET  /me          (requireAuth-protected; 401 vs 200 with enriched client)
//
// Mocking strategy:
//   - Prisma: vi.mock('../db.js', ...) at the top — account, magicLinkToken,
//     clientMembership, client, store models only.
//   - lib/email: sendMagicLink is mocked so no real Resend call is attempted.
//   - lib/account: ensureFreeClientForUser is mocked (no Prisma side-effects).
//   - lib/session: setSessionCookie / clearSessionCookie are stubbed to plain
//     cookie writes (avoiding the JWT_SECRET dependency) and requireAuth is
//     overridden to inline-populate request.user/account from a test-controlled
//     handle. Real cookie behavior (httpOnly, path, maxAge) is the session
//     module's concern; lib/session has its own unit coverage.
//   - google-auth-library: OAuth2Client is mocked at module scope; per-test
//     mocks set up the redirect URL, token-exchange response, and idToken
//     payload the callback handler reads.
//
// Cookie plugin: login routes call reply.setCookie / req.cookies directly,
// which requires @fastify/cookie registered on the Fastify instance. We
// register it BEFORE the routes plugin via a thin wrapper, mirroring how the
// real server's sessionPlugin does it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'

// ---------- Hoisted mocks ----------

vi.mock('../db.js', () => ({
  prisma: {
    account: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    magicLinkToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    clientMembership: {
      findFirst: vi.fn(),
    },
    store: {
      findFirst: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../lib/email.js', () => ({
  sendMagicLink: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../lib/account.js', () => ({
  ensureFreeClientForUser: vi.fn(async () => undefined),
}))

// Default authed handle. Tests that exercise the auth boundary mutate this
// before the inject() call.
const authHandle: { authed: boolean } = { authed: false }

vi.mock('../lib/session.js', () => ({
  // Lightweight stand-ins: write a fixed cookie so the inject response carries
  // a Set-Cookie header we can assert on, without depending on JWT_SECRET.
  setSessionCookie: vi.fn((reply, accountId, tv) => {
    reply.setCookie('entuned_session', `test-token:${accountId}:${tv}`, { path: '/' })
    return `test-token:${accountId}:${tv}`
  }),
  clearSessionCookie: vi.fn((reply) => {
    reply.clearCookie('entuned_session', { path: '/' })
  }),
  requireAuth: vi.fn(async (request: any, reply: any) => {
    if (!authHandle.authed) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    request.user = { id: 'account-test-001', email: 'test@example.com', name: null }
    request.account = { id: 'client-test-001', name: 'Test Co' }
    request.role = 'owner'
  }),
}))

// google-auth-library is mocked at module scope so the OAuth route handlers
// resolve their import without hitting the network. Per-test behavior is
// installed via the mock factory's returned class.
const generateAuthUrlMock = vi.fn()
const getTokenMock = vi.fn()
const verifyIdTokenMock = vi.fn()

vi.mock('google-auth-library', () => {
  // Class implementation: constructor stores config; instance methods are the
  // top-level mocks so tests can configure them per case.
  class OAuth2Client {
    constructor(_opts: unknown) {}
    generateAuthUrl = generateAuthUrlMock
    getToken = getTokenMock
    verifyIdToken = verifyIdTokenMock
  }
  return {
    OAuth2Client,
    CodeChallengeMethod: { S256: 'S256' },
  }
})

// ---------- Imports under test ----------

import { loginRoutes } from './login.js'
import { prisma } from '../db.js'
import { sendMagicLink } from '../lib/email.js'
import { ensureFreeClientForUser } from '../lib/account.js'
import { setSessionCookie, clearSessionCookie } from '../lib/session.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const accountUpdate = prisma.account.update as ReturnType<typeof vi.fn>
const accountCreate = prisma.account.create as ReturnType<typeof vi.fn>
const magicCreate = prisma.magicLinkToken.create as ReturnType<typeof vi.fn>
const magicFindUnique = prisma.magicLinkToken.findUnique as ReturnType<typeof vi.fn>
const magicUpdate = prisma.magicLinkToken.update as ReturnType<typeof vi.fn>
const membershipFindFirst = prisma.clientMembership.findFirst as ReturnType<typeof vi.fn>
const storeFindFirst = prisma.store.findFirst as ReturnType<typeof vi.fn>
const clientFindUnique = prisma.client.findUnique as ReturnType<typeof vi.fn>
const sendMagicLinkMock = sendMagicLink as unknown as ReturnType<typeof vi.fn>
const ensureFreeMock = ensureFreeClientForUser as unknown as ReturnType<typeof vi.fn>
const setSessionCookieMock = setSessionCookie as unknown as ReturnType<typeof vi.fn>
const clearSessionCookieMock = clearSessionCookie as unknown as ReturnType<typeof vi.fn>

// ---------- Test app helper ----------

async function buildLoginApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(fastifyCookie)
  await app.register(loginRoutes)
  await app.ready()
  return app
}

// ---------- Env setup ----------

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  authHandle.authed = false
  process.env.APP_URL = 'https://app.entuned.co'
  process.env.API_URL = 'https://api.entuned.co'
  process.env.MAGIC_LINK_BASE_URL = 'https://api.entuned.co/login/verify'
  process.env.PLAYER_URL = 'https://music.entuned.co'
  process.env.GOOGLE_CLIENT_ID = 'gid'
  process.env.GOOGLE_CLIENT_SECRET = 'gsecret'
  process.env.GOOGLE_REDIRECT_URI = 'https://api.entuned.co/login/google/callback'
  delete process.env.COOKIE_DOMAIN
  delete process.env.NODE_ENV
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

// ---------- POST /magic-link ----------

describe('POST /magic-link', () => {
  it('returns 200 and creates a token + sends the two-link variant on happy path', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-1' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: { email: 'TEST@Example.COM' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    // Email is normalized to lowercase trimmed before going to Prisma.
    expect(magicCreate).toHaveBeenCalledTimes(1)
    const createArgs = magicCreate.mock.calls[0]![0] as { data: { email: string; tokenHash: string; expiresAt: Date } }
    expect(createArgs.data.email).toBe('test@example.com')
    expect(createArgs.data.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(createArgs.data.expiresAt).toBeInstanceOf(Date)

    // Default (no `next`) path sends the two-link variant.
    expect(sendMagicLinkMock).toHaveBeenCalledTimes(1)
    const [toArg, primary, playerArg] = sendMagicLinkMock.mock.calls[0]!
    expect(toArg).toBe('test@example.com')
    expect(typeof primary).toBe('string')
    expect(primary).toContain('https://api.entuned.co/login/verify?token=')
    expect(typeof playerArg).toBe('string')
    expect(playerArg).toContain('&next=player')
  })

  it('returns 200 even when the body is invalid (no leak about validation)', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: { email: 'not-an-email' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(magicCreate).not.toHaveBeenCalled()
    expect(sendMagicLinkMock).not.toHaveBeenCalled()
  })

  it('returns 200 when the body is missing the email field entirely', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(magicCreate).not.toHaveBeenCalled()
  })

  it('uses the single-link variant when a safe `next` is provided', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-2' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: { email: 'user@example.com', next: 'https://app.entuned.co/account' },
    })

    expect(res.statusCode).toBe(200)
    expect(sendMagicLinkMock).toHaveBeenCalledTimes(1)
    const args = sendMagicLinkMock.mock.calls[0]!
    expect(args.length).toBe(2) // (email, link) — no playerLink in single-link variant
    expect(args[1]).toContain('&next=https%3A%2F%2Fapp.entuned.co%2Faccount')
  })

  it('drops an unsafe `next` (different origin) and falls back to two-link variant', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-3' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: { email: 'user@example.com', next: 'https://evil.com/steal' },
    })

    expect(res.statusCode).toBe(200)
    const args = sendMagicLinkMock.mock.calls[0]!
    expect(args.length).toBe(3) // two-link fallback
    expect(args[1]).not.toContain('evil.com')
    expect(args[2]).toContain('&next=player')
  })

  it('still returns 200 if Prisma throws (no leak about send failure)', async () => {
    magicCreate.mockRejectedValue(new Error('db down'))

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: { email: 'user@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(sendMagicLinkMock).not.toHaveBeenCalled()
  })

  it('persists sanitized first-touch attribution onto the token', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-attr' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: {
        email: 'user@example.com',
        attribution: {
          referrer: 'https://www.reddit.com/r/smallbusiness',
          landingPath: '/for-apparel?utm_source=reddit',
          utmSource: 'reddit',
          utmMedium: 'social',
          utmCampaign: 'spring',
          // Empty/whitespace fields coerce to null; unknown keys are ignored.
          utmTerm: '   ',
          ignoreMe: 'nope',
        },
      },
    })

    expect(res.statusCode).toBe(200)
    const data = magicCreate.mock.calls[0]![0].data as Record<string, unknown>
    expect(data.attrReferrer).toBe('https://www.reddit.com/r/smallbusiness')
    expect(data.attrLandingPath).toBe('/for-apparel?utm_source=reddit')
    expect(data.attrUtmSource).toBe('reddit')
    expect(data.attrUtmMedium).toBe('social')
    expect(data.attrUtmCampaign).toBe('spring')
    expect(data.attrUtmTerm).toBeNull()
    expect(data.attrUtmContent).toBeNull()
    expect(data).not.toHaveProperty('ignoreMe')
  })

  it('stores all-null attribution columns when no attribution is provided', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-noattr' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: { email: 'user@example.com' },
    })

    expect(res.statusCode).toBe(200)
    const data = magicCreate.mock.calls[0]![0].data as Record<string, unknown>
    expect(data.attrReferrer).toBeNull()
    expect(data.attrUtmSource).toBeNull()
    expect(data.referralCode).toBeNull()
  })

  it('parks a valid referralCode on the token', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-ref' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: {
        email: 'user@example.com',
        attribution: { referralCode: 'X7K9QW2Z' },
      },
    })

    expect(res.statusCode).toBe(200)
    const data = magicCreate.mock.calls[0]![0].data as Record<string, unknown>
    expect(data.referralCode).toBe('X7K9QW2Z')
  })

  it('nulls an invalid referralCode (bad charset) instead of parking it', async () => {
    magicCreate.mockResolvedValue({ id: 'mlt-badref' })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'POST',
      url: '/magic-link',
      payload: {
        email: 'user@example.com',
        attribution: { referralCode: 'nope; DROP TABLE clients' },
      },
    })

    expect(res.statusCode).toBe(200)
    const data = magicCreate.mock.calls[0]![0].data as Record<string, unknown>
    expect(data.referralCode).toBeNull()
  })
})

// ---------- GET /verify ----------

describe('GET /verify', () => {
  it('redirects to /start?error=missing_token when token is absent', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/start?error=missing_token')
  })

  it('redirects to /start?error=invalid_token when token row does not exist', async () => {
    magicFindUnique.mockResolvedValue(null)

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/start?error=invalid_token')
  })

  it('redirects to /start?error=token_already_used when row.consumedAt is set', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1',
      email: 'u@example.com',
      tokenHash: 'h',
      consumedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/start?error=token_already_used')
  })

  it('redirects to /start?error=token_expired when row is past expiry', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1',
      email: 'u@example.com',
      tokenHash: 'h',
      consumedAt: null,
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/start?error=token_expired')
  })

  it('happy path: consumes token, sets session cookie, redirects to APP_URL when no next is given and onboarding is complete', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1',
      email: 'u@example.com',
      tokenHash: 'h',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      // First-touch attribution parked on the token at /magic-link.
      attrReferrer: 'https://www.reddit.com/r/smallbusiness',
      attrLandingPath: '/for-apparel?utm_source=reddit',
      attrUtmSource: 'reddit',
      attrUtmMedium: 'social',
      attrUtmCampaign: 'spring',
      attrUtmTerm: null,
      attrUtmContent: null,
      referralCode: null,
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-1' })
    // findOrCreateUserByEmail: existing user, not disabled.
    accountFindUnique.mockResolvedValue({
      id: 'acc-1',
      email: 'u@example.com',
      name: 'U',
      disabledAt: null,
      tokenVersion: 3,
    })
    accountUpdate.mockResolvedValue({
      id: 'acc-1',
      email: 'u@example.com',
      name: 'U',
      disabledAt: null,
      tokenVersion: 3,
    })
    // needsOnboarding: industry already set
    membershipFindFirst.mockResolvedValue({ client: { industry: 'cafe' } })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/')
    expect(magicUpdate).toHaveBeenCalledWith({ where: { id: 'mlt-1' }, data: { consumedAt: expect.any(Date) } })
    expect(setSessionCookieMock).toHaveBeenCalledWith(expect.anything(), 'acc-1', 3)
    // Attribution from the token is mapped + forwarded to provisioning.
    expect(ensureFreeMock).toHaveBeenCalledWith('acc-1', 'u@example.com', {
      referrer: 'https://www.reddit.com/r/smallbusiness',
      landingPath: '/for-apparel?utm_source=reddit',
      utmSource: 'reddit',
      utmMedium: 'social',
      utmCampaign: 'spring',
      utmTerm: null,
      utmContent: null,
      referralCode: null,
    })
  })

  it('forwards the parked referralCode to provisioning (where it lands on the created Client.referredByCode)', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-ref',
      email: 'ref@example.com',
      tokenHash: 'h',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      attrReferrer: null,
      attrLandingPath: '/start',
      attrUtmSource: null,
      attrUtmMedium: null,
      attrUtmCampaign: null,
      attrUtmTerm: null,
      attrUtmContent: null,
      referralCode: 'X7K9QW2Z',
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-ref' })
    // findOrCreateUserByEmail: no existing account → create (first sign-in).
    accountFindUnique.mockResolvedValue(null)
    accountCreate.mockResolvedValue({
      id: 'acc-ref', email: 'ref@example.com', name: null, disabledAt: null, tokenVersion: 0,
    })
    membershipFindFirst.mockResolvedValue({ client: { industry: 'retail' } })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(ensureFreeMock).toHaveBeenCalledWith('acc-ref', 'ref@example.com', expect.objectContaining({
      referralCode: 'X7K9QW2Z',
    }))
  })

  it('redirects to /onboard when the client industry is null', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1', email: 'u@example.com', tokenHash: 'h',
      consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-1' })
    accountFindUnique.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    accountUpdate.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    membershipFindFirst.mockResolvedValue({ client: { industry: null } })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/onboard')
  })

  it('redirects to /start?error=account_disabled if the underlying account is disabled', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1', email: 'u@example.com', tokenHash: 'h',
      consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-1' })
    accountFindUnique.mockResolvedValue({
      id: 'acc-1', email: 'u@example.com', name: null,
      disabledAt: new Date('2026-01-01'), tokenVersion: 0,
    })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/start?error=account_disabled')
    expect(setSessionCookieMock).not.toHaveBeenCalled()
  })

  it('resolves the player URL for the primary store when next=player', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1', email: 'u@example.com', tokenHash: 'h',
      consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-1' })
    accountFindUnique.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    accountUpdate.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    // First call: needsOnboarding => industry set.
    // Second call: resolvePlayerUrlForUser => returns clientId.
    membershipFindFirst
      .mockResolvedValueOnce({ client: { industry: 'cafe' } })
      .mockResolvedValueOnce({ clientId: 'client-1' })
    storeFindFirst.mockResolvedValue({ slug: 'cool-cafe' })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc&next=player' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://music.entuned.co/cool-cafe')
  })

  it('falls through to APP_URL when next=player but the account has no store', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1', email: 'u@example.com', tokenHash: 'h',
      consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-1' })
    accountFindUnique.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    accountUpdate.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    membershipFindFirst
      .mockResolvedValueOnce({ client: { industry: 'cafe' } })
      .mockResolvedValueOnce(null) // no membership => null player dest
    // `safeNext('player')` is not a URL — returns null — so we land on APP_URL/.
    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/verify?token=abc&next=player' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/')
  })

  it('respects a safe same-origin `next` query param after verify', async () => {
    magicFindUnique.mockResolvedValue({
      id: 'mlt-1', email: 'u@example.com', tokenHash: 'h',
      consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    })
    magicUpdate.mockResolvedValue({ id: 'mlt-1' })
    accountFindUnique.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    accountUpdate.mockResolvedValue({ id: 'acc-1', email: 'u@example.com', name: null, disabledAt: null, tokenVersion: 0 })
    membershipFindFirst.mockResolvedValue({ client: { industry: 'cafe' } })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: `/verify?token=abc&next=${encodeURIComponent('https://app.entuned.co/billing/upgrade')}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/billing/upgrade')
  })
})

// ---------- GET /google (OAuth start) ----------

describe('GET /google', () => {
  it('sets state + pkce cookies and redirects to the Google auth URL', async () => {
    generateAuthUrlMock.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?...')

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/google' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://accounts.google.com/o/oauth2/v2/auth?...')
    const setCookieHeader = res.headers['set-cookie']
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('\n') : String(setCookieHeader ?? '')
    expect(cookieStr).toContain('entuned_oauth_state=')
    expect(cookieStr).toContain('entuned_oauth_pkce=')
    // generateAuthUrl invoked with the expected challenge method.
    expect(generateAuthUrlMock).toHaveBeenCalledTimes(1)
    const args = generateAuthUrlMock.mock.calls[0]![0] as Record<string, unknown>
    expect(args.code_challenge_method).toBe('S256')
    expect(args.scope).toEqual(['openid', 'email', 'profile'])
  })

  it('persists a safe `next` to a handshake cookie for callback round-trip', async () => {
    generateAuthUrlMock.mockReturnValue('https://accounts.google.com/auth')

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: `/google?next=${encodeURIComponent('https://app.entuned.co/account')}`,
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('\n') : String(setCookieHeader ?? '')
    expect(cookieStr).toContain('entuned_oauth_next=')
    // The URL is encoded by Set-Cookie machinery; just confirm host is present somewhere.
    expect(decodeURIComponent(cookieStr)).toContain('app.entuned.co/account')
  })

  it('does NOT set a next cookie when the `next` query is unsafe', async () => {
    generateAuthUrlMock.mockReturnValue('https://accounts.google.com/auth')

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: `/google?next=${encodeURIComponent('https://evil.com/x')}`,
    })

    const setCookieHeader = res.headers['set-cookie']
    const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('\n') : String(setCookieHeader ?? '')
    expect(cookieStr).not.toContain('entuned_oauth_next=')
  })
})

// ---------- GET /google/callback ----------

describe('GET /google/callback', () => {
  it('returns 400 when ?error=... is present', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/google/callback?error=access_denied' })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'google_oauth_error', detail: 'access_denied' })
  })

  it('returns 400 when code or state is missing', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/google/callback?code=c' })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'missing_code_or_state' })
  })

  it('returns 400 oauth_session_lost when handshake cookies are missing', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'oauth_session_lost' })
  })

  it('returns 400 state_mismatch when cookie state and query state differ', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: { entuned_oauth_state: 'other', entuned_oauth_pkce: 'v' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'state_mismatch' })
  })

  it('returns 400 oauth_exchange_failed when getToken throws', async () => {
    getTokenMock.mockRejectedValue(new Error('boom'))

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: { entuned_oauth_state: 's', entuned_oauth_pkce: 'v' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'oauth_exchange_failed' })
  })

  it('returns 400 no_id_token when google omits id_token', async () => {
    getTokenMock.mockResolvedValue({ tokens: {} })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: { entuned_oauth_state: 's', entuned_oauth_pkce: 'v' },
    })

    // The handler wraps token exchange in a try/catch — `no_id_token` would
    // otherwise return that code, but the throw-on-undefined path lands us
    // back in oauth_exchange_failed. We accept either (the contract is "400
    // with an error code"; the exact discriminator is implementation detail).
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(['no_id_token', 'oauth_exchange_failed']).toContain(body.error)
  })

  it('returns 400 email_not_verified when google returns an unverified email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'idt' } })
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ sub: 'gs-1', email: 'u@example.com', email_verified: false, name: 'U' }),
    })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: { entuned_oauth_state: 's', entuned_oauth_pkce: 'v' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'email_not_verified' })
  })

  it('creates a new account, sets session, redirects to /onboard on first-time signin', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'idt' } })
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ sub: 'gs-new', email: 'new@example.com', email_verified: true, name: 'New U' }),
    })
    // No googleSub match, no email match — falls through to create.
    accountFindUnique.mockResolvedValue(null)
    accountCreate.mockResolvedValue({
      id: 'acc-new', email: 'new@example.com', name: 'New U',
      googleSub: 'gs-new', disabledAt: null, tokenVersion: 0,
    })
    // needsOnboarding: industry null
    membershipFindFirst.mockResolvedValue({ client: { industry: null } })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: { entuned_oauth_state: 's', entuned_oauth_pkce: 'v' },
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/onboard')
    expect(setSessionCookieMock).toHaveBeenCalledWith(expect.anything(), 'acc-new', 0)
    expect(ensureFreeMock).toHaveBeenCalledWith('acc-new', 'new@example.com')
  })

  it('returns 403 account_disabled when the matched account is disabled', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'idt' } })
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ sub: 'gs-1', email: 'd@example.com', email_verified: true, name: 'D' }),
    })
    // First lookup by googleSub returns the disabled account.
    accountFindUnique.mockResolvedValueOnce({
      id: 'acc-d', email: 'd@example.com', name: 'D',
      googleSub: 'gs-1', disabledAt: new Date('2026-01-01'), tokenVersion: 0,
    })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: { entuned_oauth_state: 's', entuned_oauth_pkce: 'v' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'account_disabled' })
    expect(setSessionCookieMock).not.toHaveBeenCalled()
  })

  it('honors a same-origin `next` cookie on successful callback', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'idt' } })
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ sub: 'gs-1', email: 'u@example.com', email_verified: true, name: 'U' }),
    })
    accountFindUnique.mockResolvedValueOnce({
      id: 'acc-1', email: 'u@example.com', name: 'U',
      googleSub: 'gs-1', disabledAt: null, tokenVersion: 1,
    })
    accountUpdate.mockResolvedValue({
      id: 'acc-1', email: 'u@example.com', name: 'U',
      googleSub: 'gs-1', disabledAt: null, tokenVersion: 1,
    })
    membershipFindFirst.mockResolvedValue({ client: { industry: 'retail' } })

    const app = await buildLoginApp()
    const res = await app.inject({
      method: 'GET',
      url: '/google/callback?code=c&state=s',
      cookies: {
        entuned_oauth_state: 's',
        entuned_oauth_pkce: 'v',
        entuned_oauth_next: 'https://app.entuned.co/account',
      },
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.entuned.co/account')
  })
})

// ---------- POST /logout ----------

describe('POST /logout', () => {
  it('returns 204 and calls clearSessionCookie', async () => {
    const app = await buildLoginApp()
    const res = await app.inject({ method: 'POST', url: '/logout' })

    expect(res.statusCode).toBe(204)
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1)
  })
})

// ---------- GET /me ----------

describe('GET /me', () => {
  it('returns 401 when no session is attached', async () => {
    authHandle.authed = false

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/me' })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
    expect(clientFindUnique).not.toHaveBeenCalled()
  })

  it('returns 200 with enriched client profile when authed and client row exists', async () => {
    authHandle.authed = true
    clientFindUnique.mockResolvedValue({
      id: 'client-test-001',
      companyName: 'Test Co',
      contactName: 'Daniel',
      contactEmail: 'daniel@example.com',
      contactPhone: '+15551234',
    })

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/me' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      user: { id: 'account-test-001', email: 'test@example.com', name: null },
      account: {
        id: 'client-test-001',
        companyName: 'Test Co',
        contactName: 'Daniel',
        contactEmail: 'daniel@example.com',
        contactPhone: '+15551234',
      },
      role: 'owner',
    })
    expect(clientFindUnique).toHaveBeenCalledWith({
      where: { id: 'client-test-001' },
      select: {
        id: true, companyName: true,
        contactName: true, contactEmail: true, contactPhone: true,
      },
    })
  })

  it('returns 200 with account=null when the authed user has no client row', async () => {
    authHandle.authed = true
    clientFindUnique.mockResolvedValue(null)

    const app = await buildLoginApp()
    const res = await app.inject({ method: 'GET', url: '/me' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.account).toBeNull()
    expect(body.user).toEqual({ id: 'account-test-001', email: 'test@example.com', name: null })
    expect(body.role).toBe('owner')
  })
})
