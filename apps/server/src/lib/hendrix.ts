// Card 18 Hendrix — playback routing.
// Resolves outcome, builds eligible pool, applies rotation rules, falls back to
// "least-played / least-recent" panic mode only when every song is filtered out.

import { prisma } from '../db.js'
import { resolveActiveOutcome } from './outcomeSchedule.js'
import { effectiveTier, type StoreTierFields } from './tier.js'
import { FREE_TIER_AD_STORE_ID } from './freeTier.js'

// `normal`: ≥1 song passed sibling-spacing + no-repeat filters.
// `panic`:  pool exists but every song was filtered out — pick the least-played /
//           least-recently-played row(s) instead of returning an empty queue.
//           dedupeBySibling still runs in panic, so two siblings never ride
//           together inside a single 3-song batch.
export type FallbackTier = 'normal' | 'panic'
export type EmptyReason = 'no_pool' | null

export interface QueueItem {
  type?: 'song' | 'ad'
  songId: string
  audioUrl: string
  // hookId / icpId are nullable: rows from the general pool (free-tier
  // Stores with no ICPs) have neither. icpName/hookText follow.
  hookId: string | null
  // songSeedId is the cross-take generation identifier — two cuts of the
  // same Suno generation share it even when hookId is null (free tier).
  // Surfaced on the wire so the player can do sibling-aware queue merging.
  songSeedId: string | null
  outcomeId: string
  icpId: string | null
  icpName: string | null
  title: string | null
  hookText: string | null
  // Present when type === 'ad'
  assetId?: string
  campaignId?: string
}

export interface HendrixResponse {
  storeId: string
  decidedAt: string
  activeOutcome: { outcomeId: string; title: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: string } | null
  queue: QueueItem[]
  fallbackTier: FallbackTier
  reason: EmptyReason
  // Per-store opt-in for mic-based room-loudness sampling on the player.
  // Server-level kill switch (ROOM_LOUDNESS_SAMPLING_KILL=true) forces false.
  roomLoudnessSamplingEnabled: boolean
}

function roomLoudnessFlag(storeFlag: boolean): boolean {
  if (process.env.ROOM_LOUDNESS_SAMPLING_KILL === 'true') return false
  return storeFlag
}

interface PoolRow {
  id: string
  songId: string
  r2Url: string
  hookId: string | null
  songSeedId: string | null
  outcomeId: string
  icpId: string | null
}

// Sibling key: two LineageRows are siblings if they share a hook (paid pool,
// hookId set) or a SongSeed (Suno returns 2 versions per prompt — both rows
// share songSeedId, e.g., the two cuts of "Let the quiet do the work" on the
// free pool). Falls back to songId so unrelated rows never collide.
function siblingKey(r: { hookId: string | null; songSeedId: string | null; songId: string }): string {
  return r.hookId ?? r.songSeedId ?? r.songId
}

// Per-store song suppression (StoreRetiredSong). Free-tier stores share one
// ICP, so global LineageRow.active=false is too blunt — operators retire songs
// for one location via Flagged Review, which writes here.
async function fetchRetiredSongIds(storeId: string): Promise<string[]> {
  const rows = await prisma.storeRetiredSong.findMany({
    where: { storeId },
    select: { songId: true },
  })
  return rows.map((r) => r.songId)
}

async function fetchPool(icpId: string, outcomeId: string, retiredSongIds: string[]): Promise<PoolRow[]> {
  return prisma.lineageRow.findMany({
    where: {
      icpId,
      outcomeId,
      active: true,
      ...(retiredSongIds.length > 0 ? { songId: { notIn: retiredSongIds } } : {}),
    },
    select: { id: true, songId: true, r2Url: true, hookId: true, songSeedId: true, outcomeId: true, icpId: true },
  })
}

async function fetchAllPool(icpIds: string[], retiredSongIds: string[]): Promise<PoolRow[]> {
  if (icpIds.length === 0) return []
  return prisma.lineageRow.findMany({
    where: {
      icpId: { in: icpIds },
      active: true,
      ...(retiredSongIds.length > 0 ? { songId: { notIn: retiredSongIds } } : {}),
    },
    select: { id: true, songId: true, r2Url: true, hookId: true, songSeedId: true, outcomeId: true, icpId: true },
  })
}

async function applyFilters(
  storeId: string,
  pool: PoolRow[],
  rules: { siblingSpacingMinutes: number; noRepeatWindowMinutes: number },
  now: Date,
): Promise<PoolRow[]> {
  if (pool.length === 0) return pool

  const songIds = [...new Set(pool.map((r) => r.songId))]
  // hookId can be null for general-pool rows; filter before sending to Prisma.
  const hookIds = [...new Set(pool.map((r) => r.hookId).filter((h): h is string => h !== null))]
  // SongSeed-based sibling spacing covers free-tier rows (null hookId) and
  // any other case where two cuts of the same Suno generation share a seed.
  const seedIds = [...new Set(pool.map((r) => r.songSeedId).filter((s): s is string => s !== null))]

  const noRepeatCutoff = new Date(now.getTime() - rules.noRepeatWindowMinutes * 60 * 1000)
  const siblingCutoff = new Date(now.getTime() - rules.siblingSpacingMinutes * 60 * 1000)

  const [recentSongPlays, recentHookPlays, recentSeedSongPlays] = await Promise.all([
    prisma.playbackEvent.findMany({
      where: {
        storeId,
        songId: { in: songIds },
        eventType: 'song_start',
        occurredAt: { gte: noRepeatCutoff },
      },
      select: { songId: true, occurredAt: true },
    }),
    hookIds.length > 0
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
    // PlaybackEvent has no songSeedId column — resolve recent plays' seeds
    // by joining through LineageRow on the songId.
    seedIds.length > 0
      ? prisma.lineageRow.findMany({
          where: {
            songSeedId: { in: seedIds },
            song: {
              playbackEvents: {
                some: {
                  storeId,
                  eventType: 'song_start',
                  occurredAt: { gte: siblingCutoff },
                },
              },
            },
          },
          select: { songSeedId: true },
        })
      : Promise.resolve([]),
  ])

  const noRepeatBlock = new Set(recentSongPlays.map((p) => p.songId!))
  const siblingHookBlock = new Set(recentHookPlays.map((p) => p.hookId!))
  const siblingSeedBlock = new Set(recentSeedSongPlays.map((r) => r.songSeedId!).filter(Boolean))

  return pool.filter((r) => {
    if (noRepeatBlock.has(r.songId)) return false
    if (r.hookId && siblingHookBlock.has(r.hookId)) return false
    if (r.songSeedId && siblingSeedBlock.has(r.songSeedId)) return false
    return true
  })
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

// Keep only the best-ranked row per sibling group so siblings never appear
// in the same queue batch. applyFilters handles inter-batch spacing; without
// this step two cuts sharing a hook (paid pool) or a SongSeed (free pool —
// Suno returns 2 versions per generation, e.g., the two takes of "Let the
// quiet do the work") can both rank into the top-3 slice and play back-to-back.
function dedupeBySibling(pool: PoolRow[]): PoolRow[] {
  const seen = new Set<string>()
  const out: PoolRow[] = []
  for (const r of pool) {
    const key = siblingKey(r)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

// All-outcomes mode: interleave outcomes round-robin so a single 3-song batch
// surfaces multiple modes. Without this, ranking by global play count lets one
// outcome's least-played songs dominate the top slice and the player feels
// "stuck" on one mode. Outcome rotation order is shuffled per call so
// consecutive batches don't always lead with the same outcome.
function interleaveByOutcome(ranked: PoolRow[]): PoolRow[] {
  if (ranked.length === 0) return ranked
  const groups = new Map<string, PoolRow[]>()
  for (const r of ranked) {
    const g = groups.get(r.outcomeId)
    if (g) g.push(r)
    else groups.set(r.outcomeId, [r])
  }
  const order = [...groups.keys()]
  // Fisher-Yates shuffle for randomized starting outcome each call.
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const out: PoolRow[] = []
  let added = true
  while (added) {
    added = false
    for (const outcomeId of order) {
      const g = groups.get(outcomeId)!
      const next = g.shift()
      if (next) {
        out.push(next)
        added = true
      }
    }
  }
  return out
}

type PlaybackRules = { siblingSpacingMinutes: number; noRepeatWindowMinutes: number }

async function hydrateQueue(top: PoolRow[]): Promise<QueueItem[]> {
  const lineageIds = top.map((r) => r.id)
  // Filter nulls before sending to Prisma — general-pool rows have null hook/icp.
  const hookIds = [...new Set(top.map((r) => r.hookId).filter((h): h is string => h !== null))]
  const icpIds  = [...new Set(top.map((r) => r.icpId).filter((i): i is string => i !== null))]
  const [lineageMeta, hookMeta, icpMeta] = await Promise.all([
    prisma.lineageRow.findMany({
      where: { id: { in: lineageIds } },
      select: { id: true, songSeed: { select: { title: true } } },
    }),
    hookIds.length === 0
      ? Promise.resolve([] as { id: string; text: string }[])
      : prisma.hook.findMany({ where: { id: { in: hookIds } }, select: { id: true, text: true } }),
    icpIds.length === 0
      ? Promise.resolve([] as { id: string; name: string }[])
      : prisma.iCP.findMany({ where: { id: { in: icpIds } }, select: { id: true, name: true } }),
  ])
  const titleByLineage = new Map(lineageMeta.map((m) => [m.id, m.songSeed?.title ?? null]))
  const textByHook = new Map(hookMeta.map((h) => [h.id, h.text]))
  const nameByIcp = new Map(icpMeta.map((i) => [i.id, i.name]))
  return top.map((r) => ({
    songId: r.songId,
    audioUrl: r.r2Url,
    hookId: r.hookId,
    songSeedId: r.songSeedId,
    outcomeId: r.outcomeId,
    icpId: r.icpId,
    icpName: r.icpId ? (nameByIcp.get(r.icpId) ?? null) : null,
    title: titleByLineage.get(r.id) ?? null,
    hookText: r.hookId ? (textByHook.get(r.hookId) ?? null) : null,
  }))
}

async function buildQueueFromPool(
  storeId: string,
  unfilteredPool: PoolRow[],
  rules: PlaybackRules,
  now: Date,
  opts: { interleaveOutcomes?: boolean } = {},
): Promise<{ queue: QueueItem[]; fallbackTier: FallbackTier }> {
  if (unfilteredPool.length === 0) return { queue: [], fallbackTier: 'normal' }

  const eligible = await applyFilters(storeId, unfilteredPool, rules, now)

  // Normal path: ≥1 song survived sibling-spacing + no-repeat. Rank, dedupe
  // siblings within the batch, take top 3.
  if (eligible.length > 0) {
    const ranked = await rankByPlayCount(storeId, eligible)
    const rotated = opts.interleaveOutcomes ? interleaveByOutcome(ranked) : ranked
    const top = dedupeBySibling(rotated).slice(0, 3)
    const queue = await hydrateQueue(top)
    return { queue, fallbackTier: 'normal' }
  }

  // Panic: every song was filtered out. Pick from the full pool ranked by
  // least-played / least-recently-played so we never return an empty queue
  // when songs exist. dedupeBySibling still runs so twins don't ride together.
  const ranked = await rankByPlayCount(storeId, unfilteredPool)
  const rotated = opts.interleaveOutcomes ? interleaveByOutcome(ranked) : ranked
  const top = dedupeBySibling(rotated).slice(0, 3)
  const queue = await hydrateQueue(top)
  return { queue, fallbackTier: 'panic' }
}

async function injectAdIfDue(
  store: { id: string } & StoreTierFields,
  queue: QueueItem[],
  now: Date,
): Promise<QueueItem[]> {
  if (queue.length === 0) return queue

  // Tier routing: free-tier stores play Entuned house ads (campaigns attached
  // to the sentinel FREE_TIER_AD_STORE_ID). Paid stores play their own
  // campaigns. See schema/22-campaigns.md "Tier routing".
  const adSourceStoreId =
    effectiveTier(store, now) === 'free' ? FREE_TIER_AD_STORE_ID : store.id

  const campaigns = await prisma.campaign.findMany({
    where: { storeId: adSourceStoreId, startsAt: { lte: now }, endsAt: { gte: now } },
    include: { adAssets: { orderBy: { position: 'asc' } }, assetState: true },
    orderBy: { startsAt: 'asc' },
  })
  const campaign = campaigns.find((c) => c.adAssets.length > 0)
  if (!campaign) return queue

  // Cadence stays per-calling-store: each free user gets independent
  // "songs since last ad" counters even when sharing a house campaign.
  // Upsert bootstraps the row the first time a campaign becomes active for
  // this store. Without this, song_complete updateMany events are no-ops
  // (row doesn't exist) so the counter never advances and ads never fire.
  const playState = await prisma.campaignPlayState.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, songsPlayedSinceAd: 0 },
    update: {},
  })
  const songsPlayed = playState.songsPlayedSinceAd

  if (songsPlayed < campaign.songsPerAd) {
    // Not yet due — but truncate the batch so the player refetches as soon as the
    // counter is due rather than playing through a large pre-filled batch.
    // e.g. songsPerAd=3, songsPlayed=1 → return at most 2 songs this fetch.
    const remaining = campaign.songsPerAd - songsPlayed
    return queue.slice(0, remaining)
  }

  const nextIdx = (campaign.assetState?.nextAssetIndex ?? 0) % campaign.adAssets.length
  const asset = campaign.adAssets[nextIdx]
  if (!asset) return queue

  const adItem: QueueItem = {
    type: 'ad',
    songId: asset.id,
    audioUrl: asset.r2Url,
    hookId: null,
    songSeedId: null,
    outcomeId: '',
    icpId: null,
    icpName: null,
    title: asset.label ?? null,
    hookText: null,
    assetId: asset.id,
    campaignId: campaign.id,
  }
  return [adItem, ...queue]
}

async function serializeOutcome(r: { outcomeId: string; source: 'selection' | 'schedule' | 'default'; expiresAt?: Date }) {
  const o = await prisma.outcome.findUnique({ where: { id: r.outcomeId }, select: { title: true, displayTitle: true } })
  return { outcomeId: r.outcomeId, title: o?.displayTitle ?? o?.title ?? r.outcomeId, source: r.source, expiresAt: r.expiresAt?.toISOString() }
}

export async function nextQueue(
  storeId: string,
  now: Date = new Date(),
  opts: { allOutcomes?: boolean } = {},
): Promise<HendrixResponse> {
  const decidedAt = now.toISOString()
  const store = await prisma.store.findUnique({ where: { id: storeId } })
  if (!store) {
    return { storeId, decidedAt, activeOutcome: null, queue: [], fallbackTier: 'normal', reason: 'no_pool', roomLoudnessSamplingEnabled: false }
  }

  const roomLoudness = roomLoudnessFlag(store.roomLoudnessSamplingEnabled)

  const rules = (await prisma.playbackRules.findFirst()) ?? {
    siblingSpacingMinutes: 240,
    noRepeatWindowMinutes: 45,
  }

  // Resolve the Store's active ICP set via the StoreICP join (Free Tier ICP
  // for free Stores; per-store ICPs for paid). Stores always have ≥1 ICP
  // since signup links to Free Tier ICP — the old "no ICPs" branch is gone.
  const icps = await prisma.iCP.findMany({
    where: { storeLinks: { some: { storeId } }, archivedAt: null },
    select: { id: true },
  })
  const icpIds = icps.map((i) => i.id)
  const retiredSongIds = await fetchRetiredSongIds(storeId)

  // All-outcomes mode: pull from every outcome's pool without restricting to the active one.
  if (opts.allOutcomes) {
    const pool = dedupeBySong(await fetchAllPool(icpIds, retiredSongIds))
    const { queue, fallbackTier } = await buildQueueFromPool(storeId, pool, rules, now, { interleaveOutcomes: true })
    return {
      storeId,
      decidedAt,
      activeOutcome: null,
      queue: await injectAdIfDue(store, queue, now),
      fallbackTier,
      reason: queue.length === 0 ? 'no_pool' : null,
      roomLoudnessSamplingEnabled: roomLoudness,
    }
  }

  const resolved = await resolveActiveOutcome(storeId, now)
  if (!resolved) {
    // No outcome configured (no selection, schedule, or default) — fall back to all-outcomes pool
    // so the player always plays something when songs exist.
    const pool = dedupeBySong(await fetchAllPool(icpIds, retiredSongIds))
    const { queue, fallbackTier } = await buildQueueFromPool(storeId, pool, rules, now, { interleaveOutcomes: true })
    return {
      storeId,
      decidedAt,
      activeOutcome: null,
      queue: await injectAdIfDue(store, queue, now),
      fallbackTier,
      reason: queue.length === 0 ? 'no_pool' : null,
      roomLoudnessSamplingEnabled: roomLoudness,
    }
  }

  const poolsByIcp = await Promise.all(icpIds.map((id) => fetchPool(id, resolved.outcomeId, retiredSongIds)))
  const unfilteredPool = dedupeBySong(poolsByIcp.flat())
  if (unfilteredPool.length === 0) {
    // Resolved outcome exists but has no songs — fall back to all-outcomes pool
    // so the player always has something to play when songs exist under any outcome.
    const pool = dedupeBySong(await fetchAllPool(icpIds, retiredSongIds))
    const { queue, fallbackTier } = await buildQueueFromPool(storeId, pool, rules, now, { interleaveOutcomes: true })
    return {
      storeId,
      decidedAt,
      activeOutcome: await serializeOutcome(resolved),
      queue: await injectAdIfDue(store, queue, now),
      fallbackTier,
      reason: queue.length === 0 ? 'no_pool' : null,
      roomLoudnessSamplingEnabled: roomLoudness,
    }
  }

  const { queue, fallbackTier } = await buildQueueFromPool(storeId, unfilteredPool, rules, now)
  return {
    storeId,
    decidedAt,
    activeOutcome: await serializeOutcome(resolved),
    queue: await injectAdIfDue(store, queue, now),
    fallbackTier,
    reason: queue.length === 0 ? 'no_pool' : null,
    roomLoudnessSamplingEnabled: roomLoudness,
  }
}
