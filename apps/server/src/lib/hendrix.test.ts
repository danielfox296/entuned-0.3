// Unit tests for lib/hendrix.ts — Card 18 playback routing.
//
// Covered exports: nextQueue (the only export — all rotation/pool/panic logic
// is exercised through it).
//
// Mocking strategy:
//   - Prisma is fully mocked (vi.mock('../db.js')).
//   - resolveActiveOutcome from ./outcomeSchedule.js is mocked (we only care
//     about hendrix's reaction to the resolved value, not schedule math).
//   - tier.ts helpers are NOT mocked — they're pure and inexpensive.
//   - vi.resetAllMocks() in beforeEach (some tests stub one-off implementations
//     on shared mocks; clearAllMocks would leak).
//
// Source observation: hendrix.ts only exports `nextQueue` plus types
// (FallbackTier, EmptyReason, QueueItem, HendrixResponse). All other functions
// (fetchPool, applyFilters, rankByPlayCount, dedupeBySong, dedupeBySibling,
// hydrateQueue, buildQueueFromPool, injectAdIfDue, serializeOutcome,
// roomLoudnessFlag, siblingKey, fetchRetiredSongIds, fetchAllPool) are
// module-private. We test them through nextQueue.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: {
    store: { findUnique: vi.fn() },
    playbackRules: { findFirst: vi.fn() },
    iCP: { findMany: vi.fn() },
    storeRetiredSong: { findMany: vi.fn() },
    lineageRow: { findMany: vi.fn() },
    playbackEvent: { findMany: vi.fn(), groupBy: vi.fn() },
    hook: { findMany: vi.fn() },
    outcome: { findUnique: vi.fn() },
    campaign: { findMany: vi.fn() },
    campaignPlayState: { upsert: vi.fn() },
  },
}))

vi.mock('./outcomeSchedule.js', () => ({
  resolveActiveOutcome: vi.fn(),
}))

import { nextQueue } from './hendrix.js'
import { prisma } from '../db.js'
import { resolveActiveOutcome } from './outcomeSchedule.js'
import { FREE_TIER_AD_STORE_ID } from './freeTier.js'

// --- mock handles ---------------------------------------------------------

const storeFindUnique = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>
const playbackRulesFindFirst = prisma.playbackRules.findFirst as unknown as ReturnType<typeof vi.fn>
const icpFindMany = prisma.iCP.findMany as unknown as ReturnType<typeof vi.fn>
const retiredFindMany = prisma.storeRetiredSong.findMany as unknown as ReturnType<typeof vi.fn>
const lineageFindMany = prisma.lineageRow.findMany as unknown as ReturnType<typeof vi.fn>
const eventFindMany = prisma.playbackEvent.findMany as unknown as ReturnType<typeof vi.fn>
const eventGroupBy = prisma.playbackEvent.groupBy as unknown as ReturnType<typeof vi.fn>
const hookFindMany = prisma.hook.findMany as unknown as ReturnType<typeof vi.fn>
const outcomeFindUnique = prisma.outcome.findUnique as unknown as ReturnType<typeof vi.fn>
const campaignFindMany = prisma.campaign.findMany as unknown as ReturnType<typeof vi.fn>
const playStateUpsert = prisma.campaignPlayState.upsert as unknown as ReturnType<typeof vi.fn>
const resolveOutcomeMock = resolveActiveOutcome as unknown as ReturnType<typeof vi.fn>

// --- fixtures -------------------------------------------------------------

interface FullStore {
  id: string
  tier: string
  compTier: string | null
  compExpiresAt: Date | null
  timezone: string
  roomLoudnessSamplingEnabled: boolean
}

function makeStoreRow(overrides: Partial<FullStore> = {}): FullStore {
  return {
    id: 'store-1',
    tier: 'pro',
    compTier: null,
    compExpiresAt: null,
    timezone: 'UTC',
    roomLoudnessSamplingEnabled: false,
    ...overrides,
  }
}

// A pool row matches PoolRow's `select` shape.
interface PoolRowInput {
  id: string
  songId: string
  r2Url: string
  hookId: string | null
  songSeedId: string | null
  outcomeId: string
  icpId: string | null
}
function poolRow(overrides: Partial<PoolRowInput> & { id: string; songId: string }): PoolRowInput {
  return {
    r2Url: `https://r2/${overrides.songId}.mp3`,
    hookId: null,
    songSeedId: null,
    outcomeId: 'oc-1',
    icpId: 'icp-1',
    ...overrides,
  }
}

// --- common defaults ------------------------------------------------------
//
// Sets minimal mocks so a call to `nextQueue('store-1')` will succeed if a
// test cares only about a specific branch. Override per-test where needed.

function defaultMocks(opts: {
  store?: Partial<FullStore> | null
  icps?: string[]
  retired?: string[]
  resolvedOutcome?: { outcomeId: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: Date } | null
  pool?: PoolRowInput[]
  rules?: { siblingSpacingMinutes: number; noRepeatWindowMinutes: number } | null
} = {}) {
  storeFindUnique.mockResolvedValue(opts.store === null ? null : makeStoreRow(opts.store))
  playbackRulesFindFirst.mockResolvedValue(opts.rules === undefined ? { siblingSpacingMinutes: 240, noRepeatWindowMinutes: 45 } : opts.rules)
  icpFindMany.mockResolvedValue((opts.icps ?? ['icp-1']).map((id) => ({ id })))
  retiredFindMany.mockResolvedValue((opts.retired ?? []).map((songId) => ({ songId })))
  resolveOutcomeMock.mockResolvedValue(opts.resolvedOutcome === undefined
    ? { outcomeId: 'oc-1', source: 'default' as const }
    : opts.resolvedOutcome)

  // lineageRow.findMany covers BOTH the pool query (fetchPool / fetchAllPool)
  // AND the seed-sibling-block query inside applyFilters. The pool query
  // includes `active: true` and `icpId` (single or {in}); the seed query
  // includes `songSeedId: { in: [...] }` and `song: { playbackEvents: ... }`.
  // The hydrateQueue lineage lookup has `id: { in: [...] }` and a `select` with `songSeed`.
  lineageFindMany.mockImplementation(async (args: any = {}) => {
    const where = args?.where ?? {}
    if (where.songSeedId && where.song?.playbackEvents) {
      // sibling-seed block check — by default no recent seeds.
      return []
    }
    if (where.id?.in) {
      // hydrateQueue lineage lookup — return one row per id with no songSeed title.
      return (where.id.in as string[]).map((id) => ({ id, songSeed: null }))
    }
    // Default to opts.pool when present; else empty.
    return opts.pool ?? []
  })

  eventFindMany.mockResolvedValue([])
  eventGroupBy.mockResolvedValue([])
  hookFindMany.mockResolvedValue([])
  outcomeFindUnique.mockResolvedValue({ title: 'Test Outcome', displayTitle: null })
  campaignFindMany.mockResolvedValue([])
  playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 0 })
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  delete process.env.ROOM_LOUDNESS_SAMPLING_KILL
})

// =========================================================================
// nextQueue — store lookup / shell
// =========================================================================

describe('nextQueue — missing store', () => {
  it('returns empty-queue shell with reason="no_pool" when store does not exist', async () => {
    defaultMocks({ store: null })
    const res = await nextQueue('does-not-exist')
    expect(res.storeId).toBe('does-not-exist')
    expect(res.queue).toEqual([])
    expect(res.fallbackTier).toBe('normal')
    expect(res.reason).toBe('no_pool')
    expect(res.activeOutcome).toBeNull()
    expect(res.roomLoudnessSamplingEnabled).toBe(false)
    expect(typeof res.decidedAt).toBe('string')
    // Must short-circuit before any downstream queries.
    expect(resolveOutcomeMock).not.toHaveBeenCalled()
    expect(icpFindMany).not.toHaveBeenCalled()
  })

  it('uses the provided `now` for decidedAt when explicitly passed', async () => {
    defaultMocks({ store: null })
    const now = new Date('2026-05-18T12:00:00Z')
    const res = await nextQueue('missing', now)
    expect(res.decidedAt).toBe(now.toISOString())
  })
})

// =========================================================================
// roomLoudnessSamplingEnabled flag
// =========================================================================

describe('nextQueue — room-loudness sampling flag', () => {
  it('mirrors store.roomLoudnessSamplingEnabled when env kill switch is unset', async () => {
    defaultMocks({ store: { roomLoudnessSamplingEnabled: true } })
    const res = await nextQueue('store-1')
    expect(res.roomLoudnessSamplingEnabled).toBe(true)
  })

  it('forces false when ROOM_LOUDNESS_SAMPLING_KILL=true even if store has it enabled', async () => {
    process.env.ROOM_LOUDNESS_SAMPLING_KILL = 'true'
    defaultMocks({ store: { roomLoudnessSamplingEnabled: true } })
    const res = await nextQueue('store-1')
    expect(res.roomLoudnessSamplingEnabled).toBe(false)
  })

  it('kill switch only triggers on the exact string "true"', async () => {
    process.env.ROOM_LOUDNESS_SAMPLING_KILL = 'TRUE'
    defaultMocks({ store: { roomLoudnessSamplingEnabled: true } })
    const res = await nextQueue('store-1')
    expect(res.roomLoudnessSamplingEnabled).toBe(true)
  })

  it('returns false on missing-store path regardless of kill switch', async () => {
    defaultMocks({ store: null })
    const res = await nextQueue('missing')
    expect(res.roomLoudnessSamplingEnabled).toBe(false)
  })
})

// =========================================================================
// Outcome resolution paths
// =========================================================================

describe('nextQueue — outcome resolution', () => {
  it('serializes resolved outcome via Outcome.findUnique, preferring displayTitle over title', async () => {
    defaultMocks({
      resolvedOutcome: { outcomeId: 'oc-1', source: 'schedule' },
      pool: [poolRow({ id: 'lr-1', songId: 'song-1' })],
    })
    outcomeFindUnique.mockResolvedValue({ title: 'Raw title', displayTitle: 'Pretty title' })

    const res = await nextQueue('store-1')
    expect(res.activeOutcome).toEqual({
      outcomeId: 'oc-1',
      title: 'Pretty title',
      source: 'schedule',
      expiresAt: undefined,
    })
  })

  it('falls back to title when displayTitle is null', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 'song-1' })] })
    outcomeFindUnique.mockResolvedValue({ title: 'Raw title', displayTitle: null })
    const res = await nextQueue('store-1')
    expect(res.activeOutcome?.title).toBe('Raw title')
  })

  it('falls back to outcomeId when Outcome.findUnique returns null', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 'song-1' })] })
    outcomeFindUnique.mockResolvedValue(null)
    const res = await nextQueue('store-1')
    expect(res.activeOutcome?.title).toBe('oc-1')
  })

  it('serializes selection expiresAt as ISO string', async () => {
    const expires = new Date('2027-01-01T00:00:00Z')
    defaultMocks({
      resolvedOutcome: { outcomeId: 'oc-1', source: 'selection', expiresAt: expires },
      pool: [poolRow({ id: 'lr-1', songId: 'song-1' })],
    })
    const res = await nextQueue('store-1')
    expect(res.activeOutcome?.source).toBe('selection')
    expect(res.activeOutcome?.expiresAt).toBe(expires.toISOString())
  })

  it('when resolveActiveOutcome returns null, falls back to all-outcomes pool and activeOutcome is null', async () => {
    defaultMocks({
      resolvedOutcome: null,
      pool: [poolRow({ id: 'lr-1', songId: 'song-1', outcomeId: 'oc-9' })],
    })
    const res = await nextQueue('store-1')
    expect(res.activeOutcome).toBeNull()
    expect(res.queue).toHaveLength(1)
    expect(res.queue[0]?.songId).toBe('song-1')
    expect(res.reason).toBeNull()
  })

  it('when resolved outcome exists but its pool is empty, falls back to all-outcomes pool (activeOutcome still serialized)', async () => {
    let call = 0
    lineageFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.songSeedId && where.song?.playbackEvents) return []
      if (where.id?.in) {
        return (where.id.in as string[]).map((id) => ({ id, songSeed: null }))
      }
      // First pool call (fetchPool for resolved outcome) → empty.
      // Second pool call (fetchAllPool) → one row.
      call++
      if (call === 1) return [] // resolved-outcome pool empty
      return [poolRow({ id: 'lr-9', songId: 'song-9', outcomeId: 'oc-other' })]
    })
    storeFindUnique.mockResolvedValue(makeStoreRow())
    playbackRulesFindFirst.mockResolvedValue({ siblingSpacingMinutes: 240, noRepeatWindowMinutes: 45 })
    icpFindMany.mockResolvedValue([{ id: 'icp-1' }])
    retiredFindMany.mockResolvedValue([])
    resolveOutcomeMock.mockResolvedValue({ outcomeId: 'oc-1', source: 'default' })
    eventFindMany.mockResolvedValue([])
    eventGroupBy.mockResolvedValue([])
    hookFindMany.mockResolvedValue([])
    outcomeFindUnique.mockResolvedValue({ title: 'Resolved', displayTitle: null })
    campaignFindMany.mockResolvedValue([])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 0 })

    const res = await nextQueue('store-1')
    expect(res.activeOutcome?.outcomeId).toBe('oc-1') // still serialized
    expect(res.queue).toHaveLength(1)
    expect(res.queue[0]?.songId).toBe('song-9')
  })

  it('uses default playback rules (240/45) when PlaybackRules table is empty', async () => {
    defaultMocks({
      pool: [poolRow({ id: 'lr-1', songId: 'song-1' })],
      rules: null,
    })
    const res = await nextQueue('store-1')
    expect(res.queue).toHaveLength(1)
    // Pin that nextQueue actually ran the rules-fallback branch.
    expect(playbackRulesFindFirst).toHaveBeenCalled()
  })
})

// =========================================================================
// ICPs / retired songs / empty pool
// =========================================================================

describe('nextQueue — ICP & retired songs', () => {
  it('returns reason="no_pool" and normal fallbackTier when no songs anywhere', async () => {
    defaultMocks({ pool: [] })
    const res = await nextQueue('store-1')
    expect(res.queue).toEqual([])
    expect(res.reason).toBe('no_pool')
    expect(res.fallbackTier).toBe('normal')
  })

  it('queries ICPs scoped to the store with archivedAt:null', async () => {
    defaultMocks({ pool: [] })
    await nextQueue('store-1')
    expect(icpFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        storeLinks: { some: { storeId: 'store-1' } },
        archivedAt: null,
      }),
    }))
  })

  it('forwards retired songIds into the pool query notIn filter', async () => {
    defaultMocks({
      retired: ['song-retired-1', 'song-retired-2'],
      pool: [poolRow({ id: 'lr-1', songId: 'song-1' })],
    })
    await nextQueue('store-1')
    // First lineage.findMany invocation is fetchPool — locate it.
    const poolCall = lineageFindMany.mock.calls.find((c) => {
      const where = (c[0] as any)?.where
      return where && 'icpId' in where && where.active === true
    })
    expect(poolCall).toBeTruthy()
    const where = (poolCall![0] as any).where
    expect(where.songId).toEqual({ notIn: ['song-retired-1', 'song-retired-2'] })
  })

  it('omits songId filter entirely when there are no retired songs', async () => {
    defaultMocks({
      retired: [],
      pool: [poolRow({ id: 'lr-1', songId: 'song-1' })],
    })
    await nextQueue('store-1')
    const poolCall = lineageFindMany.mock.calls.find((c) => {
      const where = (c[0] as any)?.where
      return where && 'icpId' in where && where.active === true
    })
    const where = (poolCall![0] as any).where
    expect(where.songId).toBeUndefined()
  })

  it('pool query restricts to active rows only', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 'song-1' })] })
    await nextQueue('store-1')
    const poolCall = lineageFindMany.mock.calls.find((c) => {
      const where = (c[0] as any)?.where
      return where && 'icpId' in where && where.active === true
    })
    expect(poolCall).toBeTruthy()
    expect((poolCall![0] as any).where.active).toBe(true)
  })
})

// =========================================================================
// Rotation: filters, ranking, top-3 slice, dedupe
// =========================================================================

describe('nextQueue — rotation: filtering + ranking', () => {
  it('returns up to 3 songs from the pool in the normal path', async () => {
    const pool = [
      poolRow({ id: 'lr-1', songId: 's1' }),
      poolRow({ id: 'lr-2', songId: 's2' }),
      poolRow({ id: 'lr-3', songId: 's3' }),
      poolRow({ id: 'lr-4', songId: 's4' }),
      poolRow({ id: 'lr-5', songId: 's5' }),
    ]
    defaultMocks({ pool })
    const res = await nextQueue('store-1')
    expect(res.queue).toHaveLength(3)
    expect(res.fallbackTier).toBe('normal')
  })

  it('returns 1 song when only 1 in pool (normal path, not panic)', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    const res = await nextQueue('store-1')
    expect(res.queue).toHaveLength(1)
    expect(res.fallbackTier).toBe('normal')
  })

  it('ranks least-played first via PlaybackEvent.groupBy', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a' }),
      poolRow({ id: 'lr-b', songId: 'song-b' }),
      poolRow({ id: 'lr-c', songId: 'song-c' }),
    ]
    defaultMocks({ pool })
    // song-a played 10 times, song-b 1 time, song-c never (absent).
    eventGroupBy.mockResolvedValue([
      { songId: 'song-a', _count: { _all: 10 }, _max: { occurredAt: new Date('2026-05-18T11:00:00Z') } },
      { songId: 'song-b', _count: { _all: 1 }, _max: { occurredAt: new Date('2026-05-18T10:00:00Z') } },
    ])
    const res = await nextQueue('store-1')
    // Least-played first: c (0), b (1), a (10).
    expect(res.queue.map((q) => q.songId)).toEqual(['song-c', 'song-b', 'song-a'])
  })

  it('breaks play-count ties by least-recently-played', async () => {
    const pool = [
      poolRow({ id: 'lr-x', songId: 'song-x' }),
      poolRow({ id: 'lr-y', songId: 'song-y' }),
    ]
    defaultMocks({ pool })
    // Same play count, but x was last played later than y → y should come first.
    eventGroupBy.mockResolvedValue([
      { songId: 'song-x', _count: { _all: 5 }, _max: { occurredAt: new Date('2026-05-18T12:00:00Z') } },
      { songId: 'song-y', _count: { _all: 5 }, _max: { occurredAt: new Date('2026-05-18T10:00:00Z') } },
    ])
    const res = await nextQueue('store-1')
    expect(res.queue.map((q) => q.songId)).toEqual(['song-y', 'song-x'])
  })

  it('filters out songs played within noRepeatWindow', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a' }),
      poolRow({ id: 'lr-b', songId: 'song-b' }),
    ]
    defaultMocks({ pool })
    // song-a recently played → blocked. song-b survives.
    eventFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.songId?.in) {
        return [{ songId: 'song-a', occurredAt: new Date() }]
      }
      return []
    })
    const res = await nextQueue('store-1')
    expect(res.queue.map((q) => q.songId)).toEqual(['song-b'])
    expect(res.fallbackTier).toBe('normal')
  })

  it('filters out rows whose hookId recently played (sibling-spacing for paid pool)', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a', hookId: 'hook-shared' }),
      poolRow({ id: 'lr-b', songId: 'song-b', hookId: 'hook-shared' }),
      poolRow({ id: 'lr-c', songId: 'song-c', hookId: 'hook-other' }),
    ]
    defaultMocks({ pool })
    eventFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.hookId?.in) {
        // hook-shared played recently → blocks song-a and song-b.
        return [{ hookId: 'hook-shared', occurredAt: new Date() }]
      }
      return []
    })
    const res = await nextQueue('store-1')
    expect(res.queue.map((q) => q.songId)).toEqual(['song-c'])
  })

  it('filters out rows whose songSeedId recently played (sibling-spacing for free pool)', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a', songSeedId: 'seed-1' }),
      poolRow({ id: 'lr-b', songId: 'song-b', songSeedId: 'seed-1' }),
      poolRow({ id: 'lr-c', songId: 'song-c', songSeedId: 'seed-2' }),
    ]
    defaultMocks({ pool })
    lineageFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.songSeedId?.in && where.song?.playbackEvents) {
        // seed-1 has a recent play → blocks a and b.
        return [{ songSeedId: 'seed-1' }]
      }
      if (where.id?.in) {
        return (where.id.in as string[]).map((id) => ({ id, songSeed: null }))
      }
      // pool query
      return pool
    })
    const res = await nextQueue('store-1')
    expect(res.queue.map((q) => q.songId)).toEqual(['song-c'])
  })

  it('dedupeBySong removes duplicate songIds before ranking', async () => {
    const pool = [
      poolRow({ id: 'lr-a1', songId: 'song-a' }),
      poolRow({ id: 'lr-a2', songId: 'song-a' }), // duplicate songId
      poolRow({ id: 'lr-b', songId: 'song-b' }),
    ]
    defaultMocks({ pool })
    const res = await nextQueue('store-1')
    const ids = res.queue.map((q) => q.songId)
    expect(ids).toEqual(Array.from(new Set(ids))) // no duplicates
    expect(ids).toContain('song-a')
    expect(ids).toContain('song-b')
  })

  it('dedupeBySibling removes rows sharing a hookId within the batch', async () => {
    // After dedupeBySong (which uses songId), two different songIds share a hookId
    // → second-ranked sibling is dropped from the top-3 slice.
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a', hookId: 'hook-1' }),
      poolRow({ id: 'lr-b', songId: 'song-b', hookId: 'hook-1' }),
      poolRow({ id: 'lr-c', songId: 'song-c', hookId: 'hook-2' }),
    ]
    defaultMocks({ pool })
    // Ranking: a (0), b (0), c (0) — preserve pool order.
    eventGroupBy.mockResolvedValue([])
    const res = await nextQueue('store-1')
    // a comes first, c next (b is sibling-deduped), then nothing more.
    expect(res.queue.map((q) => q.songId)).toEqual(['song-a', 'song-c'])
  })

  it('dedupeBySibling uses songSeedId when hookId is null (free pool sibling case)', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a', hookId: null, songSeedId: 'seed-X' }),
      poolRow({ id: 'lr-b', songId: 'song-b', hookId: null, songSeedId: 'seed-X' }),
      poolRow({ id: 'lr-c', songId: 'song-c', hookId: null, songSeedId: 'seed-Y' }),
    ]
    defaultMocks({ pool })
    const res = await nextQueue('store-1')
    expect(res.queue.map((q) => q.songId)).toEqual(['song-a', 'song-c'])
  })
})

// =========================================================================
// Panic mode
// =========================================================================

describe('nextQueue — panic fallback', () => {
  it('returns top-ranked from unfiltered pool when every song is filtered out (panic)', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a' }),
      poolRow({ id: 'lr-b', songId: 'song-b' }),
    ]
    defaultMocks({ pool })
    // Both songs are blocked by no-repeat → eligible pool is empty → panic.
    eventFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.songId?.in) {
        return (where.songId.in as string[]).map((songId: string) => ({
          songId,
          occurredAt: new Date(),
        }))
      }
      return []
    })
    const res = await nextQueue('store-1')
    expect(res.fallbackTier).toBe('panic')
    expect(res.queue.length).toBeGreaterThan(0)
    expect(res.reason).toBeNull()
  })

  it('panic still dedupes siblings within the batch', async () => {
    const pool = [
      poolRow({ id: 'lr-a', songId: 'song-a', hookId: 'shared' }),
      poolRow({ id: 'lr-b', songId: 'song-b', hookId: 'shared' }),
      poolRow({ id: 'lr-c', songId: 'song-c', hookId: 'other' }),
    ]
    defaultMocks({ pool })
    // Block everything by no-repeat → panic.
    eventFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.songId?.in) {
        return (where.songId.in as string[]).map((songId: string) => ({ songId, occurredAt: new Date() }))
      }
      return []
    })
    const res = await nextQueue('store-1')
    expect(res.fallbackTier).toBe('panic')
    // Only one of a/b appears + c.
    const ids = res.queue.map((q) => q.songId)
    const hookSharedCount = ids.filter((id) => id === 'song-a' || id === 'song-b').length
    expect(hookSharedCount).toBe(1)
    expect(ids).toContain('song-c')
  })

  it('returns fallbackTier="normal" with reason="no_pool" when there are truly zero pool rows', async () => {
    defaultMocks({ pool: [] })
    const res = await nextQueue('store-1')
    expect(res.fallbackTier).toBe('normal')
    expect(res.queue).toEqual([])
    expect(res.reason).toBe('no_pool')
  })
})

// =========================================================================
// allOutcomes mode
// =========================================================================

describe('nextQueue — allOutcomes mode', () => {
  it('returns activeOutcome=null and does NOT call resolveActiveOutcome', async () => {
    defaultMocks({
      pool: [poolRow({ id: 'lr-1', songId: 'song-1', outcomeId: 'oc-A' })],
    })
    const res = await nextQueue('store-1', new Date(), { allOutcomes: true })
    expect(res.activeOutcome).toBeNull()
    expect(resolveOutcomeMock).not.toHaveBeenCalled()
    expect(res.queue.map((q) => q.songId)).toEqual(['song-1'])
  })

  it('queries lineage with icpId: {in: [...]} and no outcomeId restriction in allOutcomes mode', async () => {
    defaultMocks({
      icps: ['icp-A', 'icp-B'],
      pool: [poolRow({ id: 'lr-1', songId: 's1', icpId: 'icp-A' })],
    })
    await nextQueue('store-1', new Date(), { allOutcomes: true })
    const poolCall = lineageFindMany.mock.calls.find((c) => {
      const where = (c[0] as any)?.where
      return where && where.icpId?.in && where.active === true
    })
    expect(poolCall).toBeTruthy()
    const where = (poolCall![0] as any).where
    expect(where.icpId).toEqual({ in: ['icp-A', 'icp-B'] })
    expect(where.outcomeId).toBeUndefined()
  })
})

// =========================================================================
// hydrateQueue: hook/icp/title metadata
// =========================================================================

describe('nextQueue — queue item hydration', () => {
  it('hydrates hookText and icpName when available', async () => {
    const pool = [poolRow({ id: 'lr-1', songId: 's1', hookId: 'h1', icpId: 'icp-1' })]
    defaultMocks({ pool })
    hookFindMany.mockResolvedValue([{ id: 'h1', text: 'hook one text' }])
    // Override icp metadata fetcher — note: hydrateQueue uses prisma.iCP.findMany too.
    // Default mocks set icpFindMany to return [{id:'icp-1'}] without `name`.
    icpFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.id?.in) {
        return [{ id: 'icp-1', name: 'Boutique ICP' }]
      }
      // storeLinks scoped query
      return [{ id: 'icp-1' }]
    })

    const res = await nextQueue('store-1')
    expect(res.queue[0]?.hookId).toBe('h1')
    expect(res.queue[0]?.hookText).toBe('hook one text')
    expect(res.queue[0]?.icpId).toBe('icp-1')
    expect(res.queue[0]?.icpName).toBe('Boutique ICP')
  })

  it('leaves icpName and hookText null when ids are null (general-pool / free-tier shape)', async () => {
    const pool = [poolRow({ id: 'lr-1', songId: 's1', hookId: null, icpId: null, songSeedId: 'seed-X' })]
    defaultMocks({ pool })
    const res = await nextQueue('store-1')
    expect(res.queue[0]?.hookId).toBeNull()
    expect(res.queue[0]?.icpId).toBeNull()
    expect(res.queue[0]?.hookText).toBeNull()
    expect(res.queue[0]?.icpName).toBeNull()
    // Should not have queried hook.findMany at all when there are no hookIds.
    expect(hookFindMany).not.toHaveBeenCalled()
  })

  it('hydrates title from songSeed when present, null otherwise', async () => {
    const pool = [
      poolRow({ id: 'lr-1', songId: 's1' }),
      poolRow({ id: 'lr-2', songId: 's2' }),
    ]
    defaultMocks({ pool })
    lineageFindMany.mockImplementation(async (args: any = {}) => {
      const where = args?.where ?? {}
      if (where.songSeedId && where.song?.playbackEvents) return []
      if (where.id?.in) {
        return [
          { id: 'lr-1', songSeed: { title: 'A Quiet Workday' } },
          { id: 'lr-2', songSeed: null },
        ]
      }
      return pool
    })
    const res = await nextQueue('store-1')
    const byId = new Map(res.queue.map((q) => [q.songId, q]))
    expect(byId.get('s1')?.title).toBe('A Quiet Workday')
    expect(byId.get('s2')?.title).toBeNull()
  })

  it('does not query Hook or ICP metadata when top batch has no hookIds or icpIds', async () => {
    const pool = [poolRow({ id: 'lr-1', songId: 's1', hookId: null, icpId: null, songSeedId: 'seed-X' })]
    defaultMocks({ pool })
    await nextQueue('store-1')
    expect(hookFindMany).not.toHaveBeenCalled()
    // The first iCP.findMany call (for store ICPs) happens, but no second
    // call with `id: { in: ... }` should occur.
    const idInCall = icpFindMany.mock.calls.find((c) => (c[0] as any)?.where?.id?.in)
    expect(idInCall).toBeUndefined()
  })
})

// =========================================================================
// Ad injection — tier routing + cadence
// =========================================================================

describe('nextQueue — ad injection: tier routing', () => {
  it('paid stores query campaigns scoped to their own storeId', async () => {
    defaultMocks({
      store: { tier: 'pro' },
      pool: [poolRow({ id: 'lr-1', songId: 's1' })],
    })
    await nextQueue('store-1')
    const callArg = campaignFindMany.mock.calls[0]?.[0]
    expect(callArg?.where?.storeId).toBe('store-1')
  })

  it('free stores route ads through FREE_TIER_AD_STORE_ID', async () => {
    defaultMocks({
      store: { tier: 'free' },
      pool: [poolRow({ id: 'lr-1', songId: 's1' })],
    })
    await nextQueue('store-1')
    const callArg = campaignFindMany.mock.calls[0]?.[0]
    expect(callArg?.where?.storeId).toBe(FREE_TIER_AD_STORE_ID)
  })

  it('comp-upgraded free store routes as paid (effectiveTier > free)', async () => {
    const farFuture = new Date('2099-01-01T00:00:00Z')
    defaultMocks({
      store: { tier: 'free', compTier: 'pro', compExpiresAt: farFuture },
      pool: [poolRow({ id: 'lr-1', songId: 's1' })],
    })
    await nextQueue('store-1')
    const callArg = campaignFindMany.mock.calls[0]?.[0]
    expect(callArg?.where?.storeId).toBe('store-1')
  })

  it('expired comp on free store routes as free (comp ignored)', async () => {
    const past = new Date('2000-01-01T00:00:00Z')
    defaultMocks({
      store: { tier: 'free', compTier: 'pro', compExpiresAt: past },
      pool: [poolRow({ id: 'lr-1', songId: 's1' })],
    })
    await nextQueue('store-1')
    const callArg = campaignFindMany.mock.calls[0]?.[0]
    expect(callArg?.where?.storeId).toBe(FREE_TIER_AD_STORE_ID)
  })

  it('skips ad injection entirely when queue is empty (no campaign query)', async () => {
    defaultMocks({ pool: [] })
    await nextQueue('store-1')
    expect(campaignFindMany).not.toHaveBeenCalled()
    expect(playStateUpsert).not.toHaveBeenCalled()
  })

  it('returns queue unchanged when there are no active campaigns', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    campaignFindMany.mockResolvedValue([])
    const res = await nextQueue('store-1')
    expect(res.queue).toHaveLength(1)
    expect(res.queue[0]?.type).toBeUndefined()
  })

  it('returns queue unchanged when active campaign has no adAssets', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    campaignFindMany.mockResolvedValue([
      { id: 'camp-1', adAssets: [], songsPerAd: 3, assetState: null },
    ])
    const res = await nextQueue('store-1')
    expect(res.queue).toHaveLength(1)
    expect(res.queue[0]?.type).not.toBe('ad')
  })
})

describe('nextQueue — ad cadence', () => {
  const camp = {
    id: 'camp-1',
    songsPerAd: 3,
    adAssets: [
      { id: 'asset-1', r2Url: 'https://r2/ad-1.mp3', label: 'Ad One', position: 0 },
      { id: 'asset-2', r2Url: 'https://r2/ad-2.mp3', label: 'Ad Two', position: 1 },
    ],
    assetState: { nextAssetIndex: 0 },
  }

  it('injects ad at position 0 when songsPlayedSinceAd >= songsPerAd', async () => {
    defaultMocks({
      pool: [
        poolRow({ id: 'lr-1', songId: 's1' }),
        poolRow({ id: 'lr-2', songId: 's2' }),
        poolRow({ id: 'lr-3', songId: 's3' }),
      ],
    })
    campaignFindMany.mockResolvedValue([camp])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 3 })

    const res = await nextQueue('store-1')
    expect(res.queue[0]?.type).toBe('ad')
    expect(res.queue[0]?.assetId).toBe('asset-1')
    expect(res.queue[0]?.campaignId).toBe('camp-1')
    expect(res.queue[0]?.audioUrl).toBe('https://r2/ad-1.mp3')
    expect(res.queue[0]?.title).toBe('Ad One')
    expect(res.queue.length).toBe(4) // 1 ad + 3 songs
  })

  it('rotates through adAssets via assetState.nextAssetIndex modulo length', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    campaignFindMany.mockResolvedValue([{ ...camp, assetState: { nextAssetIndex: 1 } }])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 99 })
    const res = await nextQueue('store-1')
    expect(res.queue[0]?.type).toBe('ad')
    expect(res.queue[0]?.assetId).toBe('asset-2')
  })

  it('handles nextAssetIndex larger than adAssets.length via modulo', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    // index 5 mod 2 → 1.
    campaignFindMany.mockResolvedValue([{ ...camp, assetState: { nextAssetIndex: 5 } }])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 3 })
    const res = await nextQueue('store-1')
    expect(res.queue[0]?.assetId).toBe('asset-2')
  })

  it('treats null assetState as nextAssetIndex=0', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    campaignFindMany.mockResolvedValue([{ ...camp, assetState: null }])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 3 })
    const res = await nextQueue('store-1')
    expect(res.queue[0]?.assetId).toBe('asset-1')
  })

  it('truncates the queue to (songsPerAd - songsPlayed) when not yet due', async () => {
    defaultMocks({
      pool: [
        poolRow({ id: 'lr-1', songId: 's1' }),
        poolRow({ id: 'lr-2', songId: 's2' }),
        poolRow({ id: 'lr-3', songId: 's3' }),
      ],
    })
    campaignFindMany.mockResolvedValue([camp])
    // songsPerAd=3, songsPlayed=1 → return at most 2 songs.
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 1 })
    const res = await nextQueue('store-1')
    expect(res.queue.length).toBe(2)
    expect(res.queue.every((q) => q.type !== 'ad')).toBe(true)
  })

  it('upserts CampaignPlayState scoped to the calling store (not the ad-source store)', async () => {
    defaultMocks({
      store: { tier: 'free' },
      pool: [poolRow({ id: 'lr-1', songId: 's1' })],
    })
    campaignFindMany.mockResolvedValue([camp])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 3 })
    await nextQueue('store-1')
    expect(playStateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { storeId: 'store-1' },
      create: { storeId: 'store-1', songsPlayedSinceAd: 0 },
      update: {},
    }))
  })

  it('picks first campaign with at least one adAsset (skips empty ones)', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    campaignFindMany.mockResolvedValue([
      { id: 'camp-empty', songsPerAd: 3, adAssets: [], assetState: null },
      camp,
    ])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 3 })
    const res = await nextQueue('store-1')
    expect(res.queue[0]?.type).toBe('ad')
    expect(res.queue[0]?.campaignId).toBe('camp-1')
  })
})

// =========================================================================
// QueueItem shape contract
// =========================================================================

describe('nextQueue — QueueItem shape', () => {
  it('song items have type undefined and all expected keys', async () => {
    const pool = [poolRow({
      id: 'lr-1',
      songId: 's1',
      hookId: 'h1',
      songSeedId: 'seed-1',
      outcomeId: 'oc-1',
      icpId: 'icp-1',
      r2Url: 'https://r2/s1.mp3',
    })]
    defaultMocks({ pool })
    const res = await nextQueue('store-1')
    const item = res.queue[0]!
    expect(item.songId).toBe('s1')
    expect(item.audioUrl).toBe('https://r2/s1.mp3')
    expect(item.hookId).toBe('h1')
    expect(item.songSeedId).toBe('seed-1')
    expect(item.outcomeId).toBe('oc-1')
    expect(item.icpId).toBe('icp-1')
    expect(item.type).toBeUndefined()
    expect(item.assetId).toBeUndefined()
    expect(item.campaignId).toBeUndefined()
  })

  it('ad items have outcomeId="" and hookId/songSeedId/icpId null', async () => {
    defaultMocks({ pool: [poolRow({ id: 'lr-1', songId: 's1' })] })
    campaignFindMany.mockResolvedValue([{
      id: 'camp-1',
      songsPerAd: 3,
      adAssets: [{ id: 'asset-1', r2Url: 'https://r2/ad.mp3', label: 'Ad', position: 0 }],
      assetState: { nextAssetIndex: 0 },
    }])
    playStateUpsert.mockResolvedValue({ storeId: 'store-1', songsPlayedSinceAd: 5 })
    const res = await nextQueue('store-1')
    const adItem = res.queue.find((q) => q.type === 'ad')!
    expect(adItem.outcomeId).toBe('')
    expect(adItem.hookId).toBeNull()
    expect(adItem.songSeedId).toBeNull()
    expect(adItem.icpId).toBeNull()
    expect(adItem.icpName).toBeNull()
    expect(adItem.hookText).toBeNull()
  })
})
