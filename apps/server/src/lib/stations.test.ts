// Unit tests for lib/stations.ts — Card 23 Stations.
//
// Covered exports: listActiveStations, pickDefaultStationId,
// resolveStationPoolIcpId, stationNoRepeatWindowMinutes, setStoreStation,
// LAUNCH_STATIONS.
//
// Mocking strategy:
//   - Prisma is fully mocked (vi.mock('../db.js')). $transaction is mocked to
//     invoke its callback with a `tx` object exposing the same mock handles, so
//     assertions on transactional writes work without a DB.
//   - vi.resetAllMocks() in beforeEach (several tests stub one-off
//     implementations on shared mocks; clearAllMocks would leak).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const station = { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() }
  const lineageRow = { findFirst: vi.fn() }
  const store = { findUnique: vi.fn(), update: vi.fn() }
  const storeICP = { deleteMany: vi.fn(), createMany: vi.fn() }
  const playbackEvent = { create: vi.fn() }
  return {
    prisma: {
      station,
      lineageRow,
      store,
      storeICP,
      playbackEvent,
      // Hand the callback the same handles so tx.* writes land on the mocks
      // the tests assert against.
      $transaction: vi.fn(async (fn: any) => fn({ store, storeICP, playbackEvent })),
    },
  }
})

import {
  LAUNCH_STATIONS,
  listActiveStations,
  pickDefaultStationId,
  resolveStationPoolIcpId,
  stationNoRepeatWindowMinutes,
  setStoreStation,
} from './stations.js'
import { AppError } from './http-errors.js'
import { prisma } from '../db.js'

const stationFindMany = prisma.station.findMany as unknown as ReturnType<typeof vi.fn>
const stationFindFirst = prisma.station.findFirst as unknown as ReturnType<typeof vi.fn>
const stationFindUnique = prisma.station.findUnique as unknown as ReturnType<typeof vi.fn>
const lineageFindFirst = prisma.lineageRow.findFirst as unknown as ReturnType<typeof vi.fn>
const storeFindUnique = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>
const storeUpdate = prisma.store.update as unknown as ReturnType<typeof vi.fn>
const storeIcpDeleteMany = prisma.storeICP.deleteMany as unknown as ReturnType<typeof vi.fn>
const storeIcpCreateMany = prisma.storeICP.createMany as unknown as ReturnType<typeof vi.fn>
const eventCreate = prisma.playbackEvent.create as unknown as ReturnType<typeof vi.fn>
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>

const SOLO_PIANO = LAUNCH_STATIONS[0]
const LOFI = LAUNCH_STATIONS[1]

function stationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOLO_PIANO.id,
    stationKey: SOLO_PIANO.stationKey,
    displayName: 'Solo Piano',
    subtitle: 'Unhurried keys, nothing in the way',
    icpId: SOLO_PIANO.icpId,
    active: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  // Re-install the $transaction passthrough — resetAllMocks strips it.
  transaction.mockImplementation(async (fn: any) =>
    fn({ store: prisma.store, storeICP: prisma.storeICP, playbackEvent: prisma.playbackEvent }),
  )
})

// =========================================================================
// LAUNCH_STATIONS — the seed record
// =========================================================================

describe('LAUNCH_STATIONS', () => {
  it('lists the six launch stations in picker order', () => {
    expect(LAUNCH_STATIONS.map((s) => s.stationKey)).toEqual([
      'solo-piano',
      'lofi-beats',
      'classic-soul-instrumental',
      'bossa-nova',
      'western-instrumental',
      'jazz-trio',
    ])
    expect(LAUNCH_STATIONS.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('gives every station a distinct id and a distinct ICP', () => {
    // The 1:1 with ICP is load-bearing: two stations sharing a pool would make
    // "switching" a silent no-op. The DB enforces it with a unique index; this
    // catches a bad seed constant before it ever reaches a migration.
    expect(new Set(LAUNCH_STATIONS.map((s) => s.id)).size).toBe(6)
    expect(new Set(LAUNCH_STATIONS.map((s) => s.icpId)).size).toBe(6)
  })
})

// =========================================================================
// listActiveStations / pickDefaultStationId
// =========================================================================

describe('listActiveStations', () => {
  it('returns active stations ordered by sortOrder then displayName', async () => {
    stationFindMany.mockResolvedValue([{ id: SOLO_PIANO.id }])
    await listActiveStations()
    expect(stationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
    )
  })

  it('does not leak genreSteering into the picker payload', async () => {
    // genreSteering is a generation-side prompt surface, not customer copy.
    stationFindMany.mockResolvedValue([])
    await listActiveStations()
    const select = stationFindMany.mock.calls[0][0].select
    expect(select.genreSteering).toBeUndefined()
    expect(select.displayName).toBe(true)
  })
})

describe('pickDefaultStationId', () => {
  it('returns the first active station in picker order', async () => {
    stationFindFirst.mockResolvedValue({ id: SOLO_PIANO.id })
    expect(await pickDefaultStationId()).toBe(SOLO_PIANO.id)
    expect(stationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
      }),
    )
  })

  it('returns null when the catalogue is empty', async () => {
    // Fresh DB without the seed migration — the Store keeps stationId NULL and
    // falls back to the canonical Free Tier ICP pool.
    stationFindFirst.mockResolvedValue(null)
    expect(await pickDefaultStationId()).toBeNull()
  })
})

// =========================================================================
// resolveStationPoolIcpId
// =========================================================================

describe('resolveStationPoolIcpId', () => {
  it('returns the station ICP when the station is active and its pool has songs', async () => {
    stationFindUnique.mockResolvedValue({ icpId: SOLO_PIANO.icpId, active: true })
    lineageFindFirst.mockResolvedValue({ id: 'lr-1' })
    expect(await resolveStationPoolIcpId({ stationId: SOLO_PIANO.id })).toBe(SOLO_PIANO.icpId)
  })

  it('returns null when no station is picked, without querying', async () => {
    expect(await resolveStationPoolIcpId({ stationId: null })).toBeNull()
    expect(stationFindUnique).not.toHaveBeenCalled()
    expect(lineageFindFirst).not.toHaveBeenCalled()
  })

  it('returns null when the station row is gone', async () => {
    stationFindUnique.mockResolvedValue(null)
    expect(await resolveStationPoolIcpId({ stationId: 'deleted' })).toBeNull()
    expect(lineageFindFirst).not.toHaveBeenCalled()
  })

  it('falls back when the station was deactivated', async () => {
    // Operators pull a station from the catalogue; stores sitting on it fall
    // back to their full StoreICP set rather than going silent.
    stationFindUnique.mockResolvedValue({ icpId: SOLO_PIANO.icpId, active: false })
    expect(await resolveStationPoolIcpId({ stationId: SOLO_PIANO.id })).toBeNull()
    expect(lineageFindFirst).not.toHaveBeenCalled()
  })

  it('falls back when the station pool has no active songs', async () => {
    // Launch case: station assigned before its pool is generated. Silence is a
    // worse failure than an off-station song.
    stationFindUnique.mockResolvedValue({ icpId: SOLO_PIANO.icpId, active: true })
    lineageFindFirst.mockResolvedValue(null)
    expect(await resolveStationPoolIcpId({ stationId: SOLO_PIANO.id })).toBeNull()
    expect(lineageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { icpId: SOLO_PIANO.icpId, active: true } }),
    )
  })
})

// =========================================================================
// stationNoRepeatWindowMinutes
// =========================================================================

describe('stationNoRepeatWindowMinutes', () => {
  const rules = {
    stationNoRepeatCoverage: 0.6,
    stationNoRepeatMinMinutes: 45,
    stationNoRepeatMaxMinutes: 480,
  }

  it('derives 3 hours from a 100-track pool at the defaults', () => {
    // 100 tracks * 3 min * 0.6 = 180. The launch-scale case from the spec.
    expect(stationNoRepeatWindowMinutes(100, rules)).toBe(180)
  })

  it('clamps small pools up to the floor', () => {
    // 25 * 3 * 0.6 = 45 exactly; anything smaller must not fall below it.
    expect(stationNoRepeatWindowMinutes(25, rules)).toBe(45)
    expect(stationNoRepeatWindowMinutes(5, rules)).toBe(45)
    expect(stationNoRepeatWindowMinutes(0, rules)).toBe(45)
  })

  it('clamps large pools down to the ceiling', () => {
    // 267 * 3 * 0.6 = 480.6 -> rounds to 481, clamped to 480.
    expect(stationNoRepeatWindowMinutes(267, rules)).toBe(480)
    expect(stationNoRepeatWindowMinutes(5000, rules)).toBe(480)
  })

  it('grows monotonically with pool size between the clamps', () => {
    const w50 = stationNoRepeatWindowMinutes(50, rules)
    const w100 = stationNoRepeatWindowMinutes(100, rules)
    const w200 = stationNoRepeatWindowMinutes(200, rules)
    expect(w50).toBeLessThan(w100)
    expect(w100).toBeLessThan(w200)
  })

  it('honors an operator-tuned coverage', () => {
    expect(stationNoRepeatWindowMinutes(100, { ...rules, stationNoRepeatCoverage: 1 })).toBe(300)
    expect(stationNoRepeatWindowMinutes(100, { ...rules, stationNoRepeatCoverage: 0.2 })).toBe(60)
  })

  it('never returns below the floor when max is misconfigured under min', () => {
    // Guards an operator typo (max < min) from producing a window shorter than
    // the floor, which would silently loosen rotation instead of tightening it.
    const bad = { ...rules, stationNoRepeatMinMinutes: 120, stationNoRepeatMaxMinutes: 30 }
    expect(stationNoRepeatWindowMinutes(1000, bad)).toBe(120)
    expect(stationNoRepeatWindowMinutes(1, bad)).toBe(120)
  })
})

// =========================================================================
// setStoreStation
// =========================================================================

describe('setStoreStation', () => {
  it('sets the station, links the pool, and logs station_selected on first pick', async () => {
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: null })
    stationFindUnique.mockResolvedValue(stationRow())

    const now = new Date('2026-08-06T12:00:00.000Z')
    const res = await setStoreStation('store-1', SOLO_PIANO.id, now)

    expect(res.changed).toBe(true)
    expect(res.previousStationId).toBeNull()
    expect(res.station.stationKey).toBe('solo-piano')

    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { stationId: SOLO_PIANO.id },
    })
    expect(storeIcpCreateMany).toHaveBeenCalledWith({
      data: [{ storeId: 'store-1', icpId: SOLO_PIANO.icpId }],
      skipDuplicates: true,
    })
    // No previous station -> nothing to unlink.
    expect(storeIcpDeleteMany).not.toHaveBeenCalled()

    const event = eventCreate.mock.calls[0][0].data
    expect(event.eventType).toBe('station_selected')
    expect(event.storeId).toBe('store-1')
    expect(event.occurredAt).toBe(now)
    expect(event.extra).toEqual({ station_id: SOLO_PIANO.id, station_key: 'solo-piano' })
  })

  it('logs station_switched with the previous station on a change', async () => {
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: SOLO_PIANO.id })
    stationFindUnique.mockImplementation(async (args: any) =>
      args.where.id === LOFI.id
        ? stationRow({ id: LOFI.id, stationKey: LOFI.stationKey, displayName: 'Lofi Beats', icpId: LOFI.icpId })
        : { stationKey: SOLO_PIANO.stationKey, icpId: SOLO_PIANO.icpId },
    )

    const res = await setStoreStation('store-1', LOFI.id)

    expect(res.changed).toBe(true)
    expect(res.previousStationId).toBe(SOLO_PIANO.id)

    const event = eventCreate.mock.calls[0][0].data
    expect(event.eventType).toBe('station_switched')
    expect(event.extra).toEqual({
      station_id: LOFI.id,
      station_key: 'lofi-beats',
      previous_station_id: SOLO_PIANO.id,
      previous_station_key: 'solo-piano',
    })
  })

  it('unlinks the previous station pool and links the new one', async () => {
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: SOLO_PIANO.id })
    stationFindUnique.mockImplementation(async (args: any) =>
      args.where.id === LOFI.id
        ? stationRow({ id: LOFI.id, stationKey: LOFI.stationKey, icpId: LOFI.icpId })
        : { stationKey: SOLO_PIANO.stationKey, icpId: SOLO_PIANO.icpId },
    )

    await setStoreStation('store-1', LOFI.id)

    expect(storeIcpDeleteMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', icpId: SOLO_PIANO.icpId },
    })
    expect(storeIcpCreateMany).toHaveBeenCalledWith({
      data: [{ storeId: 'store-1', icpId: LOFI.icpId }],
      skipDuplicates: true,
    })
    // The canonical Free Tier ICP link is the fallback pool — only the
    // outgoing station's link may be removed.
    expect(storeIcpDeleteMany).toHaveBeenCalledTimes(1)
  })

  it('does all three writes inside one transaction', async () => {
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: null })
    stationFindUnique.mockResolvedValue(stationRow())
    await setStoreStation('store-1', SOLO_PIANO.id)
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when re-selecting the current station', async () => {
    // Double-tap in the picker must not log a switch from a station to itself.
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: SOLO_PIANO.id })
    stationFindUnique.mockResolvedValue(stationRow())

    const res = await setStoreStation('store-1', SOLO_PIANO.id)

    expect(res.changed).toBe(false)
    expect(res.previousStationId).toBe(SOLO_PIANO.id)
    expect(transaction).not.toHaveBeenCalled()
    expect(storeUpdate).not.toHaveBeenCalled()
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('throws 404 store_not_found for an unknown store', async () => {
    storeFindUnique.mockResolvedValue(null)
    stationFindUnique.mockResolvedValue(stationRow())
    await expect(setStoreStation('nope', SOLO_PIANO.id)).rejects.toMatchObject({
      status: 404,
      code: 'store_not_found',
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('throws 404 station_not_found for an unknown station', async () => {
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: null })
    stationFindUnique.mockResolvedValue(null)
    await expect(setStoreStation('store-1', 'nope')).rejects.toBeInstanceOf(AppError)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('throws 409 station_inactive for a deactivated station', async () => {
    // Stores already on it keep playing it; nobody new can move onto it.
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: null })
    stationFindUnique.mockResolvedValue(stationRow({ active: false }))
    await expect(setStoreStation('store-1', SOLO_PIANO.id)).rejects.toMatchObject({
      status: 409,
      code: 'station_inactive',
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('tolerates a store whose previous station row was deleted', async () => {
    // ON DELETE SET NULL clears stationId, but a store could still carry a
    // dangling id in flight. The switch must not throw on the lookup miss.
    storeFindUnique.mockResolvedValue({ id: 'store-1', stationId: 'gone' })
    stationFindUnique.mockImplementation(async (args: any) =>
      args.where.id === SOLO_PIANO.id ? stationRow() : null,
    )

    const res = await setStoreStation('store-1', SOLO_PIANO.id)

    expect(res.changed).toBe(true)
    expect(storeIcpDeleteMany).not.toHaveBeenCalled()
    const event = eventCreate.mock.calls[0][0].data
    expect(event.eventType).toBe('station_switched')
    expect(event.extra.previous_station_key).toBeNull()
  })
})
