import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// TST-2: the Boost trial-clock activation cron (runs daily 9am Mountain,
// registered in index.ts) had zero test references while every sibling cron
// (pauseAutoResume, compExpiry, lifecycleEmails) has one. A regression here
// silently mis-activates / mis-bills trials for days.
//
// Mirrors compExpiry.test.ts. The source calls:
//   prisma.store.findMany(...)                       — pending "waiting to generate" stores
//   prisma.$transaction([store.update, tierChangeLog.create])  — array form
// effectiveTier (from ./tier.js) is left REAL — it's a pure function over the
// selected {tier, compTier, compExpiresAt} fields and returns 'core' for a
// pending comp store, which is the fromTier the audit row should record.
vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    tierChangeLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops.map((op) => Promise.resolve(op)))),
  },
}))

import { runBoostTrialClockActivation } from './boostTrialClock.js'
import { prisma } from '../db.js'

const storeFindMany = prisma.store.findMany as unknown as ReturnType<typeof vi.fn>
const storeUpdate = prisma.store.update as unknown as ReturnType<typeof vi.fn>
const tierLogCreate = prisma.tierChangeLog.create as unknown as ReturnType<typeof vi.fn>
const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>

// Fixed "now" so the +30-day expiry boundary is deterministic.
const NOW = new Date('2026-05-18T12:00:00Z')
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const EXPECTED_EXPIRY = new Date(NOW.getTime() + THIRTY_DAYS_MS)

// Row factory matching the SELECT shape in boostTrialClock.ts.
interface PendingRow {
  id: string
  tier: string
  compTier: string | null
  compExpiresAt: Date | null
  icpLinks: Array<{ icp: { id: string; source: string; lineageRows: Array<{ id: string }> } }>
}

function makePending(overrides: Partial<PendingRow> = {}): PendingRow {
  return {
    id: 'store-1',
    tier: 'free',
    compTier: 'core',
    compExpiresAt: null,
    // Default: an onboarding ICP that HAS generated (one lineage row) → eligible.
    icpLinks: [{ icp: { id: 'icp-1', source: 'onboarding', lineageRows: [{ id: 'lin-1' }] } }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runBoostTrialClockActivation — activation', () => {
  it('starts the 30-day clock (sets compExpiresAt = now + 30d) + writes a boost_trial_activated audit row', async () => {
    storeFindMany.mockResolvedValueOnce([makePending({ id: 'store-activate' })])

    const stats = await runBoostTrialClockActivation()

    // One transaction, array form, exactly two operations.
    expect(txMock).toHaveBeenCalledTimes(1)
    const txArg = txMock.mock.calls[0]?.[0]
    expect(Array.isArray(txArg)).toBe(true)
    expect((txArg as unknown[]).length).toBe(2)

    // store.update sets the expiry to exactly now + 30 days.
    expect(storeUpdate).toHaveBeenCalledTimes(1)
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-activate' },
      data: { compExpiresAt: EXPECTED_EXPIRY },
    })

    // Audit row: from = effectiveTier ('core' — comp active, no expiry yet),
    // to = 'core', source = 'boost_trial_activated'.
    expect(tierLogCreate).toHaveBeenCalledTimes(1)
    const logArg = tierLogCreate.mock.calls[0]?.[0]
    expect(logArg.data.storeId).toBe('store-activate')
    expect(logArg.data.fromTier).toBe('core')
    expect(logArg.data.toTier).toBe('core')
    expect(logArg.data.source).toBe('boost_trial_activated')
    expect(logArg.data.expiresAt).toEqual(EXPECTED_EXPIRY)
    expect(logArg.data.reason).toMatch(/first generation detected for ICP icp-1/)

    expect(stats).toEqual({ considered: 1, activated: 1, skipped: 0, errors: 0 })
  })

  it('queries only pending trial stores (core comp, boost_trial_icp reason, no expiry, not archived)', async () => {
    storeFindMany.mockResolvedValueOnce([])

    await runBoostTrialClockActivation()

    const where = storeFindMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual({
      archivedAt: null,
      compTier: 'core',
      compReason: 'boost_trial_icp',
      compExpiresAt: null,
    })
  })
})

describe('runBoostTrialClockActivation — suppression / skips', () => {
  it('no-ops when there are no eligible stores', async () => {
    storeFindMany.mockResolvedValueOnce([])

    const stats = await runBoostTrialClockActivation()

    expect(txMock).not.toHaveBeenCalled()
    expect(storeUpdate).not.toHaveBeenCalled()
    expect(tierLogCreate).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 0, activated: 0, skipped: 0, errors: 0 })
  })

  it('does NOT double-activate: the compExpiresAt:null filter excludes already-activated stores', async () => {
    // Already-activated stores (compExpiresAt set) never come back from the
    // query, so a second sweep after activation is a no-op. Proven by the
    // where clause pinning compExpiresAt: null.
    storeFindMany.mockResolvedValueOnce([])

    await runBoostTrialClockActivation()

    expect(storeFindMany.mock.calls[0]?.[0]?.where.compExpiresAt).toBeNull()
    expect(txMock).not.toHaveBeenCalled()
  })

  it('skips (no activation) a store whose onboarding ICP has not generated yet (no lineage rows)', async () => {
    storeFindMany.mockResolvedValueOnce([
      makePending({
        id: 'store-not-generated',
        icpLinks: [{ icp: { id: 'icp-1', source: 'onboarding', lineageRows: [] } }],
      }),
    ])

    const stats = await runBoostTrialClockActivation()

    expect(txMock).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, activated: 0, skipped: 1, errors: 0 })
  })

  it('skips a store that has generated but only on a non-onboarding ICP', async () => {
    storeFindMany.mockResolvedValueOnce([
      makePending({
        id: 'store-wrong-source',
        icpLinks: [{ icp: { id: 'icp-manual', source: 'manual', lineageRows: [{ id: 'lin-1' }] } }],
      }),
    ])

    const stats = await runBoostTrialClockActivation()

    expect(txMock).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
    expect(stats.activated).toBe(0)
  })

  it('activates only the eligible store in a mixed batch and counts the rest as skipped', async () => {
    storeFindMany.mockResolvedValueOnce([
      makePending({ id: 'store-ready' }),
      makePending({ id: 'store-waiting', icpLinks: [{ icp: { id: 'icp-2', source: 'onboarding', lineageRows: [] } }] }),
    ])

    const stats = await runBoostTrialClockActivation()

    expect(txMock).toHaveBeenCalledTimes(1)
    expect(storeUpdate).toHaveBeenCalledWith({ where: { id: 'store-ready' }, data: { compExpiresAt: EXPECTED_EXPIRY } })
    expect(stats).toEqual({ considered: 2, activated: 1, skipped: 1, errors: 0 })
  })
})

describe('runBoostTrialClockActivation — error handling', () => {
  it('counts errors and does NOT throw when the transaction fails', async () => {
    storeFindMany.mockResolvedValueOnce([makePending({ id: 'store-tx-fails' })])
    txMock.mockRejectedValueOnce(new Error('db unavailable'))

    const stats = await runBoostTrialClockActivation()

    expect(stats).toEqual({ considered: 1, activated: 0, skipped: 0, errors: 1 })
  })
})
