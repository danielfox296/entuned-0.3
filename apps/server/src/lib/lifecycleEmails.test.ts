import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Prisma BEFORE importing the module under test. The path must be a
// literal — vi.mock is hoisted, and the path is relative to this test file.
vi.mock('../db.js', () => ({
  prisma: {
    store: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    playbackEvent: { count: vi.fn() },
    tierChangeLog: { findMany: vi.fn() },
    lifecycleEmailLog: { findUnique: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('./email.js', () => ({
  sendLifecycle: vi.fn(),
  sendPauseEnding: vi.fn(),
}))

import {
  runLifecycleEmails,
  runOneLifecycleDrip,
  type LifecycleDripName,
} from './lifecycleEmails.js'
import { prisma } from '../db.js'
import { sendLifecycle, sendPauseEnding } from './email.js'
import { FREE_TIER_CLIENT_ID } from './freeTier.js'

// --- mock handles ----------------------------------------------------------

const storeFindMany = prisma.store.findMany as unknown as ReturnType<typeof vi.fn>
const clientFindMany = prisma.client.findMany as unknown as ReturnType<typeof vi.fn>
const playbackCount = prisma.playbackEvent.count as unknown as ReturnType<typeof vi.fn>
const tierChangeFindMany = prisma.tierChangeLog.findMany as unknown as ReturnType<typeof vi.fn>
const logFindUnique = prisma.lifecycleEmailLog.findUnique as unknown as ReturnType<typeof vi.fn>
const logCreate = prisma.lifecycleEmailLog.create as unknown as ReturnType<typeof vi.fn>
const sendLifecycleMock = sendLifecycle as unknown as ReturnType<typeof vi.fn>
const sendPauseEndingMock = sendPauseEnding as unknown as ReturnType<typeof vi.fn>

// --- helpers ---------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// 2026-05-18T15:00:00Z = 9:00am America/Denver (MDT, UTC-6 in DST). A Monday.
// All time-based drips compute relative to Date.now(); freezing the clock at
// 9am MT mirrors what the production cron sees.
const NOW_9AM_MT = new Date('2026-05-18T15:00:00Z')

function makeAccount(overrides: Partial<{ id: string; email: string }> = {}) {
  return {
    id: 'acct-1',
    email: 'owner@example.com',
    ...overrides,
  }
}

function makeMembership(account = makeAccount()) {
  return { account }
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client-1',
    memberships: [makeMembership()],
    stores: [],
    ...overrides,
  }
}

function makeStoreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'store-1',
    clientId: 'client-1',
    slug: 'test-store',
    client: { memberships: [makeMembership()] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Sensible defaults — each suite overrides what it needs.
  storeFindMany.mockResolvedValue([])
  clientFindMany.mockResolvedValue([])
  playbackCount.mockResolvedValue(0)
  tierChangeFindMany.mockResolvedValue([])
  logFindUnique.mockResolvedValue(null)
  logCreate.mockResolvedValue({})
  sendLifecycleMock.mockResolvedValue({ ok: true })
  sendPauseEndingMock.mockResolvedValue({ ok: true })

  vi.useFakeTimers()
  vi.setSystemTime(NOW_9AM_MT)
})

afterEach(() => {
  vi.useRealTimers()
})

// =====================================================================
// runIcpUnfilled
// =====================================================================

describe('icpUnfilled drip', () => {
  it('queries stores at least 48h old, paid tier, with no non-FreeTier ICP', async () => {
    await runOneLifecycleDrip('icpUnfilled')
    const call = storeFindMany.mock.calls[0]?.[0]
    expect(call?.where?.archivedAt).toBeNull()
    expect(call?.where?.tier?.in).toEqual(['core', 'pro'])
    expect(call?.where?.subscription).toEqual({ isNot: null })
    expect(call?.where?.createdAt?.lte).toEqual(new Date(NOW_9AM_MT.getTime() - 48 * HOUR_MS))
    expect(call?.where?.icpLinks).toEqual({
      none: { icp: { clientId: { not: FREE_TIER_CLIENT_ID } } },
    })
  })

  it('sends to the first owner/manager and records the log row', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow()])

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'icpUnfilled',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({ intakeUrl: expect.stringContaining('/intake') }),
    )
    expect(logCreate).toHaveBeenCalledWith({
      data: { accountId: 'acct-1', templateName: 'icpUnfilled' },
    })
    expect(stats).toEqual({ considered: 1, sent: 1, skipped: 0, errors: 0 })
  })

  it('dedupes per Client — multiple Stores under the same Client send only one email', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ id: 'store-a' }),
      makeStoreRow({ id: 'store-b' }),
      makeStoreRow({ id: 'store-c' }),
    ])

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(sendLifecycleMock).toHaveBeenCalledTimes(1)
    expect(stats.sent).toBe(1)
    expect(stats.considered).toBe(1)
  })

  it('sends one email per distinct Client when stores belong to different Clients', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ clientId: 'client-A', client: { memberships: [makeMembership(makeAccount({ id: 'acct-A', email: 'a@x.com' }))] } }),
      makeStoreRow({ clientId: 'client-B', client: { memberships: [makeMembership(makeAccount({ id: 'acct-B', email: 'b@x.com' }))] } }),
    ])

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(sendLifecycleMock).toHaveBeenCalledTimes(2)
    expect(stats.sent).toBe(2)
  })

  it('skips when the Client has no owner/manager membership', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ client: { memberships: [] } }),
    ])

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('does not re-send when an existing LifecycleEmailLog row exists', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow()])
    logFindUnique.mockResolvedValueOnce({ id: 'log-existing' })

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(logCreate).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 1, errors: 0 })
  })

  it('looks up the idempotency log with templateName=icpUnfilled and contextKey=""', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow()])

    await runOneLifecycleDrip('icpUnfilled')

    expect(logFindUnique).toHaveBeenCalledWith({
      where: {
        accountId_templateName_contextKey: {
          accountId: 'acct-1',
          templateName: 'icpUnfilled',
          contextKey: '',
        },
      },
    })
  })

  it('treats sendLifecycle skipped=true as a skip and does NOT create a log row', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow()])
    sendLifecycleMock.mockResolvedValueOnce({ ok: true, skipped: true })

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 1, errors: 0 })
  })

  it('counts ok:false from send as an error', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow()])
    sendLifecycleMock.mockResolvedValueOnce({ ok: false, error: 'boom' })

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 0, errors: 1 })
  })

  it('catches thrown errors from sendLifecycle and increments errors', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow()])
    sendLifecycleMock.mockRejectedValueOnce(new Error('network'))

    const stats = await runOneLifecycleDrip('icpUnfilled')

    expect(stats.errors).toBe(1)
    expect(stats.sent).toBe(0)
  })
})

// =====================================================================
// runPauseEnding
// =====================================================================

describe('pauseEnding drip', () => {
  it('queries stores with pausedUntil in [now+6d, now+7d)', async () => {
    await runOneLifecycleDrip('pauseEnding')

    const call = storeFindMany.mock.calls[0]?.[0]
    expect(call?.where?.archivedAt).toBeNull()
    expect(call?.where?.subscription).toEqual({ isNot: null })
    expect(call?.where?.pausedUntil?.gte).toEqual(new Date(NOW_9AM_MT.getTime() + 6 * DAY_MS))
    expect(call?.where?.pausedUntil?.lt).toEqual(new Date(NOW_9AM_MT.getTime() + 7 * DAY_MS))
  })

  it('sends pauseEnding via sendPauseEnding (transactional path, not lifecycle)', async () => {
    const pausedUntil = new Date(NOW_9AM_MT.getTime() + 6.5 * DAY_MS)
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ pausedUntil }),
    ])

    const stats = await runOneLifecycleDrip('pauseEnding')

    expect(sendPauseEndingMock).toHaveBeenCalledTimes(1)
    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.sent).toBe(1)
  })

  it('computes daysRemaining via Math.ceil((pausedUntil - now) / day)', async () => {
    const pausedUntil = new Date(NOW_9AM_MT.getTime() + 6 * DAY_MS + 12 * HOUR_MS) // 6.5 days
    storeFindMany.mockResolvedValueOnce([makeStoreRow({ pausedUntil })])

    await runOneLifecycleDrip('pauseEnding')

    const args = sendPauseEndingMock.mock.calls[0]
    expect(args?.[0]).toBe('owner@example.com')
    expect(args?.[1]).toBe(7) // ceil(6.5)
    expect(typeof args?.[2]).toBe('string') // dashboardUrl
  })

  it('clamps daysRemaining to 0 minimum (defensive)', async () => {
    // Past pausedUntil — would yield negative; Math.max(0, ...) clamps.
    const pausedUntil = new Date(NOW_9AM_MT.getTime() - 1 * DAY_MS)
    storeFindMany.mockResolvedValueOnce([makeStoreRow({ pausedUntil })])

    await runOneLifecycleDrip('pauseEnding')

    expect(sendPauseEndingMock.mock.calls[0]?.[1]).toBe(0)
  })

  it('uses ISO YYYY-MM-DD slice of pausedUntil as the idempotency contextKey', async () => {
    const pausedUntil = new Date('2026-05-25T18:30:00.000Z')
    storeFindMany.mockResolvedValueOnce([makeStoreRow({ pausedUntil })])

    await runOneLifecycleDrip('pauseEnding')

    expect(logFindUnique).toHaveBeenCalledWith({
      where: {
        accountId_templateName_contextKey: {
          accountId: 'acct-1',
          templateName: 'pauseEnding',
          contextKey: '2026-05-25',
        },
      },
    })
    expect(logCreate).toHaveBeenCalledWith({
      data: {
        accountId: 'acct-1',
        templateName: 'pauseEnding',
        contextKey: '2026-05-25',
      },
    })
  })

  it('does not re-send for the same pause window (same contextKey log exists)', async () => {
    const pausedUntil = new Date(NOW_9AM_MT.getTime() + 6.5 * DAY_MS)
    storeFindMany.mockResolvedValueOnce([makeStoreRow({ pausedUntil })])
    logFindUnique.mockResolvedValueOnce({ id: 'log-existing' })

    const stats = await runOneLifecycleDrip('pauseEnding')

    expect(sendPauseEndingMock).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 1, errors: 0 })
  })

  it('skips when no owner/manager exists', async () => {
    const pausedUntil = new Date(NOW_9AM_MT.getTime() + 6.5 * DAY_MS)
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ pausedUntil, client: { memberships: [] } }),
    ])

    const stats = await runOneLifecycleDrip('pauseEnding')

    expect(sendPauseEndingMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when pausedUntil is null even if the row arrives (defensive)', async () => {
    storeFindMany.mockResolvedValueOnce([makeStoreRow({ pausedUntil: null })])

    const stats = await runOneLifecycleDrip('pauseEnding')

    expect(sendPauseEndingMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('counts ok:false from sendPauseEnding as an error', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ pausedUntil: new Date(NOW_9AM_MT.getTime() + 6.5 * DAY_MS) }),
    ])
    sendPauseEndingMock.mockResolvedValueOnce({ ok: false, error: 'smtp' })

    const stats = await runOneLifecycleDrip('pauseEnding')

    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 0, errors: 1 })
    expect(logCreate).not.toHaveBeenCalled()
  })

  it('catches thrown errors from sendPauseEnding', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ pausedUntil: new Date(NOW_9AM_MT.getTime() + 6.5 * DAY_MS) }),
    ])
    sendPauseEndingMock.mockRejectedValueOnce(new Error('boom'))

    const stats = await runOneLifecycleDrip('pauseEnding')

    expect(stats.errors).toBe(1)
  })
})

// =====================================================================
// runFreeToCoreNudge
// =====================================================================

describe('freeToCoreNudge drip', () => {
  it('queries clients at least 72h old with no paid Store and no active comp', async () => {
    await runOneLifecycleDrip('freeToCoreNudge')

    const call = clientFindMany.mock.calls[0]?.[0]
    expect(call?.where?.createdAt?.lte).toEqual(new Date(NOW_9AM_MT.getTime() - 72 * HOUR_MS))
    // AND has three subclauses: has-store, no-sub, no-active-comp
    expect(Array.isArray(call?.where?.AND)).toBe(true)
    expect(call?.where?.AND?.length).toBe(3)
  })

  it('sends to first owner/manager with playerUrl built from primary store slug', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [{ slug: 'my-shop' }],
      }),
    ])

    const stats = await runOneLifecycleDrip('freeToCoreNudge')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'freeToCoreNudge',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({
        playerUrl: expect.stringContaining('/my-shop'),
        upgradeUrl: expect.stringContaining('tier=core'),
      }),
    )
    expect(stats.sent).toBe(1)
  })

  it('skips when Client has no active Store (no slug to link to)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [] }),
    ])

    const stats = await runOneLifecycleDrip('freeToCoreNudge')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when Client has no owner/manager', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ memberships: [], stores: [{ slug: 'shop' }] }),
    ])

    const stats = await runOneLifecycleDrip('freeToCoreNudge')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when a freeToCoreNudge log already exists for the account', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ slug: 'shop' }] }),
    ])
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('freeToCoreNudge')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 1, errors: 0 })
  })

  it('treats sendLifecycle skipped=true (opted out) as a skip', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ slug: 'shop' }] }),
    ])
    sendLifecycleMock.mockResolvedValueOnce({ ok: true, skipped: true })

    const stats = await runOneLifecycleDrip('freeToCoreNudge')

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 1, errors: 0 })
  })

  it('catches send errors and increments errors', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ slug: 'shop' }] }),
    ])
    sendLifecycleMock.mockRejectedValueOnce(new Error('net'))

    const stats = await runOneLifecycleDrip('freeToCoreNudge')

    expect(stats.errors).toBe(1)
  })

  it('records the log row on successful send', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ slug: 'shop' }] }),
    ])

    await runOneLifecycleDrip('freeToCoreNudge')

    expect(logCreate).toHaveBeenCalledWith({
      data: { accountId: 'acct-1', templateName: 'freeToCoreNudge' },
    })
  })
})

// =====================================================================
// runEngagedFreeToCore
// =====================================================================

describe('engagedFreeToCore drip', () => {
  it('counts song_start events for the last 14 days across all stores in the Client', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [{ id: 'store-1' }, { id: 'store-2' }],
      }),
    ])
    playbackCount.mockResolvedValueOnce(150) // above the threshold

    await runOneLifecycleDrip('engagedFreeToCore')

    const call = playbackCount.mock.calls[0]?.[0]
    expect(call?.where?.storeId?.in).toEqual(['store-1', 'store-2'])
    expect(call?.where?.eventType).toBe('song_start')
    expect(call?.where?.occurredAt?.gte).toEqual(new Date(NOW_9AM_MT.getTime() - 14 * DAY_MS))
  })

  it('does not consider a Client below the 100-songs threshold', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ id: 'store-1' }] }),
    ])
    playbackCount.mockResolvedValueOnce(99) // just under

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('sends at exactly 100 song_starts (inclusive threshold)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ id: 'store-1' }] }),
    ])
    playbackCount.mockResolvedValueOnce(100)

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(sendLifecycleMock).toHaveBeenCalled()
    expect(stats.sent).toBe(1)
  })

  it('sends well above the threshold and passes songsPlayed prop', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ id: 'store-1' }] }),
    ])
    playbackCount.mockResolvedValueOnce(523)

    await runOneLifecycleDrip('engagedFreeToCore')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'engagedFreeToCore',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({ songsPlayed: 523, upgradeUrl: expect.stringContaining('tier=core') }),
    )
  })

  it('skips Clients with zero stores (no playback to count)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [] }),
    ])

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(playbackCount).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips Clients with no owner/manager', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ memberships: [], stores: [{ id: 'store-1' }] }),
    ])

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(playbackCount).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('suppresses second send when a log row already exists', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ id: 'store-1' }] }),
    ])
    playbackCount.mockResolvedValueOnce(200)
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats).toEqual({ considered: 1, sent: 0, skipped: 1, errors: 0 })
  })

  it('opt-out from sendLifecycle skipped=true is counted as skipped', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ stores: [{ id: 'store-1' }] }),
    ])
    playbackCount.mockResolvedValueOnce(200)
    sendLifecycleMock.mockResolvedValueOnce({ ok: true, skipped: true })

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('isolates errors per Client — one failure does not stop the loop', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({ id: 'c-a', stores: [{ id: 'store-a' }], memberships: [makeMembership(makeAccount({ id: 'acct-A', email: 'a@x.com' }))] }),
      makeClient({ id: 'c-b', stores: [{ id: 'store-b' }], memberships: [makeMembership(makeAccount({ id: 'acct-B', email: 'b@x.com' }))] }),
    ])
    playbackCount.mockResolvedValueOnce(200).mockResolvedValueOnce(200)
    sendLifecycleMock
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce({ ok: true })

    const stats = await runOneLifecycleDrip('engagedFreeToCore')

    expect(stats).toEqual({ considered: 2, sent: 1, skipped: 0, errors: 1 })
  })
})

// =====================================================================
// runScalingCoreToPro
// =====================================================================

describe('scalingCoreToPro drip', () => {
  it('requires ≥2 paid Stores — skips Client with only 1 paid Store', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { id: 's1', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: null }, // unpaid
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('sends when Client has exactly 2 paid Core Stores and no Pro', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { id: 's1', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'scalingCoreToPro',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({ storeCount: 2, upgradeUrl: expect.stringContaining('tier=pro') }),
    )
    expect(stats.sent).toBe(1)
  })

  it('skips when one of the paid Stores is already effectively Pro', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { id: 's1', tier: 'pro', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when a Core store is comped up to Pro (effective Pro via comp)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          {
            id: 's1', tier: 'core',
            compTier: 'pro',
            compExpiresAt: new Date(NOW_9AM_MT.getTime() + 30 * DAY_MS), // unexpired
            subscription: { id: 'sub-1' },
          },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('sends when a comp-to-pro has expired (effective tier falls back to core)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          {
            id: 's1', tier: 'core',
            compTier: 'pro',
            compExpiresAt: new Date(NOW_9AM_MT.getTime() - 1 * DAY_MS), // expired
            subscription: { id: 'sub-1' },
          },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).toHaveBeenCalled()
    expect(stats.sent).toBe(1)
  })

  it('skips Enterprise stores too (effective Enterprise blocks the pitch)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { id: 's1', tier: 'enterprise', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
  })

  it('reports correct storeCount when there are 3 paid Core Stores', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { id: 's1', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
          { id: 's3', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-3' } },
        ],
      }),
    ])

    await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock.mock.calls[0]?.[2]?.storeCount).toBe(3)
  })

  it('skips when log row already exists', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { id: 's1', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('skips Client with no owner/manager', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        memberships: [],
        stores: [
          { id: 's1', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-1' } },
          { id: 's2', tier: 'core', compTier: null, compExpiresAt: null, subscription: { id: 'sub-2' } },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('scalingCoreToPro')

    expect(stats.considered).toBe(0)
  })
})

// =====================================================================
// runEstablishedCoreToPro
// =====================================================================

describe('establishedCoreToPro drip', () => {
  it('queries Clients with a core Store whose subscription is ≥30d old and at least one ICP', async () => {
    await runOneLifecycleDrip('establishedCoreToPro')

    const call = clientFindMany.mock.calls[0]?.[0]
    expect(call?.where?.icps).toEqual({ some: {} })
    expect(call?.where?.stores?.some?.tier).toBe('core')
    expect(call?.where?.stores?.some?.archivedAt).toBeNull()
    expect(call?.where?.stores?.some?.subscription?.is?.createdAt?.lte).toEqual(
      new Date(NOW_9AM_MT.getTime() - 30 * DAY_MS),
    )
  })

  it('sends when Client has a tenured Core Store, ICP, no Pro', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [{ tier: 'core', compTier: null, compExpiresAt: null }],
      }),
    ])

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'establishedCoreToPro',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({ upgradeUrl: expect.stringContaining('tier=pro') }),
    )
    expect(stats.sent).toBe(1)
  })

  it('skips when any Store is effectively Pro (paid)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { tier: 'core', compTier: null, compExpiresAt: null },
          { tier: 'pro', compTier: null, compExpiresAt: null },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when a Store is comp-Pro and the comp is still active', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          {
            tier: 'core',
            compTier: 'pro',
            compExpiresAt: new Date(NOW_9AM_MT.getTime() + 30 * DAY_MS),
          },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
  })

  it('sends when a Pro comp has expired (effective falls back to core)', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          {
            tier: 'core',
            compTier: 'pro',
            compExpiresAt: new Date(NOW_9AM_MT.getTime() - 1 * DAY_MS),
          },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(sendLifecycleMock).toHaveBeenCalled()
    expect(stats.sent).toBe(1)
  })

  it('skips when an Enterprise store is present', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [
          { tier: 'core', compTier: null, compExpiresAt: null },
          { tier: 'enterprise', compTier: null, compExpiresAt: null },
        ],
      }),
    ])

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
  })

  it('skips when log row already exists', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [{ tier: 'core', compTier: null, compExpiresAt: null }],
      }),
    ])
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('skips Client with no owner/manager', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        memberships: [],
        stores: [{ tier: 'core', compTier: null, compExpiresAt: null }],
      }),
    ])

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(stats.considered).toBe(0)
  })

  it('treats sendLifecycle opted-out skip as a skip', async () => {
    clientFindMany.mockResolvedValueOnce([
      makeClient({
        stores: [{ tier: 'core', compTier: null, compExpiresAt: null }],
      }),
    ])
    sendLifecycleMock.mockResolvedValueOnce({ ok: true, skipped: true })

    const stats = await runOneLifecycleDrip('establishedCoreToPro')

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })
})

// =====================================================================
// runBoostTrialStreamReady
// =====================================================================

describe('boostTrialStreamReady drip', () => {
  it('queries comp Stores with compExpiresAt in [now+27d, now+30d]', async () => {
    await runOneLifecycleDrip('boostTrialStreamReady')

    const call = storeFindMany.mock.calls[0]?.[0]
    expect(call?.where?.archivedAt).toBeNull()
    expect(call?.where?.compTier).toBe('core')
    expect(call?.where?.compReason).toBe('boost_trial_icp')
    expect(call?.where?.compExpiresAt?.gte).toEqual(new Date(NOW_9AM_MT.getTime() + 27 * DAY_MS))
    expect(call?.where?.compExpiresAt?.lte).toEqual(new Date(NOW_9AM_MT.getTime() + 30 * DAY_MS))
  })

  it('sends with contextKey = storeId and computes daysRemaining', async () => {
    const compExpiresAt = new Date(NOW_9AM_MT.getTime() + 28.5 * DAY_MS)
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ id: 'store-xyz', slug: 'shop-xyz', compExpiresAt }),
    ])

    await runOneLifecycleDrip('boostTrialStreamReady')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'boostTrialStreamReady',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({
        playerUrl: expect.stringContaining('/shop-xyz'),
        dashboardUrl: expect.any(String),
        daysRemaining: 29, // ceil(28.5)
      }),
    )
    expect(logCreate).toHaveBeenCalledWith({
      data: { accountId: 'acct-1', templateName: 'boostTrialStreamReady', contextKey: 'store-xyz' },
    })
  })

  it('clamps daysRemaining to a minimum of 1', async () => {
    // compExpiresAt very close to now — fractional day would round down to 0
    const compExpiresAt = new Date(NOW_9AM_MT.getTime() + 100) // ~0 days
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt }),
    ])

    await runOneLifecycleDrip('boostTrialStreamReady')

    expect(sendLifecycleMock.mock.calls[0]?.[2]?.daysRemaining).toBe(1)
  })

  it('uses storeId in the idempotency key (separate from other drips)', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ id: 'store-A', compExpiresAt: new Date(NOW_9AM_MT.getTime() + 28 * DAY_MS) }),
    ])

    await runOneLifecycleDrip('boostTrialStreamReady')

    expect(logFindUnique).toHaveBeenCalledWith({
      where: {
        accountId_templateName_contextKey: {
          accountId: 'acct-1',
          templateName: 'boostTrialStreamReady',
          contextKey: 'store-A',
        },
      },
    })
  })

  it('skips when the log row exists for this storeId', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt: new Date(NOW_9AM_MT.getTime() + 28 * DAY_MS) }),
    ])
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('boostTrialStreamReady')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('skips Store with no owner/manager', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({
        compExpiresAt: new Date(NOW_9AM_MT.getTime() + 28 * DAY_MS),
        client: { memberships: [] },
      }),
    ])

    const stats = await runOneLifecycleDrip('boostTrialStreamReady')

    expect(stats.considered).toBe(0)
  })

  it('opted-out send is treated as skip', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt: new Date(NOW_9AM_MT.getTime() + 28 * DAY_MS) }),
    ])
    sendLifecycleMock.mockResolvedValueOnce({ ok: true, skipped: true })

    const stats = await runOneLifecycleDrip('boostTrialStreamReady')

    expect(logCreate).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('thrown send error is captured', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt: new Date(NOW_9AM_MT.getTime() + 28 * DAY_MS) }),
    ])
    sendLifecycleMock.mockRejectedValueOnce(new Error('boom'))

    const stats = await runOneLifecycleDrip('boostTrialStreamReady')

    expect(stats.errors).toBe(1)
  })
})

// =====================================================================
// runBoostTrialEngagement
// =====================================================================

describe('boostTrialEngagement drip', () => {
  it('queries comp Stores with compExpiresAt in [now+14d, now+18d]', async () => {
    await runOneLifecycleDrip('boostTrialEngagement')

    const call = storeFindMany.mock.calls[0]?.[0]
    expect(call?.where?.compTier).toBe('core')
    expect(call?.where?.compReason).toBe('boost_trial_icp')
    expect(call?.where?.compExpiresAt?.gte).toEqual(new Date(NOW_9AM_MT.getTime() + 14 * DAY_MS))
    expect(call?.where?.compExpiresAt?.lte).toEqual(new Date(NOW_9AM_MT.getTime() + 18 * DAY_MS))
  })

  it('sends with upgradeUrl pointing at upgrade-from-comp?store=<id>', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({
        id: 'store-xyz',
        compExpiresAt: new Date(NOW_9AM_MT.getTime() + 16 * DAY_MS),
      }),
    ])

    await runOneLifecycleDrip('boostTrialEngagement')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'boostTrialEngagement',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({
        upgradeUrl: expect.stringContaining('store=store-xyz'),
        dashboardUrl: expect.any(String),
        daysRemaining: 16,
      }),
    )
  })

  it('uses storeId as contextKey', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({
        id: 'store-Q',
        compExpiresAt: new Date(NOW_9AM_MT.getTime() + 16 * DAY_MS),
      }),
    ])

    await runOneLifecycleDrip('boostTrialEngagement')

    expect(logCreate).toHaveBeenCalledWith({
      data: { accountId: 'acct-1', templateName: 'boostTrialEngagement', contextKey: 'store-Q' },
    })
  })

  it('clamps daysRemaining to 1 minimum', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt: new Date(NOW_9AM_MT.getTime() + 100) }),
    ])

    await runOneLifecycleDrip('boostTrialEngagement')

    expect(sendLifecycleMock.mock.calls[0]?.[2]?.daysRemaining).toBe(1)
  })

  it('skips when log row exists', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt: new Date(NOW_9AM_MT.getTime() + 16 * DAY_MS) }),
    ])
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('boostTrialEngagement')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('records errors when sendLifecycle returns ok:false', async () => {
    storeFindMany.mockResolvedValueOnce([
      makeStoreRow({ compExpiresAt: new Date(NOW_9AM_MT.getTime() + 16 * DAY_MS) }),
    ])
    sendLifecycleMock.mockResolvedValueOnce({ ok: false, error: 'smtp' })

    const stats = await runOneLifecycleDrip('boostTrialEngagement')

    expect(stats.errors).toBe(1)
    expect(logCreate).not.toHaveBeenCalled()
  })
})

// =====================================================================
// runPostConversionBenchmark
// =====================================================================

describe('postConversionBenchmark drip', () => {
  function makeConversionLog(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tcl-1',
      store: {
        id: 'store-1',
        archivedAt: null,
        tier: 'core',
        subscription: { id: 'sub-1' },
        tierChangeLogs: [{ id: 'trial-log-1' }],
        client: { memberships: [makeMembership()] },
      },
      ...overrides,
    }
  }

  it('queries TierChangeLog for stripe_webhook→core in [now-10d, now-7d]', async () => {
    await runOneLifecycleDrip('postConversionBenchmark')

    const call = tierChangeFindMany.mock.calls[0]?.[0]
    expect(call?.where?.source).toBe('stripe_webhook')
    expect(call?.where?.toTier).toBe('core')
    expect(call?.where?.createdAt?.gte).toEqual(new Date(NOW_9AM_MT.getTime() - 10 * DAY_MS))
    expect(call?.where?.createdAt?.lte).toEqual(new Date(NOW_9AM_MT.getTime() - 7 * DAY_MS))
  })

  it('sends when the converted Store had a previous boost_trial_activated log', async () => {
    tierChangeFindMany.mockResolvedValueOnce([makeConversionLog()])

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(sendLifecycleMock).toHaveBeenCalledWith(
      'postConversionBenchmark',
      { accountId: 'acct-1', email: 'owner@example.com' },
      expect.objectContaining({
        benchmarkUrl: expect.stringContaining('/benchmark'),
        dashboardUrl: expect.any(String),
      }),
    )
    expect(stats.sent).toBe(1)
  })

  it('skips conversions whose Store never had a boost_trial_activated log', async () => {
    tierChangeFindMany.mockResolvedValueOnce([
      makeConversionLog({
        store: {
          id: 'store-1',
          archivedAt: null,
          tier: 'core',
          subscription: { id: 'sub-1' },
          tierChangeLogs: [], // no prior trial
          client: { memberships: [makeMembership()] },
        },
      }),
    ])

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when Store is archived', async () => {
    tierChangeFindMany.mockResolvedValueOnce([
      makeConversionLog({
        store: {
          id: 'store-1',
          archivedAt: new Date(),
          tier: 'core',
          subscription: { id: 'sub-1' },
          tierChangeLogs: [{ id: 'trial-log-1' }],
          client: { memberships: [makeMembership()] },
        },
      }),
    ])

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.considered).toBe(0)
  })

  it('skips when Store tier is no longer core (e.g. churned back to free)', async () => {
    tierChangeFindMany.mockResolvedValueOnce([
      makeConversionLog({
        store: {
          id: 'store-1',
          archivedAt: null,
          tier: 'free',
          subscription: { id: 'sub-1' },
          tierChangeLogs: [{ id: 'trial-log-1' }],
          client: { memberships: [makeMembership()] },
        },
      }),
    ])

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
  })

  it('skips when Store has no live Subscription (cancelled during the window)', async () => {
    tierChangeFindMany.mockResolvedValueOnce([
      makeConversionLog({
        store: {
          id: 'store-1',
          archivedAt: null,
          tier: 'core',
          subscription: null,
          tierChangeLogs: [{ id: 'trial-log-1' }],
          client: { memberships: [makeMembership()] },
        },
      }),
    ])

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
  })

  it('uses the TierChangeLog id as the idempotency contextKey', async () => {
    tierChangeFindMany.mockResolvedValueOnce([
      makeConversionLog({ id: 'tcl-special' }),
    ])

    await runOneLifecycleDrip('postConversionBenchmark')

    expect(logFindUnique).toHaveBeenCalledWith({
      where: {
        accountId_templateName_contextKey: {
          accountId: 'acct-1',
          templateName: 'postConversionBenchmark',
          contextKey: 'tcl-special',
        },
      },
    })
    expect(logCreate).toHaveBeenCalledWith({
      data: {
        accountId: 'acct-1',
        templateName: 'postConversionBenchmark',
        contextKey: 'tcl-special',
      },
    })
  })

  it('skips when log already exists for this conversion id', async () => {
    tierChangeFindMany.mockResolvedValueOnce([makeConversionLog()])
    logFindUnique.mockResolvedValueOnce({ id: 'log' })

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(sendLifecycleMock).not.toHaveBeenCalled()
    expect(stats.skipped).toBe(1)
  })

  it('skips Store with no owner/manager', async () => {
    tierChangeFindMany.mockResolvedValueOnce([
      makeConversionLog({
        store: {
          id: 'store-1',
          archivedAt: null,
          tier: 'core',
          subscription: { id: 'sub-1' },
          tierChangeLogs: [{ id: 'trial-log-1' }],
          client: { memberships: [] },
        },
      }),
    ])

    const stats = await runOneLifecycleDrip('postConversionBenchmark')

    expect(stats.considered).toBe(0)
  })
})

// =====================================================================
// runLifecycleEmails — orchestration
// =====================================================================

describe('runLifecycleEmails — full tick at 9am MT', () => {
  it('returns DripStats for every drip name (full orchestration)', async () => {
    const result = await runLifecycleEmails()

    expect(Object.keys(result).sort()).toEqual([
      'boostTrialEngagement',
      'boostTrialStreamReady',
      'engagedFreeToCore',
      'establishedCoreToPro',
      'freeToCoreNudge',
      'icpUnfilled',
      'pauseEnding',
      'postConversionBenchmark',
      'scalingCoreToPro',
    ])
  })

  it('returns zeroed stats when no rows match any drip', async () => {
    const result = await runLifecycleEmails()

    for (const name of Object.keys(result) as LifecycleDripName[]) {
      expect(result[name]).toEqual({ considered: 0, sent: 0, skipped: 0, errors: 0 })
    }
  })

  it('runs all 9 drips in a single tick (each helper Prisma surface is consulted)', async () => {
    await runLifecycleEmails()
    // store.findMany is used by icpUnfilled, pauseEnding, boostTrialStreamReady, boostTrialEngagement = 4 calls
    expect(storeFindMany.mock.calls.length).toBe(4)
    // client.findMany is used by freeToCoreNudge, engagedFreeToCore, scalingCoreToPro, establishedCoreToPro = 4 calls
    expect(clientFindMany.mock.calls.length).toBe(4)
    // tierChangeLog.findMany is used by postConversionBenchmark = 1 call
    expect(tierChangeFindMany.mock.calls.length).toBe(1)
  })

  it('uses Date.now() consistently — frozen clock at 9am MT yields stable windows across drips', async () => {
    await runLifecycleEmails()

    // icpUnfilled cutoff = now - 48h
    const icpCall = storeFindMany.mock.calls.find((c) => c?.[0]?.where?.tier?.in)
    expect(icpCall?.[0]?.where?.createdAt?.lte).toEqual(new Date(NOW_9AM_MT.getTime() - 48 * HOUR_MS))

    // pauseEnding windowStart = now + 6d
    const pauseCall = storeFindMany.mock.calls.find((c) => c?.[0]?.where?.pausedUntil)
    expect(pauseCall?.[0]?.where?.pausedUntil?.gte).toEqual(new Date(NOW_9AM_MT.getTime() + 6 * DAY_MS))

    // postConversionBenchmark window = [now-10d, now-7d]
    expect(tierChangeFindMany.mock.calls[0]?.[0]?.where?.createdAt?.gte).toEqual(
      new Date(NOW_9AM_MT.getTime() - 10 * DAY_MS),
    )
  })
})

// =====================================================================
// runOneLifecycleDrip — switch dispatch
// =====================================================================

describe('runOneLifecycleDrip — dispatch', () => {
  const names: LifecycleDripName[] = [
    'icpUnfilled',
    'pauseEnding',
    'freeToCoreNudge',
    'engagedFreeToCore',
    'scalingCoreToPro',
    'establishedCoreToPro',
    'boostTrialStreamReady',
    'boostTrialEngagement',
    'postConversionBenchmark',
  ]

  for (const name of names) {
    it(`dispatches and returns a DripStats shape for "${name}"`, async () => {
      const stats = await runOneLifecycleDrip(name)
      expect(stats).toEqual({ considered: 0, sent: 0, skipped: 0, errors: 0 })
    })
  }
})
