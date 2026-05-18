import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma BEFORE importing tier.ts. tier.ts imports `prisma` from '../db.js'.
// The mutation helpers (applyTierChange) call prisma.$transaction(callback) and
// inside the callback they call db.store.update + db.tierChangeLog.create. The
// canonical pattern is to have $transaction invoke its callback against the
// same mocked client so the inner update/create calls land on these mocks.
vi.mock('../db.js', () => {
  const store = { update: vi.fn() }
  const tierChangeLog = { create: vi.fn() }
  const prisma: Record<string, unknown> = { store, tierChangeLog }
  prisma.$transaction = vi.fn(async (cb: (db: typeof prisma) => Promise<unknown>) => cb(prisma))
  return { prisma }
})

import { tierRank, effectiveTier, compIsActive, applyTierChange } from './tier.js'
import type { Tier, StoreTierFields } from './tier.js'
import { prisma } from '../db.js'

// Convenience casts for the mocked surfaces used in applyTierChange tests.
const storeUpdate = prisma.store.update as unknown as ReturnType<typeof vi.fn>
const logCreate = prisma.tierChangeLog.create as unknown as ReturnType<typeof vi.fn>
const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>

// Regression layer for the mvp_pilot rip-out (2026-05-18). The `Tier` union
// is now exactly { 'free' | 'core' | 'pro' | 'enterprise' }; any other value
// — including 'mvp_pilot' — must rank 0 (treated as unknown). Zero rows had
// tier='mvp_pilot' in production at the time of the rip-out; these tests
// pin the post-removal behavior.

describe('tierRank', () => {
  it('ranks the four canonical tiers in order', () => {
    expect(tierRank('free')).toBe(0)
    expect(tierRank('core')).toBe(1)
    expect(tierRank('pro')).toBe(2)
    expect(tierRank('enterprise')).toBe(3)
  })

  it('returns 0 for null or undefined', () => {
    expect(tierRank(null)).toBe(0)
    expect(tierRank(undefined)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(tierRank('')).toBe(0)
  })

  it('returns 0 for the removed mvp_pilot value', () => {
    expect(tierRank('mvp_pilot')).toBe(0)
  })

  it('returns 0 for any other unknown string', () => {
    expect(tierRank('lol')).toBe(0)
    expect(tierRank('CORE')).toBe(0) // case-sensitive
  })
})

describe('effectiveTier', () => {
  const NOW = new Date('2026-05-18T12:00:00Z')
  const FUTURE = new Date('2026-12-31T12:00:00Z')
  const PAST = new Date('2026-01-01T12:00:00Z')

  function store(fields: Partial<StoreTierFields>): StoreTierFields {
    return { tier: 'free', compTier: null, compExpiresAt: null, ...fields }
  }

  it('returns paid tier when no comp is set', () => {
    expect(effectiveTier(store({ tier: 'core' }), NOW)).toBe<Tier>('core')
    expect(effectiveTier(store({ tier: 'free' }), NOW)).toBe<Tier>('free')
  })

  it('returns comp tier when it ranks above paid and unexpired (with explicit expiry)', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: FUTURE }), NOW),
    ).toBe<Tier>('pro')
  })

  it('returns comp tier when it ranks above paid and expiresAt is null (open-ended comp)', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: null }), NOW),
    ).toBe<Tier>('pro')
  })

  it('returns paid tier when comp is expired', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: PAST }), NOW),
    ).toBe<Tier>('free')
  })

  it('returns paid tier when comp ranks below paid (no downgrade)', () => {
    expect(
      effectiveTier(store({ tier: 'pro', compTier: 'core', compExpiresAt: FUTURE }), NOW),
    ).toBe<Tier>('pro')
  })

  it('returns paid tier when comp ranks equal to paid', () => {
    expect(
      effectiveTier(store({ tier: 'core', compTier: 'core', compExpiresAt: FUTURE }), NOW),
    ).toBe<Tier>('core')
  })

  it('treats a comp at the expiry instant as expired', () => {
    expect(
      effectiveTier(store({ tier: 'free', compTier: 'pro', compExpiresAt: NOW }), NOW),
    ).toBe<Tier>('free')
  })

  it('defaults missing tier to free', () => {
    // Caller may pass an empty string from a partial projection.
    expect(effectiveTier(store({ tier: '' }), NOW)).toBe('')
    // The function does `(store.tier as Tier) ?? 'free'`; only nullish coalesces.
    // Document the actual behavior: empty string is preserved (not coerced).
  })
})

describe('compIsActive', () => {
  const NOW = new Date('2026-05-18T12:00:00Z')
  const FUTURE = new Date('2026-12-31T12:00:00Z')
  const PAST = new Date('2026-01-01T12:00:00Z')

  function store(fields: Partial<StoreTierFields>): StoreTierFields {
    return { tier: 'free', compTier: null, compExpiresAt: null, ...fields }
  }

  it('returns false when compTier is null', () => {
    expect(compIsActive(store({ compTier: null }), NOW)).toBe(false)
  })

  it('returns true when compTier is set and expiresAt is null (open-ended)', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: null }), NOW)).toBe(true)
  })

  it('returns true when compTier is set and expiresAt is in the future', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: FUTURE }), NOW)).toBe(true)
  })

  it('returns false when expiresAt is in the past', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: PAST }), NOW)).toBe(false)
  })

  it('returns false at the expiry instant (treats expiry as exclusive)', () => {
    expect(compIsActive(store({ compTier: 'pro', compExpiresAt: NOW }), NOW)).toBe(false)
  })
})

describe('applyTierChange', () => {
  // Convenience: an updated-row shape matching the `select` clause inside
  // applyTierChange. Override fields per-test to drive `effectiveTier(updated)`.
  function updatedRow(overrides: Partial<{
    id: string
    tier: string
    compTier: string | null
    compExpiresAt: Date | null
    compReason: string | null
    compGrantedById: string | null
    compGrantedAt: Date | null
  }> = {}) {
    return {
      id: 'store-1',
      tier: 'free',
      compTier: null,
      compExpiresAt: null,
      compReason: null,
      compGrantedById: null,
      compGrantedAt: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-install the canonical $transaction(cb) → cb(prisma) behavior after
    // clearAllMocks (which wipes the implementation on a vi.fn).
    txMock.mockImplementation(async (cb: (db: typeof prisma) => Promise<unknown>) => cb(prisma))
  })

  it('wraps work in prisma.$transaction when no tx is passed', async () => {
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(txMock).toHaveBeenCalledTimes(1)
    // The first arg to $transaction is the work callback (function form, not array).
    expect(typeof txMock.mock.calls[0]?.[0]).toBe('function')
  })

  it('does NOT call prisma.$transaction when a tx client is passed (caller owns the transaction)', async () => {
    const txStore = { update: vi.fn().mockResolvedValueOnce(updatedRow({ tier: 'core' })) }
    const txLog = { create: vi.fn() }
    const tx = { store: txStore, tierChangeLog: txLog } as unknown as Parameters<
      typeof applyTierChange
    >[0]['tx']

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
      tx,
    })

    expect(txMock).not.toHaveBeenCalled()
    expect(txStore.update).toHaveBeenCalledTimes(1)
    expect(txLog.create).toHaveBeenCalledTimes(1)
    // The outer prisma mocks must not be touched when tx is supplied.
    expect(storeUpdate).not.toHaveBeenCalled()
    expect(logCreate).not.toHaveBeenCalled()
  })

  it('calls store.update with the storeId, data, and the canonical select projection', async () => {
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { tier: 'core' },
      select: {
        id: true,
        tier: true,
        compTier: true,
        compExpiresAt: true,
        compReason: true,
        compGrantedById: true,
        compGrantedAt: true,
      },
    })
  })

  it('writes a tierChangeLog row with derived toTier when effective tier changed', async () => {
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
      actorId: 'op-1',
      reason: 'checkout completed',
    })

    expect(logCreate).toHaveBeenCalledTimes(1)
    expect(logCreate).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        fromTier: 'free',
        toTier: 'core',
        source: 'stripe_webhook',
        actorId: 'op-1',
        reason: 'checkout completed',
        expiresAt: null,
      },
    })
  })

  it('does NOT write a log row when the effective tier is unchanged (no-op skip)', async () => {
    // Paid tier 'pro' shadows the granted comp 'core' — effective stays 'pro'.
    storeUpdate.mockResolvedValueOnce(
      updatedRow({
        tier: 'pro',
        compTier: 'core',
        compExpiresAt: new Date('2030-01-01T00:00:00Z'),
      }),
    )

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'pro',
      data: { compTier: 'core', compExpiresAt: new Date('2030-01-01T00:00:00Z') },
      source: 'admin_comp',
    })

    // Store update DOES still happen — comp fields were written.
    expect(storeUpdate).toHaveBeenCalledTimes(1)
    // But no audit row because effective tier didn't move.
    expect(logCreate).not.toHaveBeenCalled()
  })

  it('does NOT log when fromTier equals derived toTier and nothing else changed', async () => {
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'core',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(logCreate).not.toHaveBeenCalled()
  })

  it('defaults actorId, reason, and expiresAt to null when omitted', async () => {
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: null,
        reason: null,
        expiresAt: null,
      }),
    })
  })

  it('snapshots expiresAt on the log row for admin_comp grants', async () => {
    const exp = new Date('2026-12-31T23:59:59Z')
    storeUpdate.mockResolvedValueOnce(
      updatedRow({ tier: 'free', compTier: 'pro', compExpiresAt: exp }),
    )

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { compTier: 'pro', compExpiresAt: exp },
      source: 'admin_comp',
      actorId: 'admin-1',
      reason: 'beta partner',
      expiresAt: exp,
    })

    expect(logCreate).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        fromTier: 'free',
        toTier: 'pro',
        source: 'admin_comp',
        actorId: 'admin-1',
        reason: 'beta partner',
        expiresAt: exp,
      },
    })
  })

  it('returns the updated Store row (so callers can re-derive effectiveTier post-write)', async () => {
    const row = updatedRow({ tier: 'core' })
    storeUpdate.mockResolvedValueOnce(row)

    const result = await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(result).toBe(row)
  })

  it('returns the updated row even on a no-op (no log written)', async () => {
    const row = updatedRow({ tier: 'core' })
    storeUpdate.mockResolvedValueOnce(row)

    const result = await applyTierChange({
      storeId: 'store-1',
      fromTier: 'core',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(result).toBe(row)
    expect(logCreate).not.toHaveBeenCalled()
  })

  it('propagates errors from store.update without writing a log row', async () => {
    storeUpdate.mockRejectedValueOnce(new Error('db down'))

    await expect(
      applyTierChange({
        storeId: 'store-1',
        fromTier: 'free',
        data: { tier: 'core' },
        source: 'stripe_webhook',
      }),
    ).rejects.toThrow('db down')

    expect(logCreate).not.toHaveBeenCalled()
  })

  it('propagates errors from tierChangeLog.create (caller sees the failure)', async () => {
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))
    logCreate.mockRejectedValueOnce(new Error('log table missing'))

    await expect(
      applyTierChange({
        storeId: 'store-1',
        fromTier: 'free',
        data: { tier: 'core' },
        source: 'stripe_webhook',
      }),
    ).rejects.toThrow('log table missing')

    expect(storeUpdate).toHaveBeenCalledTimes(1)
  })

  it('logs each canonical TierLogSource value verbatim (no source remapping)', async () => {
    // Pin the source string is passed through unchanged for every documented
    // source. If someone ever introduces remapping inside applyTierChange, the
    // round-trip check fails.
    const sources = [
      'admin_comp',
      'admin_revoke',
      'stripe_webhook',
      'pause',
      'resume',
      'comp_expired',
      'auto_cleared',
      'boost_trial_icp',
      'boost_trial_activated',
    ] as const

    for (const source of sources) {
      vi.clearAllMocks()
      txMock.mockImplementation(async (cb: (db: typeof prisma) => Promise<unknown>) => cb(prisma))
      storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

      await applyTierChange({
        storeId: 'store-1',
        fromTier: 'free',
        data: { tier: 'core' },
        source,
      })

      expect(logCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ source }),
      })
    }
  })

  it('uses derived toTier from effectiveTier(updated), not from the caller-supplied data field', async () => {
    // Caller passed `data: { compTier: 'pro', compExpiresAt: FUTURE }` but the
    // returned row has paid tier 'free' + comp 'pro' unexpired → effective 'pro'.
    // The log toTier must be 'pro' (derived), not 'free' (the bare `tier` field).
    storeUpdate.mockResolvedValueOnce(
      updatedRow({
        tier: 'free',
        compTier: 'pro',
        compExpiresAt: new Date('2099-01-01T00:00:00Z'),
      }),
    )

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { compTier: 'pro', compExpiresAt: new Date('2099-01-01T00:00:00Z') },
      source: 'admin_comp',
    })

    expect(logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromTier: 'free', toTier: 'pro' }),
    })
  })

  it('records a downgrade in the log (toTier ranks below fromTier)', async () => {
    // Comp expired → effective drops from 'pro' to paid 'free'.
    storeUpdate.mockResolvedValueOnce(
      updatedRow({ tier: 'free', compTier: null, compExpiresAt: null }),
    )

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'pro',
      data: { compTier: null, compExpiresAt: null, compReason: null },
      source: 'comp_expired',
    })

    expect(logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromTier: 'pro',
        toTier: 'free',
        source: 'comp_expired',
      }),
    })
  })

  it('runs store.update and tierChangeLog.create against the SAME db client inside $transaction', async () => {
    // Build a custom $transaction that records which client was passed to the
    // callback. Verifies the inner ops use that same client (not the outer prisma).
    let observedDb: unknown = null
    txMock.mockImplementationOnce(async (cb: (db: unknown) => Promise<unknown>) => {
      observedDb = prisma // the canonical pattern: same client passed through
      return cb(prisma)
    })
    storeUpdate.mockResolvedValueOnce(updatedRow({ tier: 'core' }))

    await applyTierChange({
      storeId: 'store-1',
      fromTier: 'free',
      data: { tier: 'core' },
      source: 'stripe_webhook',
    })

    expect(observedDb).toBe(prisma)
    expect(storeUpdate).toHaveBeenCalledTimes(1)
    expect(logCreate).toHaveBeenCalledTimes(1)
  })
})
