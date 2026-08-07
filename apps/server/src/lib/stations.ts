// Card 23 Stations — the free tier's music choice.
//
// A Station is a named shared song pool. It owns exactly one ICP under the
// Free Tier Client, and its pool IS that ICP's LineageRow set. Every free
// Store that picks the Station reads the same rows.
//
// This is deliberately not a new pool mechanism. Hendrix already resolves a
// Store's candidate pool through StoreICP links, which is how one canonical
// Free Tier ICP already serves every free Store. A Station reuses that path
// exactly: Station -> ICP -> LineageRow. There is no LineageRow.stationId and
// no second pool query anywhere.
//
// Outcome scoping is orthogonal and stays on the FreeTierOutcome allowlist:
// the station narrows WHICH ICP's rows, the allowlist narrows WHICH outcome's
// rows. Both filters compose on the same candidate set in lib/hendrix.ts.
//
// SSOT: ../../../../entune v0.3/schema/23-stations.md

import { prisma } from '../db.js'
import { AppError } from './http-errors.js'

// The six launch stations, mirroring migration 20260806120000_add_stations.
// Ids are fixed sentinels in the same space as FREE_TIER_ICP_ID so code can
// reference a station without a lookup. Display copy is NOT authoritative here
// — operators edit the DB rows; this is the seed record and a test fixture.
export const LAUNCH_STATIONS = [
  { stationKey: 'solo-piano',                id: '00000000-0000-0000-0000-000000000201', icpId: '00000000-0000-0000-0000-000000000101', sortOrder: 1 },
  { stationKey: 'lofi-beats',                id: '00000000-0000-0000-0000-000000000202', icpId: '00000000-0000-0000-0000-000000000102', sortOrder: 2 },
  { stationKey: 'classic-soul-instrumental', id: '00000000-0000-0000-0000-000000000203', icpId: '00000000-0000-0000-0000-000000000103', sortOrder: 3 },
  { stationKey: 'bossa-nova',                id: '00000000-0000-0000-0000-000000000204', icpId: '00000000-0000-0000-0000-000000000104', sortOrder: 4 },
  { stationKey: 'western-instrumental',      id: '00000000-0000-0000-0000-000000000205', icpId: '00000000-0000-0000-0000-000000000105', sortOrder: 5 },
  { stationKey: 'jazz-trio',                 id: '00000000-0000-0000-0000-000000000206', icpId: '00000000-0000-0000-0000-000000000106', sortOrder: 6 },
] as const

export interface StationSummary {
  id: string
  stationKey: string
  displayName: string
  subtitle: string | null
  sortOrder: number
}

/**
 * Active stations in picker order. Ties on sortOrder break on displayName so
 * the list is stable when an operator seeds several rows at the same order.
 */
export async function listActiveStations(): Promise<StationSummary[]> {
  return prisma.station.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    select: { id: true, stationKey: true, displayName: true, subtitle: true, sortOrder: true },
  })
}

/**
 * The station a brand-new free Store starts on: the first one in picker order.
 * Returns null when the catalogue is empty (fresh DB without the seed
 * migration) — callers leave Store.stationId blank and the Store falls back to
 * the canonical Free Tier ICP pool, exactly as it did before stations existed.
 */
export async function pickDefaultStationId(): Promise<string | null> {
  const row = await prisma.station.findFirst({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    select: { id: true },
  })
  return row?.id ?? null
}

/**
 * The ICP whose LineageRows are this Store's playback pool, or null to fall
 * back to the Store's full StoreICP set.
 *
 * Callers must have already established that the Store is *effectively* free
 * (lib/tier.ts effectiveTier) — stations are a free-tier concept and this
 * function does not re-check tier.
 *
 * Returns null in three cases:
 *   1. No station picked.
 *   2. The station was deactivated (operators pull a station from the
 *      catalogue; stores on it fall back rather than going silent).
 *   3. The station's pool has no active LineageRows yet.
 *
 * Case 3 is load-bearing at launch. Stations are assigned before their pools
 * are generated, and silence is a worse failure than an off-station song. It
 * is the same posture as Hendrix's existing `panic` fallback tier: never
 * return an empty queue when songs exist. It self-heals — the first LineageRow
 * on the station pool switches the store over with no operator action.
 */
export async function resolveStationPoolIcpId(store: { stationId: string | null }): Promise<string | null> {
  if (!store.stationId) return null

  const station = await prisma.station.findUnique({
    where: { id: store.stationId },
    select: { icpId: true, active: true },
  })
  if (!station || !station.active) return null

  const anyRow = await prisma.lineageRow.findFirst({
    where: { icpId: station.icpId, active: true },
    select: { id: true },
  })
  return anyRow ? station.icpId : null
}

// Average track length in the catalogue, in minutes. A measured property of
// the songs we generate, not a policy knob — the tunable knobs are the three
// PlaybackRules.stationNoRepeat* columns.
const AVG_TRACK_MINUTES = 3

export interface StationNoRepeatRules {
  stationNoRepeatCoverage: number
  stationNoRepeatMinMinutes: number
  stationNoRepeatMaxMinutes: number
}

/**
 * No-repeat window for a station-scoped request, derived from pool size.
 *
 *   window = clamp(poolSize * AVG_TRACK_MINUTES * coverage, min, max)
 *
 * The flat PlaybackRules.noRepeatWindowMinutes (45) was tuned for per-ICP paid
 * pools. A 100-track station pool played across a full store day (~240 plays at
 * ~3 min/track) cycles the pool ~2.4x, and 45 minutes only blocks ~15 tracks
 * back — the same track can return up to 16 times a day. Deriving the window
 * from pool size means a listener hears `coverage` of the station (60% by
 * default) before anything repeats, at any pool size.
 *
 * At the defaults: 100 tracks -> 180 min, 25 tracks -> 45 min (floor),
 * 267+ tracks -> 480 min (cap).
 *
 * Pools too small to fill the floor filter down to nothing and hit Hendrix's
 * existing `panic` tier, which ranks the full pool least-played-first. That is
 * the correct degradation, and `fallback_tier: 'panic'` on queue_refill
 * telemetry is the existing signal that a station's library is too small.
 */
export function stationNoRepeatWindowMinutes(poolSize: number, rules: StationNoRepeatRules): number {
  const min = Math.max(0, rules.stationNoRepeatMinMinutes)
  const max = Math.max(min, rules.stationNoRepeatMaxMinutes)
  const derived = Math.round(poolSize * AVG_TRACK_MINUTES * rules.stationNoRepeatCoverage)
  return Math.min(max, Math.max(min, derived))
}

export interface SetStationResult {
  station: { id: string; stationKey: string; displayName: string; subtitle: string | null }
  previousStationId: string | null
  changed: boolean
}

/**
 * Point a Store at a Station. The only writer of Store.stationId.
 *
 * Does three things atomically:
 *   1. Sets Store.stationId.
 *   2. Syncs StoreICP — links the new station's ICP, unlinks the previous
 *      station's. The canonical Free Tier ICP link is left alone; it is the
 *      fallback pool. This keeps StoreICP the honest answer to "which pools
 *      does this Store read", which is what Dash panels and the generation
 *      pipeline query.
 *   3. Writes the telemetry row — `station_selected` on first assignment,
 *      `station_switched` on any subsequent change. Server-side because the
 *      server is what changed the state; the client is never trusted to report
 *      a transition it didn't make.
 *
 * Re-selecting the current station is a no-op: no writes, no telemetry,
 * `changed: false`. Without that guard a double-tap in the picker would log a
 * switch from a station to itself.
 */
export async function setStoreStation(
  storeId: string,
  stationId: string,
  now: Date = new Date(),
): Promise<SetStationResult> {
  const [store, station] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { id: true, stationId: true } }),
    prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, stationKey: true, displayName: true, subtitle: true, icpId: true, active: true },
    }),
  ])
  if (!store) throw new AppError(404, 'store_not_found')
  if (!station) throw new AppError(404, 'station_not_found')
  // Inactive stations are off the catalogue. Stores already on one keep
  // playing it (see resolveStationPoolIcpId), but nobody new can move onto it.
  if (!station.active) throw new AppError(409, 'station_inactive')

  const summary = {
    id: station.id,
    stationKey: station.stationKey,
    displayName: station.displayName,
    subtitle: station.subtitle,
  }
  const previousStationId = store.stationId
  if (previousStationId === station.id) {
    return { station: summary, previousStationId, changed: false }
  }

  const previous = previousStationId
    ? await prisma.station.findUnique({
        where: { id: previousStationId },
        select: { stationKey: true, icpId: true },
      })
    : null

  await prisma.$transaction(async (tx) => {
    await tx.store.update({ where: { id: store.id }, data: { stationId: station.id } })

    // Drop the outgoing station's pool link. deleteMany (not delete) so a
    // missing link — a store whose station was set before this sync existed —
    // is a no-op rather than a throw.
    if (previous) {
      await tx.storeICP.deleteMany({ where: { storeId: store.id, icpId: previous.icpId } })
    }
    // createMany + skipDuplicates: the link may already exist if an operator
    // attached the station's ICP by hand.
    await tx.storeICP.createMany({
      data: [{ storeId: store.id, icpId: station.icpId }],
      skipDuplicates: true,
    })

    await tx.playbackEvent.create({
      data: {
        eventType: previousStationId ? 'station_switched' : 'station_selected',
        storeId: store.id,
        occurredAt: now,
        extra: {
          station_id: station.id,
          station_key: station.stationKey,
          ...(previousStationId
            ? {
                previous_station_id: previousStationId,
                previous_station_key: previous?.stationKey ?? null,
              }
            : {}),
        },
      },
    })
  })

  return { station: summary, previousStationId, changed: true }
}
