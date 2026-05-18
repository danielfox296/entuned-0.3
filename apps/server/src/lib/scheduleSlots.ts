// Schedule-slot helpers — shared between the operator (Dash) and customer
// (/me) surfaces. Both surfaces register their own routes with their own auth,
// but the time-string helpers, body schema, and overlap-detection logic are
// identical and live here.
//
// What's intentionally NOT shared:
//   - Route handlers (auth + path shape differ per surface).
//   - The free-tier outcome guard (operator surface enforces it; customer
//     surface does not — see ASSESSMENT.md §2.2 and the call sites).
//   - The exact `schedule_overlap` message wording (admin says
//     "Overlaps with existing slot HH:MM–HH:MM"; me says "Overlaps with
//     HH:MM–HH:MM"). `findOverlappingSlot` returns the clashing row and
//     each surface formats its own message to preserve byte-identical
//     client contracts.
//   - The GET/POST/PUT response shape (admin includes `outcomeVersion`; me
//     does not). Each surface keeps its own formatter.

import { z } from 'zod'
import { prisma } from '../db.js'

// ----- Time helpers — Prisma @db.Time(6) round-trips as Date with UTC time portion. -----

export function timeToHHMM(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export function hhmmToTime(s: string): Date {
  const padded = s.length === 5 ? `${s}:00` : s
  return new Date(`1970-01-01T${padded}.000Z`)
}

export function hhmmToSec(s: string): number {
  const [h, m, sec] = s.split(':').map((x) => parseInt(x, 10))
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0)
}

// ----- Body schema (identical on both surfaces). -----

export const ScheduleSlotBody = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  outcomeId: z.string().uuid(),
})

export type ScheduleSlotInput = z.infer<typeof ScheduleSlotBody>

// ----- Overlap detection. -----

/**
 * The minimum shape a ScheduleSlot row needs to be checked for overlap.
 * Matches what `prisma.scheduleSlot.findMany` returns by default.
 */
export interface SlotForOverlap {
  startTime: Date
  endTime: Date
}

/**
 * Find an existing slot on the same day that overlaps `[startTime, endTime)`.
 * Inputs are HH:MM[:SS] strings; rows come from Prisma. Returns the first
 * clashing row or null.
 *
 * Both surfaces format their own `schedule_overlap` reply message from the
 * returned row — wording is NOT identical across surfaces today and is left
 * to the caller to preserve byte-identical client contracts.
 */
export function findOverlappingSlot<T extends SlotForOverlap>(
  candidate: { startTime: string; endTime: string },
  existing: T[],
): T | null {
  const newStart = hhmmToSec(candidate.startTime)
  const newEnd = hhmmToSec(candidate.endTime)
  return (
    existing.find(
      (s) =>
        newStart < hhmmToSec(timeToHHMM(s.endTime)) &&
        hhmmToSec(timeToHHMM(s.startTime)) < newEnd,
    ) ?? null
  )
}

/**
 * Convenience: fetch the candidate-day slots for a store and run overlap
 * detection in one call. Pass `excludeId` when validating an UPDATE so the
 * row being edited doesn't clash with itself.
 */
export async function findOverlapForStoreDay(args: {
  storeId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  excludeId?: string
}): Promise<SlotForOverlap | null> {
  const siblings = await prisma.scheduleSlot.findMany({
    where: {
      storeId: args.storeId,
      dayOfWeek: args.dayOfWeek,
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
  })
  return findOverlappingSlot(
    { startTime: args.startTime, endTime: args.endTime },
    siblings,
  )
}
