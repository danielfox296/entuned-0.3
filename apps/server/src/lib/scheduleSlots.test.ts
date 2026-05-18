import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  prisma: { scheduleSlot: { findMany: vi.fn() } },
}))

import {
  timeToHHMM,
  hhmmToTime,
  hhmmToSec,
  ScheduleSlotBody,
  findOverlappingSlot,
  findOverlapForStoreDay,
} from './scheduleSlots.js'
import { prisma } from '../db.js'

// Convenience: build an existing-row shape that Prisma would hand back
// (Date startTime/endTime pinned to 1970-01-01 UTC).
function row(start: string, end: string) {
  return { startTime: hhmmToTime(start), endTime: hhmmToTime(end) }
}

describe('timeToHHMM', () => {
  it('pads single-digit hours and minutes', () => {
    expect(timeToHHMM(new Date('1970-01-01T05:07:00Z'))).toBe('05:07')
  })

  it('formats midnight as 00:00', () => {
    expect(timeToHHMM(new Date('1970-01-01T00:00:00Z'))).toBe('00:00')
  })

  it('formats 23:59 correctly', () => {
    expect(timeToHHMM(new Date('1970-01-01T23:59:00Z'))).toBe('23:59')
  })
})

describe('hhmmToTime', () => {
  it('accepts HH:MM and zero-pads to :00 seconds', () => {
    const d = hhmmToTime('09:30')
    expect(d.toISOString()).toBe('1970-01-01T09:30:00.000Z')
  })

  it('accepts HH:MM:SS', () => {
    const d = hhmmToTime('09:30:45')
    expect(d.toISOString()).toBe('1970-01-01T09:30:45.000Z')
  })
})

describe('hhmmToSec', () => {
  it('handles 00:00', () => {
    expect(hhmmToSec('00:00')).toBe(0)
  })

  it('handles 12:00', () => {
    expect(hhmmToSec('12:00')).toBe(12 * 3600)
  })

  it('handles 23:59:00', () => {
    expect(hhmmToSec('23:59:00')).toBe(23 * 3600 + 59 * 60)
  })

  it('handles 00:00:30 (seconds component)', () => {
    expect(hhmmToSec('00:00:30')).toBe(30)
  })

  it('is invariant to seconds presence when seconds are :00', () => {
    expect(hhmmToSec('14:15')).toBe(hhmmToSec('14:15:00'))
  })
})

describe('hhmmToTime + timeToHHMM round-trip', () => {
  it('preserves HH:MM (seconds are dropped by timeToHHMM, as expected)', () => {
    expect(timeToHHMM(hhmmToTime('07:42'))).toBe('07:42')
    expect(timeToHHMM(hhmmToTime('07:42:30'))).toBe('07:42')
  })
})

describe('ScheduleSlotBody schema', () => {
  const valid = {
    dayOfWeek: 3,
    startTime: '09:00',
    endTime: '10:00',
    outcomeId: '11111111-2222-3333-4444-555555555555',
  }

  it('accepts a valid object', () => {
    expect(ScheduleSlotBody.safeParse(valid).success).toBe(true)
  })

  it('accepts HH:MM:SS time strings', () => {
    const r = ScheduleSlotBody.safeParse({
      ...valid,
      startTime: '09:00:00',
      endTime: '10:00:30',
    })
    expect(r.success).toBe(true)
  })

  it('rejects dayOfWeek=0', () => {
    expect(ScheduleSlotBody.safeParse({ ...valid, dayOfWeek: 0 }).success).toBe(false)
  })

  it('rejects dayOfWeek=8', () => {
    expect(ScheduleSlotBody.safeParse({ ...valid, dayOfWeek: 8 }).success).toBe(false)
  })

  it('rejects non-integer dayOfWeek (1.5)', () => {
    expect(ScheduleSlotBody.safeParse({ ...valid, dayOfWeek: 1.5 }).success).toBe(false)
  })

  it("rejects malformed startTime '9:00' (regex requires two digits)", () => {
    expect(ScheduleSlotBody.safeParse({ ...valid, startTime: '9:00' }).success).toBe(false)
  })

  it("rejects malformed startTime '9a:00'", () => {
    expect(ScheduleSlotBody.safeParse({ ...valid, startTime: '9a:00' }).success).toBe(false)
  })

  it("regex is permissive about hour value — '25:00' matches the pattern and is accepted", () => {
    // Documented quirk: the regex only enforces shape (\d{2}:\d{2}), not range.
    // Out-of-range hours are not caught by zod; if/when stricter validation is
    // needed it must be added explicitly. This test pins the current behavior.
    const r = ScheduleSlotBody.safeParse({ ...valid, startTime: '25:00' })
    expect(r.success).toBe(true)
  })

  it('rejects non-UUID outcomeId', () => {
    expect(ScheduleSlotBody.safeParse({ ...valid, outcomeId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('findOverlappingSlot', () => {
  it('returns null when existing is empty', () => {
    expect(findOverlappingSlot({ startTime: '09:00', endTime: '10:00' }, [])).toBeNull()
  })

  it('returns null when candidate is entirely before every existing row', () => {
    const existing = [row('12:00', '13:00'), row('14:00', '15:00')]
    expect(findOverlappingSlot({ startTime: '08:00', endTime: '09:00' }, existing)).toBeNull()
  })

  it('returns null when candidate is entirely after every existing row', () => {
    const existing = [row('12:00', '13:00'), row('14:00', '15:00')]
    expect(findOverlappingSlot({ startTime: '16:00', endTime: '17:00' }, existing)).toBeNull()
  })

  it('detects full containment (candidate inside existing)', () => {
    const r = row('09:00', '12:00')
    const hit = findOverlappingSlot({ startTime: '10:00', endTime: '11:00' }, [r])
    expect(hit).toBe(r)
  })

  it('detects partial overlap on the left (candidate starts before, ends during)', () => {
    const r = row('10:00', '12:00')
    const hit = findOverlappingSlot({ startTime: '09:00', endTime: '11:00' }, [r])
    expect(hit).toBe(r)
  })

  it('detects partial overlap on the right (candidate starts during, ends after)', () => {
    const r = row('10:00', '12:00')
    const hit = findOverlappingSlot({ startTime: '11:00', endTime: '13:00' }, [r])
    expect(hit).toBe(r)
  })

  it('detects exact match (same start and end)', () => {
    const r = row('10:00', '12:00')
    const hit = findOverlappingSlot({ startTime: '10:00', endTime: '12:00' }, [r])
    expect(hit).toBe(r)
  })

  it('returns the FIRST overlapping row when multiple overlap', () => {
    const first = row('09:00', '11:00')
    const second = row('10:30', '12:00')
    const hit = findOverlappingSlot({ startTime: '10:00', endTime: '11:30' }, [first, second])
    expect(hit).toBe(first)
  })

  // The load-bearing invariant: half-open intervals — touching boundaries do NOT overlap.
  it('treats touching boundaries as NON-overlapping (12:00-13:00 vs 13:00-14:00)', () => {
    const existing = [row('13:00', '14:00')]
    expect(
      findOverlappingSlot({ startTime: '12:00', endTime: '13:00' }, existing),
    ).toBeNull()
  })

  it('treats touching boundaries as NON-overlapping in the reverse direction (14:00-15:00 vs 13:00-14:00)', () => {
    const existing = [row('13:00', '14:00')]
    expect(
      findOverlappingSlot({ startTime: '14:00', endTime: '15:00' }, existing),
    ).toBeNull()
  })

  it('compares correctly when candidate uses HH:MM:SS vs existing HH:MM', () => {
    const existing = [row('13:00', '14:00')]
    // Candidate ends one second into existing — should overlap.
    expect(
      findOverlappingSlot({ startTime: '12:00:00', endTime: '13:00:01' }, existing),
    ).toBe(existing[0])
    // Candidate ends exactly on boundary — should NOT overlap.
    expect(
      findOverlappingSlot({ startTime: '12:00:00', endTime: '13:00:00' }, existing),
    ).toBeNull()
  })

  it('accepts Prisma-shaped existing rows (Date startTime/endTime) and round-trips through timeToHHMM', () => {
    // Build a row using the same construction Prisma effectively does via @db.Time(6).
    const r = {
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T10:00:00.000Z'),
    }
    const hit = findOverlappingSlot({ startTime: '09:30', endTime: '09:45' }, [r])
    expect(hit).toBe(r)
  })
})

describe('findOverlapForStoreDay', () => {
  const findMany = prisma.scheduleSlot.findMany as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls findMany with { storeId, dayOfWeek } when no excludeId', async () => {
    findMany.mockResolvedValueOnce([])
    await findOverlapForStoreDay({
      storeId: 'store-1',
      dayOfWeek: 3,
      startTime: '09:00',
      endTime: '10:00',
    })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 3 },
    })
  })

  it('calls findMany with id: { not: excludeId } when excludeId is provided', async () => {
    findMany.mockResolvedValueOnce([])
    await findOverlapForStoreDay({
      storeId: 'store-2',
      dayOfWeek: 5,
      startTime: '09:00',
      endTime: '10:00',
      excludeId: 'slot-42',
    })
    expect(findMany).toHaveBeenCalledWith({
      where: { storeId: 'store-2', dayOfWeek: 5, id: { not: 'slot-42' } },
    })
  })

  it('returns null when findMany returns an empty array', async () => {
    findMany.mockResolvedValueOnce([])
    const result = await findOverlapForStoreDay({
      storeId: 'store-1',
      dayOfWeek: 3,
      startTime: '09:00',
      endTime: '10:00',
    })
    expect(result).toBeNull()
  })

  it('returns the clashing row when findMany returns an overlapping row', async () => {
    const clash = row('09:30', '10:30')
    findMany.mockResolvedValueOnce([clash])
    const result = await findOverlapForStoreDay({
      storeId: 'store-1',
      dayOfWeek: 3,
      startTime: '09:00',
      endTime: '10:00',
    })
    expect(result).toBe(clash)
  })

  it('returns null when findMany returns only touching (non-overlapping) rows', async () => {
    findMany.mockResolvedValueOnce([row('10:00', '11:00')])
    const result = await findOverlapForStoreDay({
      storeId: 'store-1',
      dayOfWeek: 3,
      startTime: '09:00',
      endTime: '10:00',
    })
    expect(result).toBeNull()
  })
})
