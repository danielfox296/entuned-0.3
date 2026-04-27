// Card 18 Hendrix — playback routing.
// Resolves outcome, builds eligible pool, applies rotation rules with tiered fallback.

import { prisma } from '../db.js'
import { resolveActiveOutcome } from './outcomeSchedule.js'

export type FallbackTier = 'none' | 'daily_cap' | 'sibling_spacing' | 'no_repeat_window'
export type EmptyReason = 'no_pool' | null

export interface QueueItem {
  songId: string
  audioUrl: string
  hookId: string
  outcomeId: string
}

export interface HendrixResponse {
  storeId: string
  decidedAt: string
  activeOutcome: { outcomeId: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: string } | null
  queue: QueueItem[]
  fallbackTier: FallbackTier
  reason: EmptyReason
}

interface PoolRow {
  id: string
  songId: string
  r2Url: string
  hookId: string
  outcomeId: string
}

async function fetchPool(icpId: string, outcomeId: string): Promise<PoolRow[]> {
  const rows = await prisma.lineageRow.findMany({
    where: { icpId, outcomeId, active: true },
    select: { id: true, songId: true, r2Url: true, hookId: true, outcomeId: true },
  })
  return rows
}

async function applyFilters(
  storeId: string,
  pool: PoolRow[],
  applyDailyCap: boolean,
  applySiblingSpacing: boolean,
  applyNoRepeat: boolean,
  rules: { siblingSpacingMinutes: number; noRepeatWindowMinutes: number; dailyCap: number },
  now: Date,
  timezone: string,
): Promise<PoolRow[]> {
  if (pool.length === 0) return pool

  const songIds = [...new Set(pool.map((r) => r.songId))]
  const hookIds = [...new Set(pool.map((r) => r.hookId))]

  const noRepeatCutoff = new Date(now.getTime() - rules.noRepeatWindowMinutes * 60 * 1000)
  const siblingCutoff = new Date(now.getTime() - rules.siblingSpacingMinutes * 60 * 1000)
  // Store-local "today" boundary for daily_cap (midnight in store TZ).
  const todayStart = storeLocalMidnight(now, timezone)

  const [recentSongPlays, recentHookPlays, todaySongPlays] = await Promise.all([
    applyNoRepeat
      ? prisma.playbackEvent.findMany({
          where: {
            storeId,
            songId: { in: songIds },
            eventType: 'song_start',
            occurredAt: { gte: noRepeatCutoff },
          },
          select: { songId: true, occurredAt: true },
        })
      : Promise.resolve([]),
    applySiblingSpacing
      ? prisma.playbackEvent.findMany({
          where: {
            storeId,
            hookId: { in: hookIds },
            eventType: 'song_start',
            occurredAt: { gte: siblingCutoff },
          },
          select: { hookId: true, occurredAt: true },
        })
      : Promise.resolve([]),
    applyDailyCap
      ? prisma.playbackEvent.findMany({
          where: {
            storeId,
            songId: { in: songIds },
            eventType: 'song_start',
            occurredAt: { gte: todayStart },
          },
          select: { songId: true },
        })
      : Promise.resolve([]),
  ])

  const noRepeatBlock = new Set(recentSongPlays.map((p) => p.songId!))
  const siblingBlock = new Set(recentHookPlays.map((p) => p.hookId!))
  const dailyCount = new Map<string, number>()
  for (const p of todaySongPlays) {
    if (!p.songId) continue
    dailyCount.set(p.songId, (dailyCount.get(p.songId) ?? 0) + 1)
  }

  return pool.filter((r) => {
    if (applyNoRepeat && noRepeatBlock.has(r.songId)) return false
    if (applySiblingSpacing && siblingBlock.has(r.hookId)) return false
    if (applyDailyCap && (dailyCount.get(r.songId) ?? 0) >= rules.dailyCap) return false
    return true
  })
}

function storeLocalMidnight(now: Date, timezone: string): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const dateStr = fmt.format(now) // YYYY-MM-DD in store-local
  // Build the start-of-day instant in that TZ. Iterate hour offsets to find the matching UTC instant.
  // Simpler approach: try midnight UTC for that local date and adjust by the offset between local and UTC.
  const candidate = new Date(`${dateStr}T00:00:00Z`)
  // Compute the offset between this candidate's local rendering and midnight; iterate once.
  const renderedMidnight = new Date(`${dateStr}T00:00:00Z`).toLocaleString('en-US', { timeZone: timezone, hour12: false })
  // Cheap fix: compute timezone offset by rendering "now" in tz vs UTC.
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
  const offsetMs = local.getTime() - now.getTime()
  return new Date(candidate.getTime() - offsetMs)
}

async function rankByLeastPlayed(storeId: string, pool: PoolRow[]): Promise<PoolRow[]> {
  if (pool.length === 0) return pool
  const songIds = [...new Set(pool.map((r) => r.songId))]
  const counts = await prisma.playbackEvent.groupBy({
    by: ['songId'],
    where: {
      storeId,
      songId: { in: songIds },
      eventType: 'song_start',
    },
    _count: { _all: true },
    _max: { occurredAt: true },
  })
  const stats = new Map(counts.map((c) => [c.songId!, { n: c._count._all, last: c._max.occurredAt?.getTime() ?? 0 }]))
  return [...pool].sort((a, b) => {
    const sa = stats.get(a.songId) ?? { n: 0, last: 0 }
    const sb = stats.get(b.songId) ?? { n: 0, last: 0 }
    if (sa.n !== sb.n) return sa.n - sb.n // least-played first
    return sa.last - sb.last // tiebreak: least-recently-played
  })
}

function dedupeBySong(pool: PoolRow[]): PoolRow[] {
  // The pool can have multiple LineageRows per song? It shouldn't (1:1 song->lineage), but defensively dedupe.
  const seen = new Set<string>()
  const out: PoolRow[] = []
  for (const r of pool) {
    if (seen.has(r.songId)) continue
    seen.add(r.songId)
    out.push(r)
  }
  return out
}

export async function nextQueue(storeId: string, now: Date = new Date()): Promise<HendrixResponse> {
  const decidedAt = now.toISOString()
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { icp: { select: { id: true } } },
  })
  if (!store) {
    return {
      storeId,
      decidedAt,
      activeOutcome: null,
      queue: [],
      fallbackTier: 'none',
      reason: 'no_pool',
    }
  }

  const resolved = await resolveActiveOutcome(storeId, now)
  if (!resolved) {
    return { storeId, decidedAt, activeOutcome: null, queue: [], fallbackTier: 'none', reason: 'no_pool' }
  }

  const rules = (await prisma.playbackRules.findFirst()) ?? {
    siblingSpacingMinutes: 240,
    noRepeatWindowMinutes: 45,
    dailyCap: 3,
  }

  if (!store.icp) {
    return { storeId, decidedAt, activeOutcome: serializeOutcome(resolved), queue: [], fallbackTier: 'none', reason: 'no_pool' }
  }
  const unfilteredPool = dedupeBySong(await fetchPool(store.icp.id, resolved.outcomeId))
  if (unfilteredPool.length === 0) {
    return {
      storeId,
      decidedAt,
      activeOutcome: serializeOutcome(resolved),
      queue: [],
      fallbackTier: 'none',
      reason: 'no_pool',
    }
  }

  // Tiered fallback: try strict → relax daily_cap → relax sibling_spacing → relax no_repeat_window.
  const tiers: { tier: FallbackTier; cap: boolean; sib: boolean; rep: boolean }[] = [
    { tier: 'none', cap: true, sib: true, rep: true },
    { tier: 'daily_cap', cap: false, sib: true, rep: true },
    { tier: 'sibling_spacing', cap: false, sib: false, rep: true },
    { tier: 'no_repeat_window', cap: false, sib: false, rep: false },
  ]

  for (const t of tiers) {
    const eligible = await applyFilters(storeId, unfilteredPool, t.cap, t.sib, t.rep, rules, now, store.timezone)
    if (eligible.length > 0) {
      const ranked = await rankByLeastPlayed(storeId, eligible)
      const queue = ranked.slice(0, 3).map((r) => ({
        songId: r.songId,
        audioUrl: r.r2Url,
        hookId: r.hookId,
        outcomeId: r.outcomeId,
      }))
      return {
        storeId,
        decidedAt,
        activeOutcome: serializeOutcome(resolved),
        queue,
        fallbackTier: t.tier,
        reason: null,
      }
    }
  }

  // Should be unreachable if unfilteredPool > 0, but fall through defensively.
  return {
    storeId,
    decidedAt,
    activeOutcome: serializeOutcome(resolved),
    queue: [],
    fallbackTier: 'no_repeat_window',
    reason: 'no_pool',
  }
}

function serializeOutcome(r: { outcomeId: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: Date }) {
  return { outcomeId: r.outcomeId, source: r.source, expiresAt: r.expiresAt?.toISOString() }
}
