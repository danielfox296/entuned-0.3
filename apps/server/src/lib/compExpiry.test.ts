import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Prisma BEFORE importing the module under test. The source calls:
//   prisma.store.findMany(...) twice (one per pass)
//   prisma.lifecycleEmailLog.findUnique / .create (pass 1)
//   prisma.$transaction([prisma.store.update(...), prisma.tierChangeLog.create(...)])
//
// $transaction is the ARRAY form — Prisma resolves each PrismaPromise in order
// inside a real transaction. The individual store.update / tierChangeLog.create
// calls execute (and record their arguments on the mocks) BEFORE $transaction
// runs, so asserting on those mocks is the canonical way to verify the audit
// row + update payloads. $transaction itself just needs to resolve.
vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    lifecycleEmailLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    tierChangeLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      // Source passes an array — resolve each entry. The store.update /
      // tierChangeLog.create mocks return undefined by default, so this just
      // wraps them in a Promise.all() to keep the surface honest.
      return Promise.all(ops.map((op) => Promise.resolve(op)))
    }),
  },
}))

// Mock the email module — sendLifecycle is the only export the source uses
// from here, and the cron must work whether it succeeds, skips, or throws.
vi.mock('./email.js', () => ({
  sendLifecycle: vi.fn(),
}))

import { runCompExpiryCron } from './compExpiry.js'
import { prisma } from '../db.js'
import { sendLifecycle } from './email.js'

// ── Convenience casts ────────────────────────────────────────────────────
const storeFindMany = prisma.store.findMany as unknown as ReturnType<typeof vi.fn>
const storeUpdate = prisma.store.update as unknown as ReturnType<typeof vi.fn>
const logFindUnique = prisma.lifecycleEmailLog.findUnique as unknown as ReturnType<typeof vi.fn>
const logCreate = prisma.lifecycleEmailLog.create as unknown as ReturnType<typeof vi.fn>
const tierLogCreate = prisma.tierChangeLog.create as unknown as ReturnType<typeof vi.fn>
const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
const sendMock = sendLifecycle as unknown as ReturnType<typeof vi.fn>

// ── Fixed "now" for deterministic boundary tests ─────────────────────────
const NOW = new Date('2026-05-18T12:00:00Z')

// ── Store row factory matching the SELECT shape in compExpiry.ts ─────────
interface CompStoreRow {
  id: string
  tier: string
  compTier: string | null
  compExpiresAt: Date | null
  compReason: string | null
  client: {
    memberships: Array<{
      account: { id: string; email: string } | null
    }>
  }
}

function makeCompStore(overrides: Partial<CompStoreRow> & { ownerEmail?: string; ownerId?: string; noOwner?: boolean } = {}): CompStoreRow {
  const { ownerEmail, ownerId, noOwner, ...rest } = overrides
  const memberships = noOwner
    ? []
    : [{ account: { id: ownerId ?? 'acct-1', email: ownerEmail ?? 'owner@example.com' } }]
  return {
    id: 'store-1',
    tier: 'free',
    compTier: 'pro',
    compExpiresAt: new Date('2026-05-19T12:00:00Z'),
    compReason: null,
    client: { memberships },
    ...rest,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  // Default: no warnings already logged.
  logFindUnique.mockResolvedValue(null)
  // Default: sendLifecycle succeeds.
  sendMock.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Pass 2 (comp-ended) ─ the core surface the brief asks about ─────────
describe('runCompExpiryCron — pass 2 (expired comps cleared)', () => {
  it('clears the comp via $transaction + writes a tier_change_log row when compExpiresAt is in the past', async () => {
    // Pass 1: no ending comps. Pass 2: one expired comp.
    storeFindMany
      .mockResolvedValueOnce([]) // ending
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-expired',
          tier: 'free',
          compTier: 'pro',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'), // 8 days ago
        }),
      ])

    const stats = await runCompExpiryCron()

    // The transaction was invoked once with an array of two operations.
    expect(txMock).toHaveBeenCalledTimes(1)
    const txArg = txMock.mock.calls[0]?.[0]
    expect(Array.isArray(txArg)).toBe(true)
    expect((txArg as unknown[]).length).toBe(2)

    // store.update clears every comp_* field.
    expect(storeUpdate).toHaveBeenCalledTimes(1)
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-expired' },
      data: {
        compTier: null,
        compExpiresAt: null,
        compReason: null,
        compGrantedById: null,
        compGrantedAt: null,
      },
    })

    // Audit log: from = former comp tier ('pro'), to = paid tier ('free'),
    // source = 'comp_expired'.
    expect(tierLogCreate).toHaveBeenCalledTimes(1)
    const logArg = tierLogCreate.mock.calls[0]?.[0]
    expect(logArg.data.storeId).toBe('store-expired')
    expect(logArg.data.fromTier).toBe('pro')
    expect(logArg.data.toTier).toBe('free')
    expect(logArg.data.source).toBe('comp_expired')
    expect(logArg.data.reason).toMatch(/comp pro expired on 2026-05-10T12:00:00\.000Z/)

    expect(stats.endedConsidered).toBe(1)
    expect(stats.endedSent).toBe(1)
    expect(stats.endedErrors).toBe(0)
  })

  it('records audit toTier as the paid tier (not free) when paid tier is non-free', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-paid-core',
          tier: 'core',
          compTier: 'pro',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'),
        }),
      ])

    await runCompExpiryCron()

    const logArg = tierLogCreate.mock.calls[0]?.[0]
    expect(logArg.data.fromTier).toBe('pro')
    expect(logArg.data.toTier).toBe('core')
  })

  it('does NOT touch a store whose compExpiresAt is in the future', async () => {
    // Both passes return empty — the Prisma filter (gt now / lte warnCutoff
    // and lte now) is the gate. We assert the gate by inspecting the where
    // clause passed to findMany rather than re-implementing Prisma semantics.
    storeFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runCompExpiryCron()

    expect(txMock).not.toHaveBeenCalled()
    expect(storeUpdate).not.toHaveBeenCalled()
    expect(tierLogCreate).not.toHaveBeenCalled()
  })

  it('boundary: pass 2 query uses lte: now (half-open — expiry instant treated as already expired)', async () => {
    storeFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runCompExpiryCron()

    // Pass 2 is the second findMany call.
    const pass2Where = storeFindMany.mock.calls[1]?.[0]?.where
    expect(pass2Where.compExpiresAt).toEqual({ not: null, lte: NOW })
  })

  it('boundary: pass 1 query uses gt: now (a store expiring exactly at now does NOT match the warning pass)', async () => {
    storeFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runCompExpiryCron()

    const pass1Where = storeFindMany.mock.calls[0]?.[0]?.where
    expect(pass1Where.compExpiresAt.gt).toEqual(NOW)
    // And the warning cutoff is exactly 7 days out.
    const sevenDaysOut = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
    expect(pass1Where.compExpiresAt.lte).toEqual(sevenDaysOut)
  })

  it('does NOT touch a store with no compTier set (filtered by where clause)', async () => {
    // We don't pass any rows back from findMany — proving the source relies on
    // the Prisma filter `compTier: { not: null }` rather than re-filtering in JS.
    storeFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runCompExpiryCron()

    const pass1Where = storeFindMany.mock.calls[0]?.[0]?.where
    const pass2Where = storeFindMany.mock.calls[1]?.[0]?.where
    expect(pass1Where.compTier).toEqual({ not: null })
    expect(pass2Where.compTier).toEqual({ not: null })
  })

  it('does NOT touch a store with compTier set but no compExpiresAt (open-ended comp filtered by where clause)', async () => {
    storeFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runCompExpiryCron()

    // Both passes require compExpiresAt: { not: null, ... } — open-ended comps
    // (compExpiresAt = null) are intentionally left for explicit admin revoke.
    const pass1Where = storeFindMany.mock.calls[0]?.[0]?.where
    const pass2Where = storeFindMany.mock.calls[1]?.[0]?.where
    expect(pass1Where.compExpiresAt.not).toBeNull()
    expect(pass2Where.compExpiresAt.not).toBeNull()
  })

  it('excludes archived stores from both passes', async () => {
    storeFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await runCompExpiryCron()

    expect(storeFindMany.mock.calls[0]?.[0]?.where.archivedAt).toBeNull()
    expect(storeFindMany.mock.calls[1]?.[0]?.where.archivedAt).toBeNull()
  })

  it('still clears the comp even if the owner email send throws (catch().catch undefined)', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-email-fails',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'),
        }),
      ])
    sendMock.mockRejectedValueOnce(new Error('Resend exploded'))

    const stats = await runCompExpiryCron()

    expect(txMock).toHaveBeenCalledTimes(1)
    expect(storeUpdate).toHaveBeenCalledTimes(1)
    expect(tierLogCreate).toHaveBeenCalledTimes(1)
    expect(stats.endedSent).toBe(1)
    expect(stats.endedErrors).toBe(0)
  })

  it('clears the comp WITHOUT sending email when the store has no owner/manager membership', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-no-owner',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'),
          noOwner: true,
        }),
      ])

    const stats = await runCompExpiryCron()

    expect(sendMock).not.toHaveBeenCalled()
    expect(txMock).toHaveBeenCalledTimes(1)
    expect(stats.endedClearedOnly).toBe(1)
    expect(stats.endedSent).toBe(0)
  })

  it('counts stats.endedErrors and does NOT throw when the transaction itself fails', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-tx-fails',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'),
        }),
      ])
    txMock.mockRejectedValueOnce(new Error('db unavailable'))

    const stats = await runCompExpiryCron()

    expect(stats.endedErrors).toBe(1)
    expect(stats.endedSent).toBe(0)
  })

  it('uses compEnded template for standard comps, boostTrialExpired for boost_trial_icp', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-std',
          compReason: 'admin_courtesy',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'),
        }),
      ])

    await runCompExpiryCron()

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0]?.[0]).toBe('compEnded')
  })
})

// ── Boost-trial grace period ─────────────────────────────────────────────
describe('runCompExpiryCron — Boost Trial 3-day grace period', () => {
  it('does NOT clear a boost_trial_icp comp that expired less than 3 days ago', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-boost-grace',
          compReason: 'boost_trial_icp',
          // Expired 2 days ago — still within the 3-day grace.
          compExpiresAt: new Date('2026-05-16T12:00:00Z'),
        }),
      ])

    const stats = await runCompExpiryCron()

    expect(txMock).not.toHaveBeenCalled()
    expect(storeUpdate).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(stats.endedConsidered).toBe(1)
    // Source: counts grace-skipped boost trials under endedClearedOnly.
    expect(stats.endedClearedOnly).toBe(1)
  })

  it('clears a boost_trial_icp comp once it has been expired for more than 3 days', async () => {
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-boost-past-grace',
          compReason: 'boost_trial_icp',
          // Expired 4 days ago — past grace.
          compExpiresAt: new Date('2026-05-14T12:00:00Z'),
        }),
      ])

    await runCompExpiryCron()

    expect(txMock).toHaveBeenCalledTimes(1)
    expect(storeUpdate).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0]?.[0]).toBe('boostTrialExpired')
  })
})

// ── Idempotency: pass 1 (warning email) ──────────────────────────────────
describe('runCompExpiryCron — pass 1 (warning emails) idempotency', () => {
  it('sends the warning + writes a LifecycleEmailLog row when none exists yet', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-warn',
          tier: 'free',
          compTier: 'pro',
          // 3 days from now — inside the 7-day window.
          compExpiresAt: new Date('2026-05-21T12:00:00Z'),
        }),
      ])
      .mockResolvedValueOnce([])

    const stats = await runCompExpiryCron()

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0]?.[0]).toBe('compEnding')
    expect(logCreate).toHaveBeenCalledTimes(1)
    expect(logCreate).toHaveBeenCalledWith({
      data: {
        accountId: 'acct-1',
        templateName: 'compEnding',
        contextKey: 'store-warn',
      },
    })
    expect(stats.endingSent).toBe(1)
    expect(stats.endingSkipped).toBe(0)
  })

  it('skips the warning when a LifecycleEmailLog row already exists for the (account, template, store) tuple', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-warn',
          compExpiresAt: new Date('2026-05-21T12:00:00Z'),
        }),
      ])
      .mockResolvedValueOnce([])
    logFindUnique.mockResolvedValueOnce({ id: 'log-1' })

    const stats = await runCompExpiryCron()

    expect(sendMock).not.toHaveBeenCalled()
    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.endingSent).toBe(0)
    expect(stats.endingSkipped).toBe(1)
  })

  it('uses boostTrialEnding template (and tighter 5-day window) for boost_trial_icp comps', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-boost-warn',
          compReason: 'boost_trial_icp',
          // 4 days from now — inside the 5-day Boost-Trial window.
          compExpiresAt: new Date('2026-05-22T12:00:00Z'),
        }),
      ])
      .mockResolvedValueOnce([])

    await runCompExpiryCron()

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0]?.[0]).toBe('boostTrialEnding')
    expect(logCreate).toHaveBeenCalledWith({
      data: {
        accountId: 'acct-1',
        templateName: 'boostTrialEnding',
        contextKey: 'store-boost-warn',
      },
    })
  })

  it('skips a boost_trial_icp warning when expiry is outside the 5-day boost window (but inside the 7-day default)', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-boost-warn',
          compReason: 'boost_trial_icp',
          // 6 days from now — outside 5-day, inside 7-day.
          compExpiresAt: new Date('2026-05-24T12:00:00Z'),
        }),
      ])
      .mockResolvedValueOnce([])

    const stats = await runCompExpiryCron()

    expect(sendMock).not.toHaveBeenCalled()
    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.endingSkipped).toBe(1)
  })

  it('skips warning (without erroring) when the store has no owner/manager', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-no-owner',
          compExpiresAt: new Date('2026-05-21T12:00:00Z'),
          noOwner: true,
        }),
      ])
      .mockResolvedValueOnce([])

    const stats = await runCompExpiryCron()

    expect(sendMock).not.toHaveBeenCalled()
    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.endingSkipped).toBe(1)
  })

  it('does NOT write a LifecycleEmailLog row when sendLifecycle returns ok:false', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-warn',
          compExpiresAt: new Date('2026-05-21T12:00:00Z'),
        }),
      ])
      .mockResolvedValueOnce([])
    sendMock.mockResolvedValueOnce({ ok: false, error: 'resend down' })

    const stats = await runCompExpiryCron()

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.endingErrors).toBe(1)
    expect(stats.endingSent).toBe(0)
  })

  it('counts a skipped (opt-out) send under endingSkipped, not endingSent, and writes no log', async () => {
    storeFindMany
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-warn',
          compExpiresAt: new Date('2026-05-21T12:00:00Z'),
        }),
      ])
      .mockResolvedValueOnce([])
    sendMock.mockResolvedValueOnce({ ok: true, skipped: true })

    const stats = await runCompExpiryCron()

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.endingSent).toBe(0)
    expect(stats.endingSkipped).toBe(1)
  })
})

// ── Idempotency at the cron level (re-running the cron does not double-process) ──
describe('runCompExpiryCron — re-run idempotency', () => {
  it('second run on the same now produces no new mutations once the store has been cleared', async () => {
    // First run: one expired comp.
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeCompStore({
          id: 'store-once',
          compExpiresAt: new Date('2026-05-10T12:00:00Z'),
        }),
      ])
    await runCompExpiryCron()
    expect(txMock).toHaveBeenCalledTimes(1)

    // Second run: the Prisma filter would no longer match (we simulate by
    // returning empty rows — the store was cleared so compTier is now null).
    storeFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const stats = await runCompExpiryCron()

    // No new transaction beyond the first.
    expect(txMock).toHaveBeenCalledTimes(1)
    expect(stats.endedConsidered).toBe(0)
    expect(stats.endedSent).toBe(0)
  })

  it('pass 1 idempotency: second run with the log already present skips the send', async () => {
    // Same store appears in both runs.
    const row = makeCompStore({
      id: 'store-warn',
      compExpiresAt: new Date('2026-05-21T12:00:00Z'),
    })

    // First run: no log yet → send + create.
    storeFindMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([])
    await runCompExpiryCron()
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(logCreate).toHaveBeenCalledTimes(1)

    // Second run: log now exists → no send, no create.
    storeFindMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([])
    logFindUnique.mockResolvedValueOnce({ id: 'log-1' })
    const stats = await runCompExpiryCron()

    expect(sendMock).toHaveBeenCalledTimes(1) // still 1 from first run
    expect(logCreate).toHaveBeenCalledTimes(1) // still 1 from first run
    expect(stats.endingSkipped).toBe(1)
  })
})
