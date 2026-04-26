// Card 8 Dayparting — outcome resolution + outcome selection helpers.
// Resolution order: operator selection > schedule slot covering now (store-local) > store default.

import { prisma } from '../db.js'

const MIN_OVERRIDE_FLOOR_MS = 30 * 60 * 1000 // 30 minutes

export interface ResolvedOutcome {
  outcomeId: string
  source: 'selection' | 'schedule' | 'default'
  expiresAt?: Date // for selection only
}

/**
 * Convert a UTC instant to {dayOfWeek 1..7 (ISO), hh:mm:ss time-of-day} in the store's timezone.
 */
function localParts(now: Date, timezone: string): { dow: number; secondsOfDay: number; localDate: Date } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  )
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const dow = dowMap[parts.weekday]
  const h = parseInt(parts.hour, 10) % 24
  const m = parseInt(parts.minute, 10)
  const s = parseInt(parts.second, 10)
  const secondsOfDay = h * 3600 + m * 60 + s
  const localDate = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`)
  return { dow, secondsOfDay, localDate }
}

function timeToSeconds(t: Date): number {
  // Prisma @db.Time(6) round-trips as a Date with the time portion in UTC.
  return t.getUTCHours() * 3600 + t.getUTCMinutes() * 60 + t.getUTCSeconds()
}

export async function resolveActiveOutcome(storeId: string, now: Date = new Date()): Promise<ResolvedOutcome | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId } })
  if (!store) return null

  // 1. Live override?
  if (
    store.outcomeSelectionId &&
    store.outcomeSelectionExpiresAt &&
    now < store.outcomeSelectionExpiresAt
  ) {
    return {
      outcomeId: store.outcomeSelectionId,
      source: 'selection',
      expiresAt: store.outcomeSelectionExpiresAt,
    }
  }

  // 2. Schedule row covering now (store-local)?
  const { dow, secondsOfDay } = localParts(now, store.timezone)
  const rows = await prisma.scheduleSlot.findMany({
    where: { storeId, dayOfWeek: dow },
    orderBy: { startTime: 'asc' },
  })
  for (const r of rows) {
    const start = timeToSeconds(r.startTime)
    const end = timeToSeconds(r.endTime)
    if (secondsOfDay >= start && secondsOfDay < end) {
      return { outcomeId: r.outcomeId, source: 'schedule' }
    }
  }

  // 3. Default outcome.
  if (store.defaultOutcomeId) {
    return { outcomeId: store.defaultOutcomeId, source: 'default' }
  }

  return null
}

/**
 * Compute the next scheduled period boundary at or after `now` (store-local).
 * "Boundary" = the next start_time or end_time that comes after `now`, looking up to 7 days ahead.
 */
async function nextPeriodBoundary(storeId: string, timezone: string, now: Date): Promise<Date> {
  const allRows = await prisma.scheduleSlot.findMany({ where: { storeId } })
  const { dow, secondsOfDay, localDate } = localParts(now, timezone)
  let minDelta = Infinity

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const checkDow = ((dow - 1 + dayOffset) % 7) + 1
    const dayRows = allRows.filter((r) => r.dayOfWeek === checkDow)
    for (const r of dayRows) {
      const start = timeToSeconds(r.startTime)
      const end = timeToSeconds(r.endTime)
      for (const t of [start, end]) {
        // Seconds from `now` to this boundary on this day.
        const delta = dayOffset * 86400 + (t - secondsOfDay)
        if (delta > 0 && delta < minDelta) minDelta = delta
      }
    }
  }

  if (!isFinite(minDelta)) {
    // No schedule rows at all — fall back to 24h from now.
    return new Date(now.getTime() + 24 * 60 * 60 * 1000)
  }
  // localDate is start-of-today UTC; add secondsOfDay (local seconds since midnight) + minDelta.
  // But we need to express the boundary back in UTC. Easier: compute the boundary instant by
  // adding minDelta seconds to `now`.
  return new Date(now.getTime() + minDelta * 1000)
}

export async function setOverride(storeId: string, outcomeId: string, now: Date = new Date()): Promise<{ outcomeId: string; expiresAt: Date }> {
  const store = await prisma.store.findUnique({ where: { id: storeId } })
  if (!store) throw new Error(`store not found: ${storeId}`)

  const boundary = await nextPeriodBoundary(storeId, store.timezone, now)
  const floor = new Date(now.getTime() + MIN_OVERRIDE_FLOOR_MS)
  const expiresAt = boundary > floor ? boundary : floor

  await prisma.store.update({
    where: { id: storeId },
    data: {
      outcomeSelectionId: outcomeId,
      outcomeSelectionExpiresAt: expiresAt,
    },
  })
  return { outcomeId, expiresAt }
}

export async function clearOverride(storeId: string): Promise<void> {
  await prisma.store.update({
    where: { id: storeId },
    data: { outcomeSelectionId: null, outcomeSelectionExpiresAt: null },
  })
}
