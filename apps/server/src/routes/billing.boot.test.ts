// Boot-time test for billing.ts: importing and registering the plugin must
// succeed even when STRIPE_SECRET_KEY is unset. The eager `new Stripe('')`
// previously crashed module load, which broke local preview verification
// because /dev-login (and every other route) never got a chance to register.
//
// Lives in its own file (not billing.test.ts) so the env state is hermetic —
// billing.test.ts sets STRIPE_SECRET_KEY via vi.hoisted and would mask the
// regression we're guarding against.

import { describe, it, expect, vi } from 'vitest'

// Ensure STRIPE_SECRET_KEY is empty BEFORE ESM imports resolve. vi.hoisted
// runs before the import statements below.
vi.hoisted(() => {
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_PRICE_ID_CORE
  delete process.env.STRIPE_PRICE_ID_PRO
})

// Mock Prisma so the import chain doesn't try to open a real DB connection.
vi.mock('../db.js', () => ({
  prisma: {
    account: { findUnique: vi.fn(), create: vi.fn() },
    client: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    clientMembership: { create: vi.fn() },
    store: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    subscription: {
      findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(),
    },
    tierChangeLog: { create: vi.fn() },
  },
}))

// Real Stripe SDK — we WANT to exercise its real constructor behavior so this
// test would fail (with "Neither apiKey nor config.authenticator provided")
// against the pre-fix eager init.

import Fastify from 'fastify'
import { billingRoutes } from './billing.js'

describe('billing.ts boots without STRIPE_SECRET_KEY', () => {
  it('imports and registers cleanly when the key is unset', async () => {
    expect(process.env.STRIPE_SECRET_KEY ?? '').toBe('')

    const app = Fastify({ logger: false })
    await expect(app.register(billingRoutes)).resolves.not.toThrow()
    await expect(app.ready()).resolves.not.toThrow()
    await app.close()
  })

  it('billing requests fail at request time (not at module load) when key is missing', async () => {
    // The request handler will try to call Stripe and the lazy getter will
    // throw. Fastify catches that and turns it into a 500. The point is that
    // the SERVER is up and able to respond — other routes (auth, dev-login,
    // admin, etc.) are unaffected.
    const app = Fastify({ logger: false })
    await app.register(billingRoutes)
    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      payload: { tier: 'core', email: 'buyer@example.com' },
    })
    // Either a 500 from the lazy getter throw, or a 502 if Stripe somehow
    // returned an error. Anything that's NOT a process crash is acceptable
    // — the point is the server is alive enough to answer.
    expect([500, 502]).toContain(res.statusCode)

    await app.close()
  })
})
