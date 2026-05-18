import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ────────────────────────────────────────────────────────────────────────
// Mocks — Prisma and push module are both stubbed at the boundary.
// `vi.mock` is hoisted; the relative paths below resolve from THIS test
// file (apps/server/src/lib/playbackHeartbeat.test.ts), matching the
// source's `import` paths.
// ────────────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  prisma: {
    playbackEvent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    pushSubscription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('./push.js', () => ({
  isPushConfigured: vi.fn(),
  sendPush: vi.fn(),
}))

import { runPlaybackHeartbeat } from './playbackHeartbeat.js'
import { prisma } from '../db.js'
import { isPushConfigured, sendPush } from './push.js'

// Convenience casts so tests can configure return values without retyping.
const eventFindMany = prisma.playbackEvent.findMany as unknown as ReturnType<typeof vi.fn>
const eventFindFirst = prisma.playbackEvent.findFirst as unknown as ReturnType<typeof vi.fn>
const subFindFirst = prisma.pushSubscription.findFirst as unknown as ReturnType<typeof vi.fn>
const subFindMany = prisma.pushSubscription.findMany as unknown as ReturnType<typeof vi.fn>
const subUpdateMany = prisma.pushSubscription.updateMany as unknown as ReturnType<typeof vi.fn>
const isConfigured = isPushConfigured as unknown as ReturnType<typeof vi.fn>
const send = sendPush as unknown as ReturnType<typeof vi.fn>

// Constants from the source — duplicated here so the tests pin the contract.
// If a future change retunes these, the boundary tests fail loudly.
const ACTIVE_WINDOW_MS = 30 * 60 * 1000
const SILENCE_WINDOW_MS = 10 * 60 * 1000
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000

// Fixed "now" used across tests.
const NOW = new Date('2026-05-18T17:00:00Z')

/** Helper: minute-offset Date from NOW. Negative = past, positive = future. */
function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 60 * 1000)
}

/** Builder for the PlaybackEvent.findMany rows the cron reads. */
function makeProgressEvent(overrides: Partial<{ storeId: string; occurredAt: Date; eventType: string }> = {}) {
  return {
    storeId: overrides.storeId ?? 'store-1',
    occurredAt: overrides.occurredAt ?? minutesAgo(15),
    eventType: overrides.eventType ?? 'song_start',
  }
}

/** Builder for the PushSubscription.findMany row shape (with nested store name). */
function makeSubscription(overrides: Partial<{
  id: string
  endpoint: string
  p256dhKey: string
  authKey: string
  storeName: string
}> = {}) {
  return {
    id: overrides.id ?? 'sub-1',
    endpoint: overrides.endpoint ?? 'https://push.example/endpoint-1',
    p256dhKey: overrides.p256dhKey ?? 'p256-1',
    authKey: overrides.authKey ?? 'auth-1',
    store: { name: overrides.storeName ?? 'Acme Cafe' },
  }
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — some tests below set per-test
  // .mockResolvedValueOnce queues, and we want a clean slate each test.
  vi.resetAllMocks()
  // Default: push IS configured. Tests that exercise the unconfigured path
  // override this explicitly.
  isConfigured.mockReturnValue(true)
  // Default: no cooldown hit, no subs unless overridden.
  subFindFirst.mockResolvedValue(null)
  subFindMany.mockResolvedValue([])
  subUpdateMany.mockResolvedValue({ count: 0 })
  // Default: no "most-recent of any type" event (so we don't trip the
  // operator_pause skip path).
  eventFindFirst.mockResolvedValue(null)
  // Default: send returns 'sent'.
  send.mockResolvedValue('sent')
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ════════════════════════════════════════════════════════════════════════
// Push not configured
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — push not configured', () => {
  it('returns zero stats and queries nothing when isPushConfigured() is false', async () => {
    isConfigured.mockReturnValue(false)

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats).toEqual({ scanned: 0, nudged: 0, expired: 0, failed: 0 })
    expect(eventFindMany).not.toHaveBeenCalled()
    expect(eventFindFirst).not.toHaveBeenCalled()
    expect(subFindFirst).not.toHaveBeenCalled()
    expect(subFindMany).not.toHaveBeenCalled()
    expect(subUpdateMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Query shape — active window & event-type filter
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — initial query', () => {
  it('queries playbackEvent.findMany with the active window (30min) and STREAM_PROGRESS_EVENTS', async () => {
    eventFindMany.mockResolvedValue([])

    await runPlaybackHeartbeat(NOW)

    expect(eventFindMany).toHaveBeenCalledTimes(1)
    const call = eventFindMany.mock.calls[0]?.[0]
    expect(call?.where?.eventType).toEqual({
      in: ['song_start', 'song_complete', 'song_skip', 'ad_play'],
    })
    expect(call?.where?.occurredAt).toEqual({
      gte: new Date(NOW.getTime() - ACTIVE_WINDOW_MS),
    })
    expect(call?.orderBy).toEqual({ occurredAt: 'desc' })
    expect(call?.select).toEqual({ storeId: true, occurredAt: true, eventType: true })
  })

  it('returns zero stats when no progress events are within the active window', async () => {
    eventFindMany.mockResolvedValue([])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats).toEqual({ scanned: 0, nudged: 0, expired: 0, failed: 0 })
    expect(eventFindFirst).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('uses the passed-in `now` Date for window cutoffs (not Date.now())', async () => {
    eventFindMany.mockResolvedValue([])
    const customNow = new Date('2030-01-01T12:00:00Z')

    await runPlaybackHeartbeat(customNow)

    const call = eventFindMany.mock.calls[0]?.[0]
    expect(call?.where?.occurredAt?.gte).toEqual(
      new Date(customNow.getTime() - ACTIVE_WINDOW_MS),
    )
  })

  it('defaults `now` to a fresh Date when no arg is passed', async () => {
    eventFindMany.mockResolvedValue([])

    await runPlaybackHeartbeat()

    const call = eventFindMany.mock.calls[0]?.[0]
    // Under fake timers, `new Date()` === NOW.
    expect(call?.where?.occurredAt?.gte).toEqual(
      new Date(NOW.getTime() - ACTIVE_WINDOW_MS),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════
// Silence-window check — "still actively emitting" path
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — silence window', () => {
  it('skips a store whose most-recent progress event is newer than the silence cutoff (healthy)', async () => {
    // Event 5min ago — well within the 10min silence window.
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: minutesAgo(5) })])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(0)
    expect(stats.failed).toBe(0)
    expect(stats.expired).toBe(0)
    expect(eventFindFirst).not.toHaveBeenCalled()
    expect(subFindFirst).not.toHaveBeenCalled()
    expect(subFindMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('nudges a store whose most-recent progress event is older than the silence cutoff', async () => {
    // Event 15min ago — past the 10min silence threshold but inside the 30min active window.
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: minutesAgo(15) })])
    subFindMany.mockResolvedValue([makeSubscription()])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(1)
  })

  it('boundary: event exactly at the silence cutoff falls through to nudge path (lastAt > silenceCutoff is strict-greater)', async () => {
    // Construct an event whose occurredAt equals silenceCutoff exactly.
    const silenceCutoff = new Date(NOW.getTime() - SILENCE_WINDOW_MS)
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: silenceCutoff })])
    subFindMany.mockResolvedValue([makeSubscription()])

    const stats = await runPlaybackHeartbeat(NOW)

    // lastAt > silenceCutoff is false at equality → does NOT continue → nudges.
    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(1)
  })

  it('boundary: event 1ms newer than the silence cutoff is healthy (no nudge)', async () => {
    const silenceCutoff = new Date(NOW.getTime() - SILENCE_WINDOW_MS)
    eventFindMany.mockResolvedValue([
      makeProgressEvent({ occurredAt: new Date(silenceCutoff.getTime() + 1) }),
    ])
    subFindMany.mockResolvedValue([makeSubscription()])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Most-recent event guard (operator_pause / operator_logout)
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — operator-action guard', () => {
  beforeEach(() => {
    // Set up a stale store that would otherwise nudge.
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: minutesAgo(15) })])
    subFindMany.mockResolvedValue([makeSubscription()])
  })

  it('skips when the most-recent event of any type is operator_pause', async () => {
    eventFindFirst.mockResolvedValue({ eventType: 'operator_pause' })

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(0)
    expect(subFindFirst).not.toHaveBeenCalled()
    expect(subFindMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('skips when the most-recent event of any type is operator_logout', async () => {
    eventFindFirst.mockResolvedValue({ eventType: 'operator_logout' })

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT skip when the most-recent event is some other type (e.g. song_skip)', async () => {
    eventFindFirst.mockResolvedValue({ eventType: 'song_skip' })

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.nudged).toBe(1)
  })

  it('does NOT skip when there is no most-recent event row (defensive null)', async () => {
    eventFindFirst.mockResolvedValue(null)

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.nudged).toBe(1)
  })

  it('queries the most-recent event with storeId + active-window cutoff', async () => {
    eventFindFirst.mockResolvedValue(null)

    await runPlaybackHeartbeat(NOW)

    expect(eventFindFirst).toHaveBeenCalledWith({
      where: { storeId: 'store-1', occurredAt: { gte: new Date(NOW.getTime() - ACTIVE_WINDOW_MS) } },
      orderBy: { occurredAt: 'desc' },
      select: { eventType: true },
    })
  })
})

// ════════════════════════════════════════════════════════════════════════
// Cooldown
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — cooldown', () => {
  beforeEach(() => {
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: minutesAgo(15) })])
    subFindMany.mockResolvedValue([makeSubscription()])
  })

  it('skips when any subscription for the store was nudged within the cooldown window', async () => {
    subFindFirst.mockResolvedValue({ id: 'recently-nudged-sub' })

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(0)
    expect(subFindMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(subUpdateMany).not.toHaveBeenCalled()
  })

  it('queries the cooldown with storeId + lastNudgedAt gte (now - 30min)', async () => {
    subFindFirst.mockResolvedValue(null)

    await runPlaybackHeartbeat(NOW)

    expect(subFindFirst).toHaveBeenCalledWith({
      where: {
        storeId: 'store-1',
        lastNudgedAt: { gte: new Date(NOW.getTime() - NUDGE_COOLDOWN_MS) },
      },
      select: { id: true },
    })
  })

  it('proceeds when no subscription has been nudged within the cooldown', async () => {
    subFindFirst.mockResolvedValue(null)

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.nudged).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Subscriptions / send fanout
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — send fanout', () => {
  beforeEach(() => {
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: minutesAgo(15) })])
  })

  it('skips silently when there are zero subscriptions for the store (no updateMany either)', async () => {
    subFindMany.mockResolvedValue([])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(1)
    expect(stats.nudged).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(subUpdateMany).not.toHaveBeenCalled()
  })

  it('calls sendPush once per subscription with the expected payload', async () => {
    subFindMany.mockResolvedValue([
      makeSubscription({ id: 'sub-a', endpoint: 'https://e/a', p256dhKey: 'pa', authKey: 'aa' }),
      makeSubscription({ id: 'sub-b', endpoint: 'https://e/b', p256dhKey: 'pb', authKey: 'ab' }),
    ])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(
      1,
      { id: 'sub-a', endpoint: 'https://e/a', p256dhKey: 'pa', authKey: 'aa' },
      { title: 'Acme Cafe', body: 'Music paused — tap to resume.', storeId: 'store-1', url: '/' },
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      { id: 'sub-b', endpoint: 'https://e/b', p256dhKey: 'pb', authKey: 'ab' },
      { title: 'Acme Cafe', body: 'Music paused — tap to resume.', storeId: 'store-1', url: '/' },
    )
    expect(stats.nudged).toBe(2)
  })

  it('falls back to title="Entuned" when the store name is empty/null', async () => {
    // First sub.store.name is empty string → nullish-coalesce falls through to 'Entuned'.
    subFindMany.mockResolvedValue([
      { id: 'sub-1', endpoint: 'e', p256dhKey: 'p', authKey: 'a', store: { name: null } },
    ])

    await runPlaybackHeartbeat(NOW)

    expect(send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ title: 'Entuned' }),
    )
  })

  it('counts mixed sendPush outcomes correctly (sent + expired + failed)', async () => {
    subFindMany.mockResolvedValue([
      makeSubscription({ id: 'a' }),
      makeSubscription({ id: 'b' }),
      makeSubscription({ id: 'c' }),
      makeSubscription({ id: 'd' }),
    ])
    send
      .mockResolvedValueOnce('sent')
      .mockResolvedValueOnce('expired')
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('sent')

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats).toEqual({ scanned: 1, nudged: 2, expired: 1, failed: 1 })
  })

  it('calls pushSubscription.updateMany with storeId + lastNudgedAt=now after sending', async () => {
    subFindMany.mockResolvedValue([makeSubscription()])

    await runPlaybackHeartbeat(NOW)

    expect(subUpdateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      data: { lastNudgedAt: NOW },
    })
  })

  it('queries subscriptions with storeId and selects nested store.name', async () => {
    subFindMany.mockResolvedValue([makeSubscription()])

    await runPlaybackHeartbeat(NOW)

    expect(subFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1' },
      select: {
        id: true,
        endpoint: true,
        p256dhKey: true,
        authKey: true,
        store: { select: { name: true } },
      },
    })
  })
})

// ════════════════════════════════════════════════════════════════════════
// Multi-store + de-dup
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — multi-store and de-dup', () => {
  it('groups events by store, taking only the most-recent (first-seen) per storeId', async () => {
    // findMany returns events orderBy occurredAt desc — so the FIRST event
    // per storeId is the most recent. Subsequent events for the same store
    // must be ignored (Map.has guard in the source).
    eventFindMany.mockResolvedValue([
      // store-A: most recent = 5min ago (healthy)
      makeProgressEvent({ storeId: 'store-A', occurredAt: minutesAgo(5) }),
      makeProgressEvent({ storeId: 'store-A', occurredAt: minutesAgo(25) }),
      // store-B: most recent = 15min ago (stale → should nudge)
      makeProgressEvent({ storeId: 'store-B', occurredAt: minutesAgo(15) }),
      makeProgressEvent({ storeId: 'store-B', occurredAt: minutesAgo(28) }),
    ])
    subFindMany.mockResolvedValue([makeSubscription({ id: 'sub-b1' })])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(2) // both stores scanned
    expect(stats.nudged).toBe(1) // only store-B
    // The nudge fanout queries used store-B (the stale one).
    expect(subFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storeId: 'store-B' } }))
  })

  it('scans every store with a stale most-recent event independently', async () => {
    eventFindMany.mockResolvedValue([
      makeProgressEvent({ storeId: 'store-A', occurredAt: minutesAgo(15) }),
      makeProgressEvent({ storeId: 'store-B', occurredAt: minutesAgo(20) }),
    ])
    subFindMany.mockResolvedValue([makeSubscription()])

    const stats = await runPlaybackHeartbeat(NOW)

    expect(stats.scanned).toBe(2)
    expect(stats.nudged).toBe(2)
    // updateMany ran once per store.
    expect(subUpdateMany).toHaveBeenCalledTimes(2)
  })
})

// ════════════════════════════════════════════════════════════════════════
// Idempotency
// ════════════════════════════════════════════════════════════════════════

describe('runPlaybackHeartbeat — idempotency', () => {
  it('second run within cooldown does not double-nudge (cooldown short-circuits)', async () => {
    eventFindMany.mockResolvedValue([makeProgressEvent({ occurredAt: minutesAgo(15) })])
    subFindMany.mockResolvedValue([makeSubscription()])

    // First run: no cooldown hit → nudges.
    subFindFirst.mockResolvedValueOnce(null)
    const stats1 = await runPlaybackHeartbeat(NOW)
    expect(stats1.nudged).toBe(1)

    // Second run: cooldown sub exists (simulating updateMany's effect from run 1).
    subFindFirst.mockResolvedValueOnce({ id: 'sub-1' })
    const stats2 = await runPlaybackHeartbeat(NOW)
    expect(stats2.nudged).toBe(0)
    // sendPush should still only have been called once total.
    expect(send).toHaveBeenCalledTimes(1)
  })
})
