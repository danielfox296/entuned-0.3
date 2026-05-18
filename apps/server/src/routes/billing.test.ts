// Integration tests for billing routes (apps/server/src/routes/billing.ts).
//
// Surface covered:
//   - POST /billing/checkout                   (Stripe Checkout session create)
//   - GET  /billing/checkout?tier=...          (redirect form)
//   - POST /webhooks/stripe                    (signature verify + event dispatch)
//   - POST /billing/checkout-session/confirm   (post-Checkout self-heal)
//   - GET  /billing/portal                     (Customer Portal session)
//   - GET  /billing/upgrade-from-comp          (comp → paid promotion)
//   - GET  /billing/upgrade                    (free → paid upgrade)
//   - POST /billing/stores                     (add another Store on the same sub)
//   - POST /billing/pause                      (pause Stripe sub + downgrade local tier)
//   - POST /billing/resume                     (undo pause)
//
// Mocking strategy:
//   - Stripe SDK: vi.mock('stripe', ...) returns a class whose instances expose
//     exactly the methods this file calls (checkout.sessions, billingPortal,
//     webhooks, subscriptions). Methods are vi.fn()s so tests can mockResolvedValue.
//   - Prisma: vi.mock('../db.js', ...) — every model the route touches.
//   - tier helpers: vi.mock('../lib/tier.js', ...) — `applyTierChange` is a
//     vi.fn(). The tier-log behavior is covered by tier.test.ts; we only
//     verify call-shape here. `effectiveTier`/`tierRank` keep their real
//     implementations via importOriginal.
//   - Email: vi.mock('../lib/email.js', ...) — sendWelcome / sendDunning as
//     no-op vi.fn()s. They're fire-and-forget (.catch(()=>undefined)) so we
//     only assert they were/weren't called.
//   - account.ts / outcomes.ts: stub uniqueStoreSlug + pickSystemDefaultOutcomeId.
//   - requireAuth: pattern from me.test.ts — overwrite to inline-populate
//     request.user / request.account.
//
// Webhook signature: `stripe.webhooks.constructEvent` is a vi.fn(). Default
// returns a canned event object; tests that exercise the bad-signature path
// override it to throw.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- Stripe SDK mock ----------
// Stripe is instantiated once at module load (top of billing.ts), so the same
// instance is reused for the whole test run. We hoist the mocks alongside the
// `vi.mock()` factory so the class body can close over them at construction
// time (regular `const` declarations are evaluated AFTER `vi.mock()` is hoisted).
const stripeMocks = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
}))

vi.mock('stripe', () => {
  // Stripe is imported as a default export and instantiated with `new Stripe(...)`.
  // Use a real class so the constructor call works under ESM semantics.
  class StripeMock {
    checkout = stripeMocks.checkout
    billingPortal = stripeMocks.billingPortal
    webhooks = stripeMocks.webhooks
    subscriptions = stripeMocks.subscriptions
    constructor(_key: string, _opts?: unknown) {
      // no-op
    }
  }
  return { default: StripeMock }
})

// ---------- Prisma mock ----------
vi.mock('../db.js', () => ({
  prisma: {
    account: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    clientMembership: {
      create: vi.fn(),
    },
    store: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    tierChangeLog: {
      create: vi.fn(),
    },
  },
}))

// ---------- tier helpers mock ----------
// Keep effectiveTier / tierRank real (cheap pure fns); stub applyTierChange.
vi.mock('../lib/tier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tier.js')>()
  return {
    ...actual,
    applyTierChange: vi.fn(async () => undefined),
  }
})

// ---------- email mock ----------
vi.mock('../lib/email.js', () => ({
  sendWelcome: vi.fn(async () => undefined),
  sendDunning: vi.fn(async () => undefined),
}))

// ---------- account / outcomes mocks ----------
vi.mock('../lib/account.js', () => ({
  uniqueStoreSlug: vi.fn(async (name: string) =>
    `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-slug`,
  ),
}))
vi.mock('../lib/outcomes.js', () => ({
  pickSystemDefaultOutcomeId: vi.fn(async () => 'outcome-default-id'),
}))

// ---------- session/requireAuth mock ----------
// Default: authed as client-test-001 / user-test-001. Tests that need the
// unauthed path call `setUnauthed()` before injecting.
let _authed = true
function setAuthed(v: boolean) {
  _authed = v
}
vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>()
  return {
    ...actual,
    requireAuth: vi.fn(async (request: any, reply: any) => {
      if (_authed) {
        request.user = { id: 'user-test-001', email: 'owner@example.com', name: null }
        request.account = { id: 'client-test-001', name: 'Test Co' }
        request.role = 'owner'
      } else {
        return reply.code(401).send({ error: 'unauthorized' })
      }
    }),
  }
})

// ---------- env (read by billing.ts at import time) ----------
// ESM `import` statements are hoisted above top-level statements, so plain
// `process.env.X = ...` lines would run AFTER `./billing.js` is imported and
// captures the env at module load. `vi.hoisted` runs before imports, which
// is exactly what we need for module-level `const X = process.env.Y ?? ''`.
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
  process.env.STRIPE_PRICE_ID_CORE = 'price_core_001'
  process.env.STRIPE_PRICE_ID_PRO = 'price_pro_001'
  process.env.APP_URL = 'https://app.test'
  process.env.WEBSITE_URL = 'https://web.test'
  process.env.PLAYER_URL = 'https://player.test'
  process.env.API_URL = 'https://api.test'
})

import Fastify, { type FastifyInstance } from 'fastify'
import { billingRoutes } from './billing.js'
import { prisma } from '../db.js'
import { applyTierChange } from '../lib/tier.js'
import { sendWelcome, sendDunning } from '../lib/email.js'

// Local Fastify builder. The shared `buildTestApp` doesn't register the
// production `sessionPlugin`, so routes that read `req.user` / `req.account`
// directly (e.g. GET /billing/upgrade, GET /billing/upgrade-from-comp) see
// undefined and 302 to /start. We install a tiny test-mode onRequest hook
// that mirrors `attachSession` behavior, gated by the same `_authed` flag
// used by the requireAuth mock.
async function buildTestApp(plugin: typeof billingRoutes): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (req) => {
    if (_authed) {
      ;(req as any).user = { id: 'user-test-001', email: 'owner@example.com', name: null }
      ;(req as any).account = { id: 'client-test-001', name: 'Test Co' }
      ;(req as any).role = 'owner'
    }
  })
  await app.register(plugin)
  await app.ready()
  return app
}

// Helpers to access the Prisma + Stripe + helper mocks with vi.fn typing.
const p = prisma as unknown as {
  account: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }
  client: {
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  clientMembership: { create: ReturnType<typeof vi.fn> }
  store: {
    findFirst: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  subscription: {
    findFirst: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  tierChangeLog: { create: ReturnType<typeof vi.fn> }
}

const applyTierChangeMock = applyTierChange as unknown as ReturnType<typeof vi.fn>
const sendWelcomeMock = sendWelcome as unknown as ReturnType<typeof vi.fn>
const sendDunningMock = sendDunning as unknown as ReturnType<typeof vi.fn>

const CLIENT_ID = 'client-test-001'
const STORE_ID = 'store-aaaaaaaa'
const SUB_ID = 'sub_test_001'
const CUSTOMER_ID = 'cus_test_001'
const STRIPE_SESSION_ID = 'cs_test_001'

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so per-test `mockRejectedValue` /
  // `mockResolvedValue` implementations do not leak to the next test. A prior
  // test setting `p.subscription.updateMany.mockRejectedValue(...)` was
  // making every subsequent webhook test 500. See TESTING.md for the same
  // gotcha noted in pauseAutoResume.test.ts.
  vi.resetAllMocks()
  setAuthed(true)
  // Set sensible default resolutions for the cross-cutting Stripe calls so
  // tests don't have to redeclare them. Tests override as needed.
  stripeMocks.checkout.sessions.create.mockReset()
  stripeMocks.checkout.sessions.retrieve.mockReset()
  stripeMocks.billingPortal.sessions.create.mockReset()
  stripeMocks.webhooks.constructEvent.mockReset()
  stripeMocks.subscriptions.retrieve.mockReset()
  stripeMocks.subscriptions.update.mockReset()
})

// ---------- POST /billing/checkout ----------

describe('POST /billing/checkout', () => {
  it('creates a core checkout session with mode=subscription and the core price id', async () => {
    stripeMocks.checkout.sessions.create.mockResolvedValue({
      id: STRIPE_SESSION_ID,
      url: 'https://stripe.test/checkout/cs_001',
    })

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'core', email: 'buyer@example.com' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.url).toBe('https://stripe.test/checkout/cs_001')
    expect(body.sessionId).toBe(STRIPE_SESSION_ID)
    expect(typeof body.clientReferenceId).toBe('string')

    expect(stripeMocks.checkout.sessions.create).toHaveBeenCalledOnce()
    const args = stripeMocks.checkout.sessions.create.mock.calls[0][0]
    expect(args.mode).toBe('subscription')
    expect(args.line_items).toEqual([{ price: 'price_core_001', quantity: 1 }])
    expect(args.success_url).toBe('https://app.test/welcome?session={CHECKOUT_SESSION_ID}')
    expect(args.cancel_url).toBe('https://web.test/pricing.html')
    expect(args.customer_email).toBe('buyer@example.com')
    expect(args.metadata.tier).toBe('core')
    // No clientId supplied -> guestRef carries the minted ref id.
    expect(args.metadata.clientId).toBe('')
    expect(args.metadata.guestRef).toBe(body.clientReferenceId)
    expect(args.subscription_data.metadata.tier).toBe('core')
  })

  it('creates a pro checkout session with the pro price id', async () => {
    stripeMocks.checkout.sessions.create.mockResolvedValue({ id: 'cs_pro', url: 'https://x' })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'pro' },
    })
    expect(res.statusCode).toBe(200)
    const args = stripeMocks.checkout.sessions.create.mock.calls[0][0]
    expect(args.line_items).toEqual([{ price: 'price_pro_001', quantity: 1 }])
    expect(args.metadata.tier).toBe('pro')
    // No email supplied -> customer_email absent (not undefined-stringified).
    expect('customer_email' in args).toBe(false)
  })

  it('uses provided clientId in metadata and as client_reference_id', async () => {
    stripeMocks.checkout.sessions.create.mockResolvedValue({ id: 'cs_x', url: 'https://x' })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'core', clientId: 'client-existing-99' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().clientReferenceId).toBe('client-existing-99')
    const args = stripeMocks.checkout.sessions.create.mock.calls[0][0]
    expect(args.client_reference_id).toBe('client-existing-99')
    expect(args.metadata.clientId).toBe('client-existing-99')
    expect(args.metadata.guestRef).toBe('')
  })

  it('returns 400 on bad body (missing tier)', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { email: 'a@b.test' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_body' })
    expect(stripeMocks.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid tier value', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'enterprise' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_body' })
  })

  it('returns 502 when Stripe checkout creation throws', async () => {
    stripeMocks.checkout.sessions.create.mockRejectedValue(new Error('stripe down'))
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'core' },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: 'stripe_error', message: 'stripe down' })
  })
})

// ---------- GET /billing/checkout ----------

describe('GET /billing/checkout', () => {
  it('303-redirects to the Stripe session URL on success', async () => {
    stripeMocks.checkout.sessions.create.mockResolvedValue({
      id: 'cs_get',
      url: 'https://stripe.test/checkout/cs_get',
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/checkout?tier=core' })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toBe('https://stripe.test/checkout/cs_get')
  })

  it('returns 400 on bad tier query', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/checkout?tier=lol' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_tier' })
  })

  it('303-redirects to pricing with checkout=error on Stripe failure', async () => {
    stripeMocks.checkout.sessions.create.mockRejectedValue(new Error('boom'))
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/checkout?tier=pro' })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toBe('https://web.test/pricing.html?checkout=error')
  })
})

// ---------- POST /webhooks/stripe ----------

describe('POST /webhooks/stripe — signature handling', () => {
  it('returns 400 when stripe-signature header is missing', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'missing_signature' })
    expect(stripeMocks.webhooks.constructEvent).not.toHaveBeenCalled()
  })

  it('returns 400 when signature verification throws (bad_signature)', async () => {
    stripeMocks.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'invalid-sig' },
      payload: '{"type":"checkout.session.completed"}',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_signature' })
  })

  it('forwards the raw body string to constructEvent (not parsed JSON)', async () => {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'unknown.event',
      data: { object: {} },
    } as any)
    const raw = '{"type":"unknown.event"}'
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_ok' },
      payload: raw,
    })
    expect(res.statusCode).toBe(200)
    expect(stripeMocks.webhooks.constructEvent).toHaveBeenCalledWith(
      raw,
      'sig_ok',
      'whsec_test_x',
    )
  })

  it('returns 200 {received:true} and is a no-op for unhandled event types', async () => {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'customer.created',
      data: { object: {} },
    } as any)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    // None of the prisma mutation paths should fire.
    expect(applyTierChangeMock).not.toHaveBeenCalled()
    expect(p.subscription.create).not.toHaveBeenCalled()
    expect(p.subscription.updateMany).not.toHaveBeenCalled()
  })

  it('returns 500 when a handler throws (so Stripe retries)', async () => {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          subscription: SUB_ID,
        },
      },
    } as any)
    p.subscription.updateMany.mockRejectedValue(new Error('db down'))
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'handler_failed' })
  })
})

// ---------- checkout.session.completed ----------

describe('webhook: checkout.session.completed', () => {
  // Shared session shape used by these tests.
  function makeSession(overrides: Record<string, any> = {}) {
    return {
      id: STRIPE_SESSION_ID,
      customer: CUSTOMER_ID,
      subscription: SUB_ID,
      customer_email: 'buyer@example.com',
      customer_details: { email: 'buyer@example.com' },
      metadata: { tier: 'core', clientId: '', guestRef: 'ref-1' },
      ...overrides,
    }
  }

  function mockEvent(session: any) {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    } as any)
  }

  function mockStripeSubRetrieve(overrides: Record<string, any> = {}) {
    stripeMocks.subscriptions.retrieve.mockResolvedValue({
      id: SUB_ID,
      status: 'active',
      current_period_end: Math.floor(new Date('2026-12-31').getTime() / 1000),
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_core_001' } }] },
      ...overrides,
    } as any)
  }

  it('absorbs an orphan free Store: applyTierChange to paid tier, creates Subscription, sends welcome', async () => {
    mockEvent(makeSession())
    mockStripeSubRetrieve()
    // Email-not-in-metadata path -> findOrCreateClientByEmail. We supply
    // metadata.clientId='' so the code path falls through to email lookup.
    p.account.findUnique.mockResolvedValue({
      id: 'user-buyer',
      memberships: [
        { client: { id: 'client-buyer', companyName: 'Buyer Co' } },
      ],
    })
    p.client.update.mockResolvedValue({})
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'free',
      compTier: null,
      compExpiresAt: null,
    })
    p.store.findUnique.mockResolvedValue({
      id: STORE_ID,
      slug: 'orphan-slug',
      tier: 'free',
      compTier: null,
      compExpiresAt: null,
    })
    p.subscription.create.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })

    // Tier transition: free -> core, source=stripe_webhook (no comp to clear).
    expect(applyTierChangeMock).toHaveBeenCalledOnce()
    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.storeId).toBe(STORE_ID)
    expect(call.fromTier).toBe('free')
    expect(call.data.tier).toBe('core')
    expect(call.source).toBe('stripe_webhook')
    expect(call.actorId).toBeNull()

    // Subscription row created with the right Stripe ids.
    expect(p.subscription.create).toHaveBeenCalledOnce()
    const subData = p.subscription.create.mock.calls[0][0].data
    expect(subData.storeId).toBe(STORE_ID)
    expect(subData.stripeSubscriptionId).toBe(SUB_ID)
    expect(subData.stripeCustomerId).toBe(CUSTOMER_ID)
    expect(subData.stripePriceId).toBe('price_core_001')
    expect(subData.status).toBe('active')

    // Persists stripeCustomerId on the Client.
    expect(p.client.update).toHaveBeenCalledWith({
      where: { id: 'client-buyer' },
      data: { stripeCustomerId: CUSTOMER_ID },
    })

    // Welcome email goes to the buyer at their player URL.
    expect(sendWelcomeMock).toHaveBeenCalledWith(
      'buyer@example.com',
      'core',
      'https://player.test/orphan-slug',
      'https://app.test',
    )
  })

  it('auto-clears a comp when the new paid tier ranks at or above the comp tier', async () => {
    mockEvent(makeSession({ metadata: { tier: 'pro', clientId: '', guestRef: 'r' } }))
    mockStripeSubRetrieve({ items: { data: [{ price: { id: 'price_pro_001' } }] } })
    p.account.findUnique.mockResolvedValue({
      id: 'u',
      memberships: [{ client: { id: 'c', companyName: 'Co' } }],
    })
    p.client.update.mockResolvedValue({})
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'free',
      compTier: 'core',
      compExpiresAt: new Date('2099-01-01'),
    })
    p.store.findUnique.mockResolvedValue({
      id: STORE_ID,
      slug: 's',
      tier: 'free',
      compTier: 'core',
      compExpiresAt: new Date('2099-01-01'),
    })
    p.subscription.create.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })

    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.source).toBe('auto_cleared')
    expect(call.data.tier).toBe('pro')
    expect(call.data.compTier).toBeNull()
    expect(call.data.compExpiresAt).toBeNull()
    expect(call.reason).toMatch(/auto-cleared/)
  })

  it('creates a fresh paid Store + tierChangeLog row when there is no orphan free Store', async () => {
    mockEvent(makeSession())
    mockStripeSubRetrieve()
    p.account.findUnique.mockResolvedValue({
      id: 'u',
      memberships: [{ client: { id: 'c-new', companyName: 'New Co' } }],
    })
    p.client.update.mockResolvedValue({})
    p.store.findFirst.mockResolvedValue(null) // no orphan
    p.store.create.mockResolvedValue({ id: 'store-new', slug: 'new-co-slug' })
    p.tierChangeLog.create.mockResolvedValue({})
    p.subscription.create.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)

    expect(applyTierChangeMock).not.toHaveBeenCalled()
    expect(p.store.create).toHaveBeenCalledOnce()
    const createData = p.store.create.mock.calls[0][0].data
    expect(createData.clientId).toBe('c-new')
    expect(createData.tier).toBe('core')
    expect(createData.timezone).toBe('UTC')

    // Initial free → paid log row.
    expect(p.tierChangeLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-new',
        fromTier: 'free',
        toTier: 'core',
        source: 'stripe_webhook',
        reason: 'initial paid checkout (core)',
      },
    })
  })

  it('uses metadata.clientId when present (existing Client path)', async () => {
    mockEvent(
      makeSession({ metadata: { tier: 'core', clientId: 'client-meta-1', guestRef: '' } }),
    )
    mockStripeSubRetrieve()
    p.client.findUnique.mockResolvedValue({ id: 'client-meta-1', companyName: 'MetaCo' })
    p.client.update.mockResolvedValue({})
    p.store.findFirst.mockResolvedValue(null)
    p.store.create.mockResolvedValue({ id: 'store-new', slug: 'metaco-slug' })
    p.tierChangeLog.create.mockResolvedValue({})
    p.subscription.create.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })

    expect(p.client.findUnique).toHaveBeenCalledWith({ where: { id: 'client-meta-1' } })
    // No find-or-create-by-email path when clientId resolves.
    expect(p.account.findUnique).not.toHaveBeenCalled()
  })

  it('returns 500 (Stripe will retry) when no email and no clientId metadata are present', async () => {
    mockEvent(
      makeSession({
        metadata: { tier: 'core', clientId: '', guestRef: 'r' },
        customer_email: null,
        customer_details: { email: null },
      }),
    )
    mockStripeSubRetrieve()

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(500)
  })

  it('returns 500 when subscription id is missing from the session', async () => {
    mockEvent(makeSession({ subscription: null }))
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(500)
    expect(p.subscription.create).not.toHaveBeenCalled()
  })
})

// ---------- customer.subscription.updated ----------

describe('webhook: customer.subscription.updated', () => {
  function mockSubEvent(overrides: Record<string, any> = {}) {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'active',
          current_period_end: Math.floor(new Date('2026-12-31').getTime() / 1000),
          cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_core_001' } }] },
          ...overrides,
        },
      },
    } as any)
  }

  it('writes subscription status + period + flags from the Stripe object', async () => {
    mockSubEvent()
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      stripePriceId: 'price_core_001',
      store: { id: STORE_ID, tier: 'core', compTier: null, compExpiresAt: null },
    })
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)

    expect(p.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: SUB_ID },
      data: expect.objectContaining({
        status: 'active',
        cancelAtPeriodEnd: false,
      }),
    })
    const arg = p.subscription.updateMany.mock.calls[0][0]
    expect(arg.data.currentPeriodEnd).toBeInstanceOf(Date)
  })

  it('upgrades local tier when Stripe price id maps to a higher tier', async () => {
    mockSubEvent({ items: { data: [{ price: { id: 'price_pro_001' } }] } })
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      stripePriceId: 'price_core_001',
      store: { id: STORE_ID, tier: 'core', compTier: null, compExpiresAt: null },
    })
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })

    expect(applyTierChangeMock).toHaveBeenCalledOnce()
    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.storeId).toBe(STORE_ID)
    expect(call.fromTier).toBe('core')
    expect(call.data.tier).toBe('pro')
    expect(call.source).toBe('stripe_webhook')
  })

  it('auto-clears active comp when paid tier reaches it', async () => {
    mockSubEvent({ items: { data: [{ price: { id: 'price_pro_001' } }] } })
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      stripePriceId: 'price_core_001',
      store: {
        id: STORE_ID,
        tier: 'core',
        compTier: 'pro',
        compExpiresAt: new Date('2099-01-01'),
      },
    })
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })

    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.source).toBe('auto_cleared')
    expect(call.data.tier).toBe('pro')
    expect(call.data.compTier).toBeNull()
  })

  it('is a no-op when the Stripe price id does not map to a known tier', async () => {
    mockSubEvent({ items: { data: [{ price: { id: 'price_unknown_xxx' } }] } })
    // The early-return path means subRow lookup never runs.
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(applyTierChangeMock).not.toHaveBeenCalled()
  })

  it('is a no-op (no tier update, no log) when local tier already matches and no comp to clear', async () => {
    mockSubEvent()
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      stripePriceId: 'price_core_001',
      store: { id: STORE_ID, tier: 'core', compTier: null, compExpiresAt: null },
    })
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })

    expect(applyTierChangeMock).not.toHaveBeenCalled()
    // Still keeps stripePriceId cache fresh.
    expect(p.subscription.update).toHaveBeenCalled()
  })
})

// ---------- customer.subscription.deleted ----------

describe('webhook: customer.subscription.deleted', () => {
  it('marks the subscription canceled and cancelAtPeriodEnd=true', async () => {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: SUB_ID } },
    } as any)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(p.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: SUB_ID },
      data: { status: 'canceled', cancelAtPeriodEnd: true },
    })
    // NOTE: this handler does NOT call applyTierChange, so the local Store
    // keeps its paid tier even after cancellation. Pinning current behavior.
    expect(applyTierChangeMock).not.toHaveBeenCalled()
  })
})

// ---------- invoice.payment_failed ----------

describe('webhook: invoice.payment_failed', () => {
  function mockInvoiceEvent(overrides: Record<string, any> = {}) {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { subscription: SUB_ID, ...overrides } },
    } as any)
  }

  it('increments dunningAttempt and keeps status until attempt 3', async () => {
    mockInvoiceEvent()
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      dunningAttempt: 0,
      status: 'active',
      stripeCustomerId: CUSTOMER_ID,
      store: {
        client: {
          contactEmail: 'biller@example.com',
          memberships: [],
        },
      },
    })
    p.subscription.update.mockResolvedValue({})
    stripeMocks.billingPortal.sessions.create.mockResolvedValue({
      url: 'https://stripe.test/portal/abc',
    })

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)

    expect(p.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-row-1' },
      data: { dunningAttempt: 1, status: 'active' },
    })
    expect(sendDunningMock).toHaveBeenCalledWith(
      'biller@example.com',
      1,
      'https://stripe.test/portal/abc',
    )
  })

  it('flips status to past_due on the third failure', async () => {
    mockInvoiceEvent()
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      dunningAttempt: 2,
      status: 'active',
      stripeCustomerId: CUSTOMER_ID,
      store: { client: { contactEmail: 'b@x.test', memberships: [] } },
    })
    p.subscription.update.mockResolvedValue({})
    stripeMocks.billingPortal.sessions.create.mockResolvedValue({ url: 'p' })

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(p.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-row-1' },
      data: { dunningAttempt: 3, status: 'past_due' },
    })
  })

  it('uses member email when available, else falls back to client.contactEmail', async () => {
    mockInvoiceEvent()
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row-1',
      dunningAttempt: 0,
      status: 'active',
      stripeCustomerId: CUSTOMER_ID,
      store: {
        client: {
          contactEmail: 'fallback@example.com',
          memberships: [{ account: { email: 'member@example.com' } }],
        },
      },
    })
    p.subscription.update.mockResolvedValue({})
    stripeMocks.billingPortal.sessions.create.mockResolvedValue({ url: 'p' })

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })

    expect(sendDunningMock).toHaveBeenCalledWith('member@example.com', 1, 'p')
  })

  it('is a no-op when invoice has no subscription field', async () => {
    mockInvoiceEvent({ subscription: undefined })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(p.subscription.findUnique).not.toHaveBeenCalled()
    expect(sendDunningMock).not.toHaveBeenCalled()
  })

  it('is a no-op when local Subscription row is not found', async () => {
    mockInvoiceEvent()
    p.subscription.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(p.subscription.update).not.toHaveBeenCalled()
    expect(sendDunningMock).not.toHaveBeenCalled()
  })
})

// ---------- invoice.payment_succeeded ----------

describe('webhook: invoice.payment_succeeded', () => {
  it('resets dunningAttempt and marks active', async () => {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { subscription: SUB_ID } },
    } as any)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(p.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: SUB_ID },
      data: { dunningAttempt: 0, status: 'active' },
    })
  })

  it('is a no-op when invoice has no subscription field', async () => {
    stripeMocks.webhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { subscription: null } },
    } as any)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 's' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(200)
    expect(p.subscription.updateMany).not.toHaveBeenCalled()
  })
})

// ---------- POST /billing/checkout-session/confirm ----------

describe('POST /billing/checkout-session/confirm', () => {
  it('returns 400 for non-cs_ session ids', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session/confirm',
      payload: { sessionId: 'bogus' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid_session_id' })
  })

  it('returns 404 when Stripe session retrieve throws', async () => {
    stripeMocks.checkout.sessions.retrieve.mockRejectedValue(new Error('nope'))
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session/confirm',
      payload: { sessionId: 'cs_x' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'session_not_found' })
  })

  it('returns {status:pending,account:null} when the session has no subscription yet', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue({ id: 'cs_x', subscription: null } as any)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session/confirm',
      payload: { sessionId: 'cs_x' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'pending', account: null })
  })

  it('returns {status:provisioned, account:{...}} when the Subscription row already exists', async () => {
    stripeMocks.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_x',
      subscription: SUB_ID,
    } as any)
    p.subscription.findUnique.mockResolvedValue({
      id: 'sub-row',
      store: { client: { id: CLIENT_ID, companyName: 'Buyer Co' } },
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session/confirm',
      payload: { sessionId: 'cs_x' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      status: 'provisioned',
      account: { id: CLIENT_ID, name: 'Buyer Co' },
    })
  })
})

// ---------- GET /billing/portal ----------

describe('GET /billing/portal', () => {
  it('returns 401 when unauthenticated', async () => {
    setAuthed(false)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/portal' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when the client has no Stripe customer', async () => {
    p.subscription.findFirst.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/portal' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'no_stripe_customer' })
  })

  it('returns the portal URL on success and passes the right customer + return_url', async () => {
    p.subscription.findFirst.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID })
    stripeMocks.billingPortal.sessions.create.mockResolvedValue({ url: 'https://stripe.test/portal/x' })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/portal' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ url: 'https://stripe.test/portal/x' })
    expect(stripeMocks.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: CUSTOMER_ID,
      return_url: 'https://app.test/settings/billing',
    })
  })

  it('returns 502 when Stripe portal creation throws', async () => {
    p.subscription.findFirst.mockResolvedValue({ stripeCustomerId: CUSTOMER_ID })
    stripeMocks.billingPortal.sessions.create.mockRejectedValue(new Error('boom'))
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/portal' })
    expect(res.statusCode).toBe(502)
  })
})

// ---------- GET /billing/upgrade-from-comp ----------

describe('GET /billing/upgrade-from-comp', () => {
  it('returns 400 when store query param is missing', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/upgrade-from-comp' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'missing_store_param' })
  })

  it('302-redirects to /start when unauthenticated', async () => {
    setAuthed(false)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/billing/upgrade-from-comp?store=${STORE_ID}`,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('https://app.test/start?next=')
  })

  it('302-redirects to /account?upgrade=not_found when the store does not belong to the client', async () => {
    p.store.findFirst.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/billing/upgrade-from-comp?store=${STORE_ID}`,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.test/account?upgrade=not_found')
  })

  it('302-redirects to /account?upgrade=no_comp when the store has no comp', async () => {
    p.store.findFirst.mockResolvedValue({ id: STORE_ID, compTier: null, subscription: null })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/billing/upgrade-from-comp?store=${STORE_ID}`,
    })
    expect(res.headers.location).toBe('https://app.test/account?upgrade=no_comp')
  })

  it('Case A: swaps the subscription price when a sub already exists', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      compTier: 'pro',
      subscription: { stripeSubscriptionId: SUB_ID },
    })
    stripeMocks.subscriptions.retrieve.mockResolvedValue({
      id: SUB_ID,
      items: { data: [{ id: 'si_1' }] },
    } as any)
    stripeMocks.subscriptions.update.mockResolvedValue({} as any)

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/billing/upgrade-from-comp?store=${STORE_ID}`,
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://app.test/account?upgrade=success&tier=pro')
    expect(stripeMocks.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      items: [{ id: 'si_1', price: 'price_pro_001' }],
      proration_behavior: 'create_prorations',
    })
  })

  it('Case B: starts a fresh Checkout session when no sub exists', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      compTier: 'core',
      subscription: null,
    })
    stripeMocks.checkout.sessions.create.mockResolvedValue({
      id: 'cs_comp',
      url: 'https://stripe.test/co/comp',
    })

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/billing/upgrade-from-comp?store=${STORE_ID}`,
    })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toBe('https://stripe.test/co/comp')
    const args = stripeMocks.checkout.sessions.create.mock.calls[0][0]
    expect(args.metadata.source).toBe('upgrade_from_comp')
    expect(args.metadata.tier).toBe('core')
    expect(args.client_reference_id).toBe(CLIENT_ID)
  })

  it('redirects to unsupported_tier when the legacy comp is enterprise', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      compTier: 'enterprise',
      subscription: null,
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/billing/upgrade-from-comp?store=${STORE_ID}`,
    })
    expect(res.headers.location).toBe('https://app.test/account?upgrade=unsupported_tier')
  })
})

// ---------- GET /billing/upgrade ----------

describe('GET /billing/upgrade', () => {
  it('returns 400 on bad tier', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/upgrade?tier=lol' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_tier' })
  })

  it('302-redirects to /start when unauthenticated', async () => {
    setAuthed(false)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/upgrade?tier=core' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('https://app.test/start?next=')
  })

  it('redirects to not_found when no free store exists for the client', async () => {
    p.store.findFirst.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/upgrade?tier=core' })
    expect(res.headers.location).toBe('https://app.test/account?upgrade=not_found')
  })

  it('redirects to already_subscribed when the store already has a subscription', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      subscription: { id: 'sub-row' },
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/upgrade?tier=core' })
    expect(res.headers.location).toBe('https://app.test/account?upgrade=already_subscribed')
  })

  it('303-redirects to a fresh Stripe Checkout on the happy path (in_app_upgrade metadata)', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      subscription: null,
    })
    stripeMocks.checkout.sessions.create.mockResolvedValue({
      id: 'cs_up',
      url: 'https://stripe.test/co/up',
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({ method: 'GET', url: '/billing/upgrade?tier=pro' })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toBe('https://stripe.test/co/up')

    const args = stripeMocks.checkout.sessions.create.mock.calls[0][0]
    expect(args.line_items).toEqual([{ price: 'price_pro_001', quantity: 1 }])
    expect(args.metadata.source).toBe('in_app_upgrade')
    expect(args.metadata.storeId).toBe(STORE_ID)
    expect(args.client_reference_id).toBe(CLIENT_ID)
  })
})

// ---------- POST /billing/stores ----------

describe('POST /billing/stores', () => {
  it('returns 401 when unauthenticated', async () => {
    setAuthed(false)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stores',
      payload: { name: 'Second Store' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 on bad body (missing name)', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stores',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_body' })
  })

  it('returns 400 when the client has no existing store', async () => {
    p.store.findFirst.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stores',
      payload: { name: 'Second Store' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'no_existing_store' })
  })

  it('returns 400 when existing store has neither subscription nor comp', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'free',
      timezone: 'UTC',
      defaultOutcomeId: 'o',
      subscription: null,
      compTier: null,
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stores',
      payload: { name: 'Second' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'no_subscription_on_existing_store' })
  })

  it('happy path: bumps Stripe quantity by 1 and creates a sibling Store at the same tier', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'core',
      timezone: 'America/Denver',
      defaultOutcomeId: 'outcome-existing',
      subscription: { stripeSubscriptionId: SUB_ID },
      compTier: null,
    })
    stripeMocks.subscriptions.retrieve.mockResolvedValue({
      id: SUB_ID,
      items: { data: [{ id: 'si_1', quantity: 2 }] },
    } as any)
    stripeMocks.subscriptions.update.mockResolvedValue({} as any)
    p.store.create.mockResolvedValue({ id: 'store-new', slug: 'second-store-slug' })

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stores',
      payload: { name: 'Second Store' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ store: { id: 'store-new', slug: 'second-store-slug' } })

    expect(stripeMocks.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      items: [{ id: 'si_1', quantity: 3 }],
      proration_behavior: 'create_prorations',
    })
    // Inherits tier + tz from the existing store.
    const data = p.store.create.mock.calls[0][0].data
    expect(data.tier).toBe('core')
    expect(data.timezone).toBe('America/Denver')
    expect(data.clientId).toBe(CLIENT_ID)
  })

  it('comped path: skips Stripe quantity bump and propagates comp fields to the new Store', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'free',
      timezone: 'UTC',
      defaultOutcomeId: 'o',
      subscription: null,
      compTier: 'pro',
      compExpiresAt: new Date('2099-01-01'),
      compReason: 'pilot',
      compGrantedById: 'op-1',
      compGrantedAt: new Date('2026-01-01'),
    })
    p.store.create.mockResolvedValue({ id: 'store-new', slug: 'slug' })

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/stores',
      payload: { name: 'Second' },
    })
    expect(res.statusCode).toBe(200)
    expect(stripeMocks.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(stripeMocks.subscriptions.update).not.toHaveBeenCalled()

    const data = p.store.create.mock.calls[0][0].data
    expect(data.compTier).toBe('pro')
    expect(data.compReason).toBe('pilot')
    expect(data.compGrantedById).toBe('op-1')
  })
})

// ---------- POST /billing/pause ----------

describe('POST /billing/pause', () => {
  it('returns 401 when unauthenticated', async () => {
    setAuthed(false)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/pause',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 on bad body', async () => {
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/pause',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when the store does not belong to the client', async () => {
    p.store.findFirst.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/pause',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'store_not_found' })
  })

  it('returns 400 when the store has no subscription', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'core',
      compTier: null,
      compExpiresAt: null,
      subscription: null,
    })
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/pause',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'no_subscription' })
  })

  it('happy path: void-pauses Stripe, applyTierChange to free w/ pausedUntil, marks sub paused', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'core',
      compTier: null,
      compExpiresAt: null,
      subscription: { id: 'sub-row-1', stripeSubscriptionId: SUB_ID },
    })
    stripeMocks.subscriptions.update.mockResolvedValue({} as any)
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/pause',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.pausedUntil).toBe('string')

    expect(stripeMocks.subscriptions.update).toHaveBeenCalledWith(SUB_ID, {
      pause_collection: { behavior: 'void' },
    })

    expect(applyTierChangeMock).toHaveBeenCalledOnce()
    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.storeId).toBe(STORE_ID)
    expect(call.fromTier).toBe('core')
    expect(call.data.tier).toBe('free')
    expect(call.data.compTier).toBeNull()
    expect(call.source).toBe('pause')
    expect(call.data.pausedUntil).toBeInstanceOf(Date)

    expect(p.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-row-1' },
      data: { status: 'paused' },
    })
  })

  it('also clears active comp (reason mentions which comp was cleared)', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'core',
      compTier: 'pro',
      compExpiresAt: new Date('2099-01-01'),
      subscription: { id: 'sub-row-1', stripeSubscriptionId: SUB_ID },
    })
    stripeMocks.subscriptions.update.mockResolvedValue({} as any)
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    await app.inject({
      method: 'POST',
      url: '/billing/pause',
      payload: { storeId: STORE_ID },
    })

    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.fromTier).toBe('pro') // effective pre-pause (comp pro > paid core)
    expect(call.data.compTier).toBeNull()
    expect(call.reason).toMatch(/pause cleared active comp \(pro\)/)
  })
})

// ---------- POST /billing/resume ----------

describe('POST /billing/resume', () => {
  it('returns 401 when unauthenticated', async () => {
    setAuthed(false)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/resume',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when the store does not belong to the client', async () => {
    p.store.findFirst.mockResolvedValue(null)
    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/resume',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(404)
  })

  it('restores core tier when stripePriceId is the core price', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'free',
      compTier: null,
      compExpiresAt: null,
      subscription: {
        id: 'sub-row-1',
        stripeSubscriptionId: SUB_ID,
        stripePriceId: 'price_core_001',
      },
    })
    stripeMocks.subscriptions.update.mockResolvedValue({} as any)
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/resume',
      payload: { storeId: STORE_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, tier: 'core' })
    const call = applyTierChangeMock.mock.calls[0][0]
    expect(call.fromTier).toBe('free')
    expect(call.data.tier).toBe('core')
    expect(call.data.pausedUntil).toBeNull()
    expect(call.source).toBe('resume')
  })

  it('restores pro tier when stripePriceId is the pro price', async () => {
    p.store.findFirst.mockResolvedValue({
      id: STORE_ID,
      tier: 'free',
      compTier: null,
      compExpiresAt: null,
      subscription: {
        id: 'sub-row-1',
        stripeSubscriptionId: SUB_ID,
        stripePriceId: 'price_pro_001',
      },
    })
    stripeMocks.subscriptions.update.mockResolvedValue({} as any)
    p.subscription.update.mockResolvedValue({})

    const app = await buildTestApp(billingRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/billing/resume',
      payload: { storeId: STORE_ID },
    })
    expect(res.json().tier).toBe('pro')
  })
})
