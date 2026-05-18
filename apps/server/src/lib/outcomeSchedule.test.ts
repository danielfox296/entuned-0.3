import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma BEFORE importing the module under test. The path must be a
// literal — vi.mock is hoisted, and the path is relative to this test file.
vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scheduleSlot: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('./outcomes.js', () => ({
  getFreeTierAllowedOutcomeIds: vi.fn(),
}))

import { resolveActiveOutcome, setOverride, clearOverride } from './outcomeSchedule.js'
import { prisma } from '../db.js'
import { getFreeTierAllowedOutcomeIds } from './outcomes.js'

// --- helpers ---------------------------------------------------------------

const storeFindUnique = prisma.store.findUnique as unknown as ReturnType<typeof vi.fn>
const storeUpdate = prisma.store.update as unknown as ReturnType<typeof vi.fn>
const slotFindMany = prisma.scheduleSlot.findMany as unknown as ReturnType<typeof vi.fn>
const allowedIdsMock = getFreeTierAllowedOutcomeIds as unknown as ReturnType<typeof vi.fn>

/**
 * Build a Date with the time-of-day portion in UTC. Prisma's @db.Time(6)
 * columns are returned as Dates pinned to 1970-01-01 UTC; outcomeSchedule's
 * `timeToSeconds` reads getUTC{Hours,Minutes,Seconds}.
 */
function timeOfDay(h: number, m: number, s = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, h, m, s))
}

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    id: 'store-1',
    tier: 'pro',
    timezone: 'UTC',
    defaultOutcomeId: 'default-outcome',
    outcomeSelectionId: null,
    outcomeSelectionExpiresAt: null,
    ...overrides,
  }
}

function slot(opts: { dayOfWeek: number; start: [number, number, number?]; end: [number, number, number?]; outcomeId: string }) {
  return {
    id: `slot-${Math.random()}`,
    storeId: 'store-1',
    dayOfWeek: opts.dayOfWeek,
    startTime: timeOfDay(opts.start[0], opts.start[1], opts.start[2] ?? 0),
    endTime: timeOfDay(opts.end[0], opts.end[1], opts.end[2] ?? 0),
    outcomeId: opts.outcomeId,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no free-tier mapping configured.
  allowedIdsMock.mockResolvedValue(new Set<string>())
})

// --- resolveActiveOutcome: store + null ----------------------------------------

describe('resolveActiveOutcome — basic + missing store', () => {
  it('returns null when store does not exist', async () => {
    storeFindUnique.mockResolvedValue(null)
    const result = await resolveActiveOutcome('missing')
    expect(result).toBeNull()
  })

  it('returns null when store has no selection, no schedule, no default', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ defaultOutcomeId: null }))
    slotFindMany.mockResolvedValue([])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T12:00:00Z'))
    expect(result).toBeNull()
  })

  it('returns default when no selection and no schedule slots', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T12:00:00Z'))
    expect(result).toEqual({ outcomeId: 'def-1', source: 'default' })
  })
})

// --- resolveActiveOutcome: priority -------------------------------------------

describe('resolveActiveOutcome — resolution priority', () => {
  const now = new Date('2026-05-18T12:00:00Z') // Monday 12:00 UTC

  it('selection takes precedence over schedule and default', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        outcomeSelectionId: 'sel-1',
        outcomeSelectionExpiresAt: new Date('2026-05-18T13:00:00Z'),
        defaultOutcomeId: 'def-1',
      }),
    )
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [9, 0], end: [17, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({
      outcomeId: 'sel-1',
      source: 'selection',
      expiresAt: new Date('2026-05-18T13:00:00Z'),
    })
  })

  it('schedule takes precedence over default when no active selection', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [9, 0], end: [17, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({ outcomeId: 'sched-1', source: 'schedule' })
  })

  it('default falls back when neither selection nor schedule applies', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [14, 0], end: [17, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', now) // 12:00, slot starts 14:00
    expect(result).toEqual({ outcomeId: 'def-1', source: 'default' })
  })

  it('expired selection (expiry in the past) is ignored — falls through to schedule', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        outcomeSelectionId: 'sel-1',
        outcomeSelectionExpiresAt: new Date('2026-05-18T11:00:00Z'), // before now
        defaultOutcomeId: 'def-1',
      }),
    )
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [9, 0], end: [17, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({ outcomeId: 'sched-1', source: 'schedule' })
  })

  it('selection at the exact expiry instant is treated as expired (exclusive boundary)', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        outcomeSelectionId: 'sel-1',
        outcomeSelectionExpiresAt: new Date('2026-05-18T12:00:00Z'), // exactly now
        defaultOutcomeId: 'def-1',
      }),
    )
    slotFindMany.mockResolvedValue([])
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({ outcomeId: 'def-1', source: 'default' })
  })

  it('selection with no expiry is ignored (treated as not active)', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        outcomeSelectionId: 'sel-1',
        outcomeSelectionExpiresAt: null,
        defaultOutcomeId: 'def-1',
      }),
    )
    slotFindMany.mockResolvedValue([])
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({ outcomeId: 'def-1', source: 'default' })
  })
})

// --- resolveActiveOutcome: schedule edge cases ---------------------------------

describe('resolveActiveOutcome — schedule slot boundaries', () => {
  it('slot at exact start time matches (inclusive start)', async () => {
    storeFindUnique.mockResolvedValue(makeStore())
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [12, 0], end: [13, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T12:00:00Z'))
    expect(result).toEqual({ outcomeId: 'sched-1', source: 'schedule' })
  })

  it('slot at exact end time does NOT match (exclusive end)', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [11, 0], end: [12, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T12:00:00Z'))
    expect(result).toEqual({ outcomeId: 'def-1', source: 'default' })
  })

  it('with multiple slots on the same day, picks the one covering "now"', async () => {
    storeFindUnique.mockResolvedValue(makeStore())
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [9, 0], end: [11, 0], outcomeId: 'morning' }),
      slot({ dayOfWeek: 1, start: [11, 0], end: [14, 0], outcomeId: 'midday' }),
      slot({ dayOfWeek: 1, start: [14, 0], end: [18, 0], outcomeId: 'afternoon' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T12:00:00Z'))
    expect(result).toEqual({ outcomeId: 'midday', source: 'schedule' })
  })
})

// --- resolveActiveOutcome: timezone math --------------------------------------

describe('resolveActiveOutcome — timezone math (non-UTC)', () => {
  it('queries the correct day-of-week in America/Denver when UTC and local day differ (UTC Monday early -> Denver Sunday)', async () => {
    // 2026-05-18T03:00:00Z = Monday 03:00 UTC = Sunday 21:00 MDT (Denver, UTC-6 in DST)
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/Denver' }))
    slotFindMany.mockResolvedValue([])
    await resolveActiveOutcome('store-1', new Date('2026-05-18T03:00:00Z'))
    expect(slotFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 7 }, // Sunday
      orderBy: { startTime: 'asc' },
    })
  })

  it('America/New_York: matches slot covering 14:00 local on Monday', async () => {
    // 2026-05-18T18:00:00Z = Monday 14:00 EDT (NYC, UTC-4 in DST)
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/New_York' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [13, 0], end: [15, 0], outcomeId: 'sched-1' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T18:00:00Z'))
    expect(slotFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 1 },
      orderBy: { startTime: 'asc' },
    })
    expect(result).toEqual({ outcomeId: 'sched-1', source: 'schedule' })
  })

  it('Asia/Tokyo: UTC Monday 17:00 = Tokyo Tuesday 02:00, queries dow=2', async () => {
    // 2026-05-18T17:00:00Z = 2026-05-19 02:00 JST (UTC+9)
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'Asia/Tokyo' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 2, start: [1, 0], end: [3, 0], outcomeId: 'tokyo-morning' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-05-18T17:00:00Z'))
    expect(slotFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 2 },
      orderBy: { startTime: 'asc' },
    })
    expect(result).toEqual({ outcomeId: 'tokyo-morning', source: 'schedule' })
  })

  it('week boundary: Sunday 23:30 UTC rolls to Monday in Asia/Tokyo (dow 7 -> 1)', async () => {
    // 2026-05-17T23:30:00Z = Sunday 23:30 UTC = Monday 08:30 JST
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'Asia/Tokyo' }))
    slotFindMany.mockResolvedValue([])
    await resolveActiveOutcome('store-1', new Date('2026-05-17T23:30:00Z'))
    expect(slotFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 1 },
      orderBy: { startTime: 'asc' },
    })
  })

  it('UTC midnight: Monday 00:00:00 UTC queries dow=1 in UTC timezone', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'UTC' }))
    slotFindMany.mockResolvedValue([])
    await resolveActiveOutcome('store-1', new Date('2026-05-18T00:00:00Z'))
    expect(slotFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 1 },
      orderBy: { startTime: 'asc' },
    })
  })
})

// --- resolveActiveOutcome: DST transitions ------------------------------------

describe('resolveActiveOutcome — DST transitions in America/Denver', () => {
  // Spring-forward 2026-03-08: 02:00 MST -> 03:00 MDT (clocks jump forward, "skipping" 02:00-03:00)
  // Before transition: UTC offset -07:00. After: -06:00.

  it('one minute before spring-forward: 08:59 UTC = 01:59 MST (Sunday)', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/Denver' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 7, start: [1, 0], end: [2, 0], outcomeId: 'pre-dst' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-03-08T08:59:00Z'))
    expect(slotFindMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', dayOfWeek: 7 },
      orderBy: { startTime: 'asc' },
    })
    expect(result).toEqual({ outcomeId: 'pre-dst', source: 'schedule' })
  })

  it('just after spring-forward: 09:00 UTC = 03:00 MDT (Sunday) — local clock jumps from 02:00 to 03:00', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/Denver', defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 7, start: [3, 0], end: [5, 0], outcomeId: 'post-dst' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-03-08T09:00:00Z'))
    expect(result).toEqual({ outcomeId: 'post-dst', source: 'schedule' })
  })

  it('spring-forward: a slot covering 02:00-03:00 local is effectively unreachable (skipped hour)', async () => {
    // No UTC instant maps to 02:30 MDT on 2026-03-08 — the local clock skips it.
    // Verify: 08:59 UTC = 01:59 MST, 09:00 UTC = 03:00 MDT. A slot 02:00-03:00 should
    // never match.
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/Denver', defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 7, start: [2, 0], end: [3, 0], outcomeId: 'skipped' }),
    ])
    // Just before transition: 01:59 local
    const before = await resolveActiveOutcome('store-1', new Date('2026-03-08T08:59:00Z'))
    expect(before).toEqual({ outcomeId: 'def-1', source: 'default' })
    // Just after transition: 03:00 local (slot end, exclusive — no match)
    const after = await resolveActiveOutcome('store-1', new Date('2026-03-08T09:00:00Z'))
    expect(after).toEqual({ outcomeId: 'def-1', source: 'default' })
  })

  // Fall-back 2026-11-01: 02:00 MDT -> 01:00 MST (clocks roll back, repeating 01:00-02:00).

  it('one minute before fall-back: 07:59 UTC = 01:59 MDT (Sunday)', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/Denver' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 7, start: [1, 0], end: [2, 0], outcomeId: 'fall-pre' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-11-01T07:59:00Z'))
    expect(result).toEqual({ outcomeId: 'fall-pre', source: 'schedule' })
  })

  it('after fall-back: 09:00 UTC = 02:00 MST (Sunday) — second pass through 01:xx already done', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'America/Denver', defaultOutcomeId: 'def-1' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 7, start: [2, 0], end: [3, 0], outcomeId: 'fall-after' }),
    ])
    const result = await resolveActiveOutcome('store-1', new Date('2026-11-01T09:00:00Z'))
    expect(result).toEqual({ outcomeId: 'fall-after', source: 'schedule' })
  })
})

// --- resolveActiveOutcome: free-tier allowlist --------------------------------

describe('resolveActiveOutcome — free-tier allowlist', () => {
  const now = new Date('2026-05-18T12:00:00Z') // Monday 12:00 UTC

  it('non-free store ignores allowlist entirely', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        tier: 'pro',
        outcomeSelectionId: 'sel-1',
        outcomeSelectionExpiresAt: new Date('2026-05-18T13:00:00Z'),
      }),
    )
    slotFindMany.mockResolvedValue([])
    allowedIdsMock.mockResolvedValue(new Set(['something-else'])) // 'sel-1' not present
    const result = await resolveActiveOutcome('store-1', now)
    expect(result?.outcomeId).toBe('sel-1')
    expect(allowedIdsMock).not.toHaveBeenCalled()
  })

  it('free store: selection NOT in allowlist falls through to schedule', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        tier: 'free',
        outcomeSelectionId: 'forbidden-selection',
        outcomeSelectionExpiresAt: new Date('2026-05-18T13:00:00Z'),
      }),
    )
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [9, 0], end: [17, 0], outcomeId: 'allowed-sched' }),
    ])
    allowedIdsMock.mockResolvedValue(new Set(['allowed-sched']))
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({ outcomeId: 'allowed-sched', source: 'schedule' })
  })

  it('free store: schedule slot NOT in allowlist is skipped, falls to default', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({ tier: 'free', defaultOutcomeId: 'allowed-default' }),
    )
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [9, 0], end: [17, 0], outcomeId: 'forbidden-sched' }),
    ])
    allowedIdsMock.mockResolvedValue(new Set(['allowed-default']))
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toEqual({ outcomeId: 'allowed-default', source: 'default' })
  })

  it('free store: default NOT in allowlist returns null', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({ tier: 'free', defaultOutcomeId: 'forbidden-default' }),
    )
    slotFindMany.mockResolvedValue([])
    allowedIdsMock.mockResolvedValue(new Set(['something-else']))
    const result = await resolveActiveOutcome('store-1', now)
    expect(result).toBeNull()
  })

  it('free store: empty allowlist short-circuits the guard (treated as "all allowed")', async () => {
    storeFindUnique.mockResolvedValue(
      makeStore({
        tier: 'free',
        outcomeSelectionId: 'sel-1',
        outcomeSelectionExpiresAt: new Date('2026-05-18T13:00:00Z'),
      }),
    )
    slotFindMany.mockResolvedValue([])
    allowedIdsMock.mockResolvedValue(new Set()) // empty
    const result = await resolveActiveOutcome('store-1', now)
    expect(result?.outcomeId).toBe('sel-1')
    expect(result?.source).toBe('selection')
  })
})

// --- setOverride: MIN_OVERRIDE_FLOOR_MS (30 min) -------------------------------

describe('setOverride — minimum 30-minute floor', () => {
  const now = new Date('2026-05-18T12:00:00Z')

  it('throws when the store does not exist', async () => {
    storeFindUnique.mockResolvedValue(null)
    await expect(setOverride('missing', 'o1', now)).rejects.toThrow(/store not found/)
  })

  it('uses 30-minute floor when no schedule exists (next boundary = 24h)', async () => {
    storeFindUnique.mockResolvedValue(makeStore())
    slotFindMany.mockResolvedValue([])
    const result = await setOverride('store-1', 'o1', now)
    // With no schedule rows, nextPeriodBoundary returns now + 24h (way past floor).
    expect(result.expiresAt).toEqual(new Date('2026-05-19T12:00:00Z'))
  })

  it('boundary 29 minutes away gets pushed to 30-minute floor', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'UTC' }))
    // Monday 12:00 UTC; slot end at 12:29 (29 minutes from now).
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [11, 0], end: [12, 29], outcomeId: 'x' }),
    ])
    const result = await setOverride('store-1', 'o1', now)
    expect(result.expiresAt).toEqual(new Date('2026-05-18T12:30:00Z'))
  })

  it('boundary exactly 30 minutes away — floor and boundary are equal; floor wins (boundary > floor is strict)', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'UTC' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [11, 0], end: [12, 30], outcomeId: 'x' }),
    ])
    const result = await setOverride('store-1', 'o1', now)
    // When boundary === floor, the `>` comparison picks the floor (same instant).
    expect(result.expiresAt).toEqual(new Date('2026-05-18T12:30:00Z'))
  })

  it('boundary 31 minutes away beats the floor and is used directly', async () => {
    storeFindUnique.mockResolvedValue(makeStore({ timezone: 'UTC' }))
    slotFindMany.mockResolvedValue([
      slot({ dayOfWeek: 1, start: [11, 0], end: [12, 31], outcomeId: 'x' }),
    ])
    const result = await setOverride('store-1', 'o1', now)
    expect(result.expiresAt).toEqual(new Date('2026-05-18T12:31:00Z'))
  })

  it('persists the override via prisma.store.update', async () => {
    storeFindUnique.mockResolvedValue(makeStore())
    slotFindMany.mockResolvedValue([])
    await setOverride('store-1', 'o1', now)
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: {
        outcomeSelectionId: 'o1',
        outcomeSelectionExpiresAt: new Date('2026-05-19T12:00:00Z'),
      },
    })
  })
})

// --- clearOverride ------------------------------------------------------------

describe('clearOverride', () => {
  it('nullifies selection fields on the store', async () => {
    storeUpdate.mockResolvedValue({})
    await clearOverride('store-1')
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { outcomeSelectionId: null, outcomeSelectionExpiresAt: null },
    })
  })
})
