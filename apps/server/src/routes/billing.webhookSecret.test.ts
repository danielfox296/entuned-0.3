// SEC-1 regression: the Stripe webhook must fail CLOSED when
// STRIPE_WEBHOOK_SECRET is empty. HMAC verification against an empty key is
// forgeable, so an unset secret must refuse the request instead of trusting it.
//
// This lives in its own file because `billing.ts` captures STRIPE_WEBHOOK_SECRET
// into a module-level const at import time. The main billing.test.ts sets the
// secret non-empty (via vi.hoisted) for every other webhook test, so the
// empty-secret path can only be exercised from a module registry where the env
// var is empty before import — i.e. a separate test file. (STRIPE_SECRET_KEY is
// also left empty here, proving the plugin still imports without it.)

import { describe, it, expect, vi } from 'vitest'

// Empty Stripe env BEFORE billing.ts is imported (ESM import hoisting — see
// TESTING.md "ESM hoisting and process.env").
vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = ''
  process.env.STRIPE_WEBHOOK_SECRET = ''
})

// constructEvent is a spy we assert is NEVER reached — the guard returns first.
const stripeMocks = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
}))
vi.mock('stripe', () => {
  class StripeMock {
    webhooks = stripeMocks.webhooks
    constructor(_key: string, _opts?: unknown) {}
  }
  return { default: StripeMock }
})

vi.mock('../db.js', () => ({ prisma: {} }))
vi.mock('../lib/session.js', () => ({
  requireAuth: vi.fn(async () => undefined),
}))
vi.mock('../lib/email.js', () => ({
  sendWelcome: vi.fn(async () => undefined),
  sendDunning: vi.fn(async () => undefined),
}))
vi.mock('../lib/account.js', () => ({ uniqueStoreSlug: vi.fn(async () => 'slug') }))
vi.mock('../lib/outcomes.js', () => ({ pickSystemDefaultOutcomeId: vi.fn(async () => 'oid') }))
vi.mock('../lib/tier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tier.js')>()
  return { ...actual, applyTierChange: vi.fn(async () => undefined) }
})

import Fastify, { type FastifyInstance } from 'fastify'
import { billingRoutes } from './billing.js'

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(billingRoutes)
  await app.ready()
  return app
}

describe('POST /webhooks/stripe — empty STRIPE_WEBHOOK_SECRET (SEC-1)', () => {
  it('refuses to process the webhook (500) and never calls constructEvent', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        // A present (but here irrelevant) signature header — proves we bail on
        // the empty secret, not on a missing signature.
        'stripe-signature': 't=1,v1=deadbeef',
      },
      payload: '{"id":"evt_forged","type":"checkout.session.completed"}',
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'webhook_not_configured' })
    expect(stripeMocks.webhooks.constructEvent).not.toHaveBeenCalled()
  })
})
