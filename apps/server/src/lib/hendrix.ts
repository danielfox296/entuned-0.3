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
  icpId: string
  icpName: string | null
  title: string | null
  hookText: string | null
}

export interface HendrixResponse {
  storeId: string
  decidedAt: string
  activeOutcome: { outcomeId: string; title: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: string } | null
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
  icpId: string
}

async function fetchPool(icpId: string, outcomeId: string): Promise<PoolRow[]> {
  return prisma.lineageRow.findMany({
    where: { icpId, outcomeId, active: true },
    select: { id: true, songId: true, r2Url: true, hookId: true, outcomeId: true, icpId: true },
  })
}

async function fetchAllPool(icpIds: string[]): Promise<PoolRow[]> {
  if (icpIds.length === 0) return []
  return prisma.lineageRow.findMany({
    where: { icpId: { in: icpIds }, active: true },
    select: { id: true, songId: true, r2Url: true, hookId: true, outcomeId: true, icpId: true },
  })
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
  const dateStr = fmt.format(now)
  const candidate = new Date(`${dateStr}T00:00:00Z`)
  new Date(`${dateStr}T00:00:00Z`).toLocaleString('en-US', { timeZone: timezone, hour12: false })
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
  const offsetMs = local.getTime() - now.getTime()
  return new Date(candidate.getTime() - offsetMs)
}

async function rankByPlayCount(storeId: string, pool: PoolRow[]): Promise<PoolRow[]> {
  if (pool.length === 0) return pool
  const songIds = [...new Set(pool.map((r) => r.songId))]
  const counts = await prisma.playbackEvent.groupBy({
    by: ['songId'],
    where: { storeId, songId: { in: songIds }, eventType: 'song_start' },
    _count: { _all: true },
    _max: { occurredAt: true },
  })
  const stats = new Map(counts.map((c) => [c.songId!, { n: c._count._all, last: c._max.occurredAt?.getTime() ?? 0 }]))
  return [...pool].sort((a, b) => {
    const sa = stats.get(a.songId) ?? { n: 0, last: 0 }
    const sb = stats.get(b.songId) ?? { n: 0, last: 0 }
    if (sa.n !== sb.n) return sa.n - sb.n
    return sa.last - sb.last
  })
}

function dedupeBySong(pool: PoolRow[]): PoolRow[] {
  const seen = new Set<string>()
  const out: PoolRow[] = []
  for (const r of pool) {
    if (seen.has(r.songId)) continue
    seen.add(r.songId)
    out.push(r)
  }
  return out
}

// Keep only the best-ranked row per hook so siblings never appear in the
// same queue batch. applyFilters handles the inter-batch spacing (blocks
// hookIds played recently), but without this step two songs sharing a hook
// can both rank into the top-3 slice and play back-to-back on the client.
function dedupeByHook(pool: PoolRow[]): PoolRow[] {
  const seen = new Set<string>()
  const out: PoolRow[] = []
  for (const r of pool) {
    if (seen.has(r.hookId)) continue
    seen.add(r.hookId)
    out.push(r)
  }
  return out
}

type PlaybackRules = { siblingSpacingMinutes: number; noRepeatWindowMinutes: number; dailyCap: number }

async function hydrateQueue(top: PoolRow[]): Promise<QueueItem[]> {
  const lineageIds = top.map((r) => r.id)
  const hookIds = [...new Set(top.map((r) => r.hookId))]
  const icpIds = [...new Set(top.map((r) => r.icpId))]
  const [lineageMeta, hookMeta, icpMeta] = await Promise.all([
    prisma.lineageRow.findMany({
      where: { id: { in: lineageIds } },
      select: { id: true, songSeed: { select: { title: true } } },
    }),
    prisma.hook.findMany({ where: { id: { in: hookIds } }, select: { id: true, text: true } }),
    prisma.iCP.findMany({ where: { id: { in: icpIds } }, select: { id: true, name: true } }),
  ])
  const titleByLineage = new Map(lineageMeta.map((m) => [m.id, m.songSeed?.title ?? null]))
  const textByHook = new Map(hookMeta.map((h) => [h.id, h.text]))
  const nameByIcp = new Map(icpMeta.map((i) => [i.id, i.name]))
  return top.map((r) => ({
    songId: r.songId,
    audioUrl: r.r2Url,
    hookId: r.hookId,
    outcomeId: r.outcomeId,
    icpId: r.icpId,
    icpName: nameByIcp.get(r.icpId) ?? null,
    title: titleByLineage.get(r.id) ?? null,
    hookText: textByHook.get(r.hookId) ?? null,
  }))
}

async function buildQueueFromPool(
  storeId: string,
  unfilteredPool: PoolRow[],
  rules: PlaybackRules,
  timezone: string,
  now: Date,
): Promise<{ queue: QueueItem[]; fallbackTier: FallbackTier }> {
  if (unfilteredPool.length === 0) return { queue: [], fallbackTier: 'none' }

  const tiers: { tier: FallbackTier; cap: boolean; sib: boolean; rep: boolean }[] = [
    { tier: 'none', cap: true, sib: true, rep: true },
    { tier: 'daily_cap', cap: false, sib: true, rep: true },
    { tier: 'sibling_spacing', cap: false, sib: false, rep: true },
    { tier: 'no_repeat_window', cap: false, sib: false, rep: false },
  ]

  for (const t of tiers) {
    const eligible = await applyFilters(storeId, unfilteredPool, t.cap, t.sib, t.rep, rules, now, timezone)
    if (eligible.length > 0) {
      const ranked = await rankByPlayCount(storeId, eligible)
      const top = dedupeByHook(ranked).slice(0, 3)
      const queue = await hydrateQueue(top)
      return { queue, fallbackTier: t.tier }
    }
  }

  return { queue: [], fallbackTier: 'no_repeat_window' }
}

async function serializeOutcome(r: { outcomeId: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: Date }) {
  const o = await prisma.outcome.findUnique({ where: { id: r.outcomeId }, select: { title: true } })
  return { outcomeId: r.outcomeId, title: o?.title ?? r.outcomeId, source: r.source, expiresAt: r.expiresAt?.toISOString() }
}

export async function nextQueue(
  storeId: string,
  now: Date = new Date(),
  opts: { allOutcomes?: boolean } = {},
): Promise<HendrixResponse> {
  const decidedAt = now.toISOString()
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { icps: { select: { id: true } } },
  })
  if (!store) {
    return { storeId, decidedAt, activeOutcome: null, queue: [], fallbackTier: 'none', reason: 'no_pool' }
  }

  const rules = (await prisma.playbackRules.findFirst()) ?? {
    siblingSpacingMinutes: 240,
    noRepeatWindowMinutes: 45,
    dailyCap: 3,
  }

  if (store.icps.length === 0) {
    return { storeId, decidedAt, activeOutcome: null, queue: [], fallbackTier: 'none', reason: 'no_pool' }
  }

  const icpIds = store.icps.map((i) => i.id)

  // All-outcomes mode: pull from every outcome's pool without restricting to the active one.
  if (opts.allOutcomes) {
    const pool = dedupeBySong(await fetchAllPool(icpIds))
    const { queue, fallbackTier } = await buildQueueFromPool(storeId, pool, rules, store.timezone, now)
    return {
      storeId,
      decidedAt,
      activeOutcome: null,
      queue,
      fallbackTier,
      reason: queue.length === 0 ? 'no_pool' : null,
    }
  }

  const resolved = await resolveActiveOutcome(storeId, now)
  if (!resolved) {
    // No outcome configured (no selection, schedule, or default) — fall back to all-outcomes pool
    // so the player always plays something when songs exist.
    const pool = dedupeBySong(await fetchAllPool(icpIds))
    const { queue, fallbackTier } = await buildQueueFromPool(storeId, pool, rules, store.timezone, now)
    return {
      storeId,
      decidedAt,
      activeOutcome: null,
      queue,
      fallbackTier,
      reason: queue.length === 0 ? 'no_pool' : null,
    }
  }

  const poolsByIcp = await Promise.all(store.icps.map((icp) => fetchPool(icp.id, resolved.outcomeId)))
  const unfilteredPool = dedupeBySong(poolsByIcp.flat())
  if (unfilteredPool.length === 0) {
    // Resolved outcome exists but has no songs — fall back to all-outcomes pool
    // so the player always has something to play when songs exist under any outcome.
    const pool = dedupeBySong(await fetchAllPool(icpIds))
    const { queue, fallbackTier } = await buildQueueFromPool(storeId, pool, rules, store.timezone, now)
    return {
      storeId,
      decidedAt,
      activeOutcome: await serializeOutcome(resolved),
      queue,
      fallbackTier,
      reason: queue.length === 0 ? 'no_pool' : null,
    }
  }

  const { queue, fallbackTier } = await buildQueueFromPool(storeId, unfilteredPool, rules, store.timezone, now)
  return {
    storeId,
    decidedAt,
    activeOutcome: await serializeOutcome(resolved),
    queue,
    fallbackTier,
    reason: queue.length === 0 ? 'no_pool' : null,
  }
}
