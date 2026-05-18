import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ────────────────────────────────────────────────────────────────────────
// Mocks
//
// `pauseAutoResume.ts` captures STRIPE_SECRET_KEY and STRIPE_PRICE_ID_PRO
// at module-load time. To test both code paths (no-Stripe dev path and
// Stripe-configured prod path) we use dynamic imports under
// `vi.resetModules()` and set `process.env` before each import.
//
// `vi.mock` is hoisted to the top of the file, so the mocks below apply
// to every import (static or dynamic) of these modules.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findMany: vi.fn(),
    },
    subscription: {
      update: vi.fn(),
    },
  },
}))

vi.mock('./tier.js', () => ({
  effectiveTier: vi.fn(),
  applyTierChange: vi.fn(),
}))

// Stripe is a default-exported class. The class instance must expose
// `.subscriptions.update(...)` since that's what the cron calls. Use
// `vi.fn().mockImplementation(function() { ... })` so the mock is a
// constructor (callable with `new`).
const stripeSubscriptionsUpdate = vi.fn()
const stripeCtor = vi.fn()
stripeCtor.mockImplementation(function (this: { subscriptions: unknown }) {
  this.subscriptions = { update: stripeSubscriptionsUpdate }
})

vi.mock('stripe', () => ({
  default: stripeCtor,
}))

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

type RunFn = () => Promise<{
  considered: number
  resumed: number
  skipped: number
  errors: number
}>

interface ImportedModule {
  runPauseAutoResume: RunFn
  prisma: {
    store: { findMany: ReturnType<typeof vi.fn> }
    subscription: { update: ReturnType<typeof vi.fn> }
  }
  tier: {
    effectiveTier: ReturnType<typeof vi.fn>
    applyTierChange: ReturnType<typeof vi.fn>
  }
}

/**
 * Import the module under test fresh. Sets up env vars first so the
 * module's top-level constants capture the values we want.
 */
async function importFresh(env: {
  STRIPE_SECRET_KEY?: string
  STRIPE_PRICE_ID_PRO?: string
}): Promise<ImportedModule> {
  vi.resetModules()
  // Re-apply env via process.env. The module reads `process.env.X ?? ''` at
  // load time, so we set/unset directly.
  if (env.STRIPE_SECRET_KEY === undefined) {
    delete process.env.STRIPE_SECRET_KEY
  } else {
    process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY
  }
  if (env.STRIPE_PRICE_ID_PRO === undefined) {
    delete process.env.STRIPE_PRICE_ID_PRO
  } else {
    process.env.STRIPE_PRICE_ID_PRO = env.STRIPE_PRICE_ID_PRO
  }

  const mod = await import('./pauseAutoResume.js')
  const dbMod = await import('../db.js')
  const tierMod = await import('./tier.js')
  return {
    runPauseAutoResume: mod.runPauseAutoResume,
    prisma: (dbMod as unknown as { prisma: ImportedModule['prisma'] }).prisma,
    tier: tierMod as unknown as ImportedModule['tier'],
  }
}

/** Build a Store row in the shape the cron's findMany returns
 * (with `subscription` included). Only fields the cron reads matter. */
function makeStoreRow(overrides: {
  id?: string
  tier?: string
  compTier?: string | null
  compExpiresAt?: Date | null
  pausedUntil?: Date | null
  subscription?: {
    id: string
    stripeSubscriptionId: string
    stripePriceId: string
    status?: string
  } | null
} = {}) {
  return {
    id: overrides.id ?? 'store-1',
    tier: overrides.tier ?? 'core',
    compTier: overrides.compTier ?? null,
    compExpiresAt: overrides.compExpiresAt ?? null,
    pausedUntil: overrides.pausedUntil ?? new Date('2026-04-01T00:00:00Z'),
    subscription:
      overrides.subscription === undefined
        ? {
            id: 'sub-1',
            stripeSubscriptionId: 'stripe_sub_1',
            stripePriceId: 'price_core_xyz',
            status: 'paused',
          }
        : overrides.subscription,
  }
}

// A fixed "now" used across tests via fake timers.
const NOW = new Date('2026-05-18T17:00:00Z')

beforeEach(() => {
  // Reset (not just clear) so that any `.mockResolvedValueOnce` queue from a
  // prior test cannot leak into the next via the shared Stripe ctor / inner
  // mock instances.
  vi.resetAllMocks()
  // After resetAllMocks, re-arm the Stripe ctor (it has no module-factory
  // re-run; it's a top-level constant).
  stripeCtor.mockImplementation(function (this: { subscriptions: unknown }) {
    this.subscriptions = { update: stripeSubscriptionsUpdate }
  })
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ════════════════════════════════════════════════════════════════════════
// No-Stripe path (dev / unconfigured)
// ════════════════════════════════════════════════════════════════════════

describe('runPauseAutoResume — no STRIPE_SECRET_KEY (dev path)', () => {
  it('returns zero stats and does not query when no env is set and findMany returns []', async () => {
    const m = await importFresh({})
    m.prisma.store.findMany.mockResolvedValue([])

    const stats = await m.runPauseAutoResume()

    expect(stats).toEqual({ considered: 0, resumed: 0, skipped: 0, errors: 0 })
    expect(m.tier.applyTierChange).not.toHaveBeenCalled()
    expect(m.prisma.subscription.update).not.toHaveBeenCalled()
    expect(stripeCtor).not.toHaveBeenCalled()
  })

  it('queries Prisma with archivedAt:null, pausedUntil <= now, subscription not null', async () => {
    const m = await importFresh({})
    m.prisma.store.findMany.mockResolvedValue([])

    await m.runPauseAutoResume()

    const call = m.prisma.store.findMany.mock.calls[0]?.[0]
    expect(call?.where).toEqual({
      archivedAt: null,
      pausedUntil: { not: null, lte: NOW },
      subscription: { isNot: null },
    })
    expect(call?.include).toEqual({ subscription: true })
  })

  it('resumes a store with pausedUntil in the past (dev path: no Stripe call)', async () => {
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    const past = new Date(NOW.getTime() - 24 * 60 * 60 * 1000) // 1 day ago
    const store = makeStoreRow({ pausedUntil: past })
    m.prisma.store.findMany.mockResolvedValue([store])

    const stats = await m.runPauseAutoResume()

    expect(stats.resumed).toBe(1)
    expect(stats.considered).toBe(1)
    expect(stats.skipped).toBe(0)
    expect(stats.errors).toBe(0)
    // Stripe must NOT be constructed or called in the dev path.
    expect(stripeCtor).not.toHaveBeenCalled()
    expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('flips Subscription.status to "active" after resume (dev path)', async () => {
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    await m.runPauseAutoResume()

    expect(m.prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'active' },
    })
  })

  it('calls applyTierChange with source="resume", pausedUntil:null, tier:"core" when subscription is on a non-pro price', async () => {
    const m = await importFresh({ STRIPE_PRICE_ID_PRO: 'price_pro_id' })
    m.tier.effectiveTier.mockReturnValue('free')
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({
        subscription: {
          id: 'sub-x',
          stripeSubscriptionId: 'sub_x',
          stripePriceId: 'price_core_zzz', // not the pro price
        },
      }),
    ])

    await m.runPauseAutoResume()

    expect(m.tier.applyTierChange).toHaveBeenCalledWith({
      storeId: 'store-1',
      fromTier: 'free',
      data: { pausedUntil: null, tier: 'core' },
      source: 'resume',
      actorId: null,
      reason: 'auto-resume cron (pause window expired)',
    })
  })

  it('restores tier="pro" when subscription stripePriceId === STRIPE_PRICE_ID_PRO (dev path)', async () => {
    const m = await importFresh({ STRIPE_PRICE_ID_PRO: 'price_pro_real' })
    m.tier.effectiveTier.mockReturnValue('free')
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({
        subscription: {
          id: 'sub-pro',
          stripeSubscriptionId: 'sub_pro',
          stripePriceId: 'price_pro_real',
        },
      }),
    ])

    await m.runPauseAutoResume()

    const call = m.tier.applyTierChange.mock.calls[0]?.[0]
    expect(call?.data).toEqual({ pausedUntil: null, tier: 'pro' })
  })

  it('restores tier="core" when STRIPE_PRICE_ID_PRO is unset (empty string) even if priceId is non-empty', async () => {
    // Source contract: STRIPE_PRICE_ID_PRO defaults to '' when unset. A
    // subscription with stripePriceId='' would equal it (edge case), but
    // any real priceId !== '' so it falls into the 'core' branch.
    const m = await importFresh({}) // no STRIPE_PRICE_ID_PRO
    m.tier.effectiveTier.mockReturnValue('free')
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({
        subscription: {
          id: 'sub-1',
          stripeSubscriptionId: 'sub_1',
          stripePriceId: 'price_anything_real',
        },
      }),
    ])

    await m.runPauseAutoResume()

    const call = m.tier.applyTierChange.mock.calls[0]?.[0]
    expect(call?.data).toEqual({ pausedUntil: null, tier: 'core' })
  })

  it('skips (does not resume) when subscription is null on the row', async () => {
    // The Prisma `where` clause filters these out in production, but the
    // cron has a defensive `if (!s.subscription) { stats.skipped++; continue }`.
    const m = await importFresh({})
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow({ subscription: null })])

    const stats = await m.runPauseAutoResume()

    expect(stats.considered).toBe(1)
    expect(stats.skipped).toBe(1)
    expect(stats.resumed).toBe(0)
    expect(m.tier.applyTierChange).not.toHaveBeenCalled()
    expect(m.prisma.subscription.update).not.toHaveBeenCalled()
  })

  it('counts errors=1 and resumed=0 when applyTierChange throws', async () => {
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    m.tier.applyTierChange.mockRejectedValue(new Error('db down'))
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    const stats = await m.runPauseAutoResume()

    expect(stats.errors).toBe(1)
    expect(stats.resumed).toBe(0)
    expect(stats.considered).toBe(1)
  })

  it('continues to next store after one errors (does not abort the whole run)', async () => {
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    // First call throws, second succeeds.
    m.tier.applyTierChange
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({})
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({ id: 'store-fail' }),
      makeStoreRow({ id: 'store-ok' }),
    ])

    const stats = await m.runPauseAutoResume()

    expect(stats.considered).toBe(2)
    expect(stats.errors).toBe(1)
    expect(stats.resumed).toBe(1)
  })

  it('handles multiple paused stores in one run', async () => {
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({ id: 'a', subscription: { id: 'sub-a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_core' } }),
      makeStoreRow({ id: 'b', subscription: { id: 'sub-b', stripeSubscriptionId: 'sub_b', stripePriceId: 'price_core' } }),
      makeStoreRow({ id: 'c', subscription: { id: 'sub-c', stripeSubscriptionId: 'sub_c', stripePriceId: 'price_core' } }),
    ])

    const stats = await m.runPauseAutoResume()

    expect(stats).toEqual({ considered: 3, resumed: 3, skipped: 0, errors: 0 })
    expect(m.tier.applyTierChange).toHaveBeenCalledTimes(3)
    expect(m.prisma.subscription.update).toHaveBeenCalledTimes(3)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Stripe-configured path (prod)
// ════════════════════════════════════════════════════════════════════════

describe('runPauseAutoResume — STRIPE_SECRET_KEY configured (prod path)', () => {
  it('constructs the Stripe client lazily only when there is work to do', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.prisma.store.findMany.mockResolvedValue([]) // no work

    await m.runPauseAutoResume()

    // No paused stores → Stripe constructor must not run.
    expect(stripeCtor).not.toHaveBeenCalled()
  })

  it('constructs the Stripe client when there are stores to resume', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_live_abc' })
    m.tier.effectiveTier.mockReturnValue('core')
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    await m.runPauseAutoResume()

    expect(stripeCtor).toHaveBeenCalledTimes(1)
    expect(stripeCtor).toHaveBeenCalledWith('sk_live_abc', expect.objectContaining({
      apiVersion: '2024-06-20',
    }))
  })

  it('calls stripe.subscriptions.update with pause_collection cleared', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.tier.effectiveTier.mockReturnValue('core')
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    await m.runPauseAutoResume()

    expect(stripeSubscriptionsUpdate).toHaveBeenCalledWith('stripe_sub_1', {
      pause_collection: '',
    })
  })

  it('calls Stripe BEFORE applyTierChange BEFORE subscription.update (ordering)', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.tier.effectiveTier.mockReturnValue('core')
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])
    const order: string[] = []
    stripeSubscriptionsUpdate.mockImplementation(async () => {
      order.push('stripe')
      return {}
    })
    m.tier.applyTierChange.mockImplementation(async () => {
      order.push('applyTierChange')
      return {}
    })
    m.prisma.subscription.update.mockImplementation(async () => {
      order.push('sub.update')
      return {}
    })

    await m.runPauseAutoResume()

    expect(order).toEqual(['stripe', 'applyTierChange', 'sub.update'])
  })

  it('counts errors=1 when Stripe call throws (and does NOT call applyTierChange or sub.update)', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.tier.effectiveTier.mockReturnValue('core')
    stripeSubscriptionsUpdate.mockRejectedValue(new Error('stripe 500'))
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    const stats = await m.runPauseAutoResume()

    expect(stats.errors).toBe(1)
    expect(stats.resumed).toBe(0)
    expect(m.tier.applyTierChange).not.toHaveBeenCalled()
    expect(m.prisma.subscription.update).not.toHaveBeenCalled()
  })

  it('counts errors=1 when applyTierChange throws after Stripe success (sub.update is NOT called)', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.tier.effectiveTier.mockReturnValue('core')
    stripeSubscriptionsUpdate.mockResolvedValue({})
    m.tier.applyTierChange.mockRejectedValue(new Error('db down'))
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    const stats = await m.runPauseAutoResume()

    expect(stats.errors).toBe(1)
    expect(stats.resumed).toBe(0)
    expect(stripeSubscriptionsUpdate).toHaveBeenCalledTimes(1)
    expect(m.prisma.subscription.update).not.toHaveBeenCalled()
  })

  it('continues to next store after one Stripe call errors', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.tier.effectiveTier.mockReturnValue('core')
    stripeSubscriptionsUpdate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({})
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({ id: 'fail', subscription: { id: 'sub-f', stripeSubscriptionId: 'sub_f', stripePriceId: 'price_core' } }),
      makeStoreRow({ id: 'ok', subscription: { id: 'sub-o', stripeSubscriptionId: 'sub_o', stripePriceId: 'price_core' } }),
    ])

    const stats = await m.runPauseAutoResume()

    expect(stats.considered).toBe(2)
    expect(stats.errors).toBe(1)
    expect(stats.resumed).toBe(1)
  })

  it('restores tier="pro" via Stripe path when stripePriceId matches STRIPE_PRICE_ID_PRO', async () => {
    const m = await importFresh({
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_PRICE_ID_PRO: 'price_pro_match',
    })
    m.tier.effectiveTier.mockReturnValue('free')
    m.prisma.store.findMany.mockResolvedValue([
      makeStoreRow({
        subscription: {
          id: 'sub-p',
          stripeSubscriptionId: 'sub_p',
          stripePriceId: 'price_pro_match',
        },
      }),
    ])

    await m.runPauseAutoResume()

    expect(m.tier.applyTierChange.mock.calls[0]?.[0]?.data).toEqual({
      pausedUntil: null,
      tier: 'pro',
    })
  })

  it('skips subscription:null rows without calling Stripe', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow({ subscription: null })])

    const stats = await m.runPauseAutoResume()

    expect(stats.skipped).toBe(1)
    expect(stats.resumed).toBe(0)
    expect(stripeSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('passes effectiveTier(store) as fromTier to applyTierChange', async () => {
    const m = await importFresh({ STRIPE_SECRET_KEY: 'sk_test_123' })
    m.tier.effectiveTier.mockReturnValue('enterprise')
    m.prisma.store.findMany.mockResolvedValue([makeStoreRow()])

    await m.runPauseAutoResume()

    expect(m.tier.effectiveTier).toHaveBeenCalled()
    expect(m.tier.applyTierChange.mock.calls[0]?.[0]?.fromTier).toBe('enterprise')
  })
})

// ════════════════════════════════════════════════════════════════════════
// Boundary / convention tests
// ════════════════════════════════════════════════════════════════════════

describe('runPauseAutoResume — pausedUntil boundary convention', () => {
  // The cron's Prisma where clause uses `pausedUntil: { lte: now }` —
  // inclusive on the equals side. This is OPPOSITE to outcomeSchedule's
  // exclusive-end convention. We pin this contract here so an accidental
  // change to `lt:` is caught.

  it('uses inclusive comparison: pausedUntil { lte: now }', async () => {
    const m = await importFresh({})
    m.prisma.store.findMany.mockResolvedValue([])

    await m.runPauseAutoResume()

    const where = m.prisma.store.findMany.mock.calls[0]?.[0]?.where
    expect(where?.pausedUntil).toEqual({ not: null, lte: NOW })
  })

  it('passes the current Date() to the query (uses real-time, not a captured constant)', async () => {
    const m = await importFresh({})
    m.prisma.store.findMany.mockResolvedValue([])

    // Run once at NOW.
    await m.runPauseAutoResume()
    const firstNow = (m.prisma.store.findMany.mock.calls[0]?.[0]?.where as { pausedUntil: { lte: Date } }).pausedUntil.lte

    // Advance time by 1 hour and run again.
    vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000))
    await m.runPauseAutoResume()
    const secondNow = (m.prisma.store.findMany.mock.calls[1]?.[0]?.where as { pausedUntil: { lte: Date } }).pausedUntil.lte

    expect(secondNow.getTime()).toBeGreaterThan(firstNow.getTime())
    expect(secondNow.getTime() - firstNow.getTime()).toBe(60 * 60 * 1000)
  })

  it('relies on Prisma to filter pausedUntil — does not re-check in app code', async () => {
    // If a row sneaks through (e.g. pausedUntil in the future), the cron
    // will still resume it because the filtering is delegated to the DB.
    // This is a contract test: the cron trusts its query.
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    const futureStore = makeStoreRow({
      pausedUntil: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    })
    m.prisma.store.findMany.mockResolvedValue([futureStore])

    const stats = await m.runPauseAutoResume()

    expect(stats.resumed).toBe(1)
    expect(stats.considered).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Idempotency
// ════════════════════════════════════════════════════════════════════════

describe('runPauseAutoResume — idempotency', () => {
  it('second run with empty findMany returns zero stats (no double-resume)', async () => {
    const m = await importFresh({})
    m.tier.effectiveTier.mockReturnValue('core')
    // First run: one paused store; resumes it.
    m.prisma.store.findMany.mockResolvedValueOnce([makeStoreRow()])
    // Second run: query returns [] (the row's pausedUntil was nulled).
    m.prisma.store.findMany.mockResolvedValueOnce([])

    const stats1 = await m.runPauseAutoResume()
    const stats2 = await m.runPauseAutoResume()

    expect(stats1.resumed).toBe(1)
    expect(stats2).toEqual({ considered: 0, resumed: 0, skipped: 0, errors: 0 })
    // applyTierChange was called once total.
    expect(m.tier.applyTierChange).toHaveBeenCalledTimes(1)
  })
})
