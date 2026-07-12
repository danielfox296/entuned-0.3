// Integration tests for the customer-facing schedule-slot CRUD routes on
// /me (apps/server/src/routes/me.ts).
//
// Scope: POST /stores/:storeId/schedule, GET /stores/:storeId/schedule,
// PUT /schedule-rows/:id, DELETE /schedule-rows/:id. These routes are the
// integration layer over apps/server/src/lib/scheduleSlots.ts — the tests
// here exist to prove the shared-library consolidation didn't break the
// customer surface end-to-end.
//
// Mocking strategy:
//   - Prisma: vi.mock('../db.js', ...) at the top, only the models the
//     schedule handlers touch (store, scheduleSlot).
//   - Auth: vi.mock('../lib/session.js', ...) overrides `requireAuth` (the
//     preHandler) to inline-populate request.user and request.account, the
//     same fields the real `attachSession` hook would set. Default test
//     client id is 'client-test-001'. Tests that exercise "user X tries to
//     touch user Y's data" achieve cross-client 404s by having the prisma
//     mock return null for the cross-client lookup, NOT by varying auth.
//
// The exact `schedule_overlap` message wording is the public contract: this
// surface uses "Overlaps with HH:MM–HH:MM" (no "existing slot" prefix —
// that's the admin variant). Pinned byte-for-byte below.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Prisma mock. Path is literal (relative to this test file), per
// TESTING.md "Mocking conventions".
vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    scheduleSlot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    iCP: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    outcome: {
      findMany: vi.fn(),
    },
  },
}))

// Free-tier allowlist helpers — mocked so tests control allowlist membership
// without wiring freeTierOutcome prisma mocks. pickSystemDefaultOutcomeId
// keeps its real implementation (other routes use it; their tests mock prisma).
vi.mock('../lib/outcomes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/outcomes.js')>()
  return {
    ...actual,
    isFreeTierAllowedOutcome: vi.fn(),
    getFreeTierAllowedOutcomeIds: vi.fn(),
  }
})

// Bypass auth by stubbing requireAuth to populate the same request fields the
// real session plugin would. Default authed-as: client-test-001.
vi.mock('../lib/session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/session.js')>()
  return {
    ...actual,
    requireAuth: vi.fn(async (request: any) => {
      request.user = { id: 'account-test-001', email: 'test@example.com', name: null }
      request.account = { id: 'client-test-001', name: 'Test Co' }
      request.role = 'owner'
    }),
  }
})

import { meRoutes } from './me.js'
import { prisma } from '../db.js'
import { isFreeTierAllowedOutcome, getFreeTierAllowedOutcomeIds } from '../lib/outcomes.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const isFreeAllowedMock = isFreeTierAllowedOutcome as ReturnType<typeof vi.fn>
const freeAllowedIdsMock = getFreeTierAllowedOutcomeIds as ReturnType<typeof vi.fn>
const storeFindFirst = prisma.store.findFirst as ReturnType<typeof vi.fn>
const slotFindMany = prisma.scheduleSlot.findMany as ReturnType<typeof vi.fn>
const slotFindUnique = prisma.scheduleSlot.findUnique as ReturnType<typeof vi.fn>
const slotCreate = prisma.scheduleSlot.create as ReturnType<typeof vi.fn>
const slotUpdate = prisma.scheduleSlot.update as ReturnType<typeof vi.fn>
const slotDelete = prisma.scheduleSlot.delete as ReturnType<typeof vi.fn>

const STORE_ID = 'store-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_STORE_ID = 'store-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const OUTCOME_ID = '11111111-1111-1111-1111-111111111111'
const SLOT_ID = 'slot-cccccccc-cccc-cccc-cccc-cccccccccccc'
const CLIENT_ID = 'client-test-001'

// hhmmToTime mirror — Prisma @db.Time(6) round-trips as Date with the UTC
// time portion set. Use this to build fixture rows the handlers will format
// back to HH:MM via timeToHHMM.
function hhmmDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}

function makeSlotRow(overrides: Partial<{
  id: string
  storeId: string
  dayOfWeek: number
  startTime: Date
  endTime: Date
  outcomeId: string
  outcome: { title: string; displayTitle: string | null }
}> = {}) {
  return {
    id: SLOT_ID,
    storeId: STORE_ID,
    dayOfWeek: 1,
    startTime: hhmmDate('09:00'),
    endTime: hhmmDate('10:00'),
    outcomeId: OUTCOME_ID,
    outcome: { title: 'Energize', displayTitle: 'Morning Energize' },
    ...overrides,
  }
}

describe('me schedule-slot routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Permissive defaults — free-tier restriction tests override per-case.
    isFreeAllowedMock.mockResolvedValue(true)
    freeAllowedIdsMock.mockResolvedValue(new Set<string>())
  })

  // ---------- GET /stores/:storeId/schedule ----------

  describe('GET /stores/:storeId/schedule', () => {
    it('returns 200 with formatted rows when the store belongs to the client', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([
        makeSlotRow({ dayOfWeek: 1, startTime: hhmmDate('09:00'), endTime: hhmmDate('10:00') }),
        makeSlotRow({ id: 'slot-other', dayOfWeek: 3, startTime: hhmmDate('13:00'), endTime: hhmmDate('14:30') }),
      ])

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({ method: 'GET', url: `/stores/${STORE_ID}/schedule` })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveLength(2)
      expect(body[0]).toEqual({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        outcomeId: OUTCOME_ID,
        outcomeTitle: 'Energize',
        outcomeDisplayTitle: 'Morning Energize',
      })
      // Scope check: ownership is gated by clientId + archivedAt:null.
      expect(storeFindFirst).toHaveBeenCalledWith({
        where: { id: STORE_ID, clientId: CLIENT_ID, archivedAt: null },
        select: { id: true },
      })
    })

    it('returns 404 when the store does not belong to the client', async () => {
      storeFindFirst.mockResolvedValue(null)

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({ method: 'GET', url: `/stores/${OTHER_STORE_ID}/schedule` })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_not_found' })
      expect(slotFindMany).not.toHaveBeenCalled()
    })
  })

  // ---------- POST /stores/:storeId/schedule ----------

  describe('POST /stores/:storeId/schedule', () => {
    it('returns 201 with the created slot on happy path', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([]) // no existing slots to clash with
      slotCreate.mockResolvedValue(makeSlotRow({
        dayOfWeek: 2,
        startTime: hhmmDate('12:00'),
        endTime: hhmmDate('13:00'),
      }))

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 2, startTime: '12:00', endTime: '13:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toEqual({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 2,
        startTime: '12:00',
        endTime: '13:00',
        outcomeId: OUTCOME_ID,
        outcomeTitle: 'Energize',
        outcomeDisplayTitle: 'Morning Energize',
      })

      // Pin the Prisma create shape: HH:MM strings come in, Date with UTC
      // time portion goes out. If this ever drifts the Prisma @db.Time(6)
      // column will silently shift hours.
      expect(slotCreate).toHaveBeenCalledWith({
        data: {
          storeId: STORE_ID,
          dayOfWeek: 2,
          startTime: hhmmDate('12:00'),
          endTime: hhmmDate('13:00'),
          outcomeId: OUTCOME_ID,
        },
        include: { outcome: { select: { title: true, displayTitle: true } } },
      })
    })

    it('queries siblings scoped to (storeId, dayOfWeek) — used as the outcome-lookup-equivalent where shape', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([])
      slotCreate.mockResolvedValue(makeSlotRow())

      const app = await buildTestApp(meRoutes)
      await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 5, startTime: '08:00', endTime: '09:00', outcomeId: OUTCOME_ID },
      })

      expect(slotFindMany).toHaveBeenCalledWith({
        where: { storeId: STORE_ID, dayOfWeek: 5 },
      })
    })

    it('returns 404 when the store does not belong to the client', async () => {
      storeFindFirst.mockResolvedValue(null)

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${OTHER_STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_not_found' })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    it('returns 400 on bad body (zod validation — missing outcomeId)', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'bad_body' })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    it('returns 400 on bad body (zod — malformed time string)', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '9am', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'bad_body' })
    })

    it('returns 400 when startTime >= endTime (start_must_precede_end)', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([])

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '10:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'start_must_precede_end' })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    // The schedule_overlap message wording is the PUBLIC CONTRACT. /me uses
    // "Overlaps with HH:MM–HH:MM" (no "existing slot" prefix; admin has that).
    // Em-dash, not hyphen. Byte-exact.
    it('returns 409 with byte-exact schedule_overlap message on overlap', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([
        // Existing 12:00–13:00 — the candidate 12:30–13:30 should clash.
        { id: 'slot-existing', startTime: hhmmDate('12:00'), endTime: hhmmDate('13:00') },
      ])

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '12:30', endTime: '13:30', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'schedule_overlap',
        message: 'Overlaps with 12:00–13:00',
      })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    // FE-1 (2026-07-11 audit): an identical slot (same day, time range, AND
    // outcome) already exists. The route must return it idempotently — 200 with
    // the existing row — instead of 409'ing on self-overlap or duplicating it.
    // This is what makes a partial-failure retry of a multi-day create safe: the
    // client can resubmit the same set and already-persisted days come back OK.
    it('returns 200 with the existing row when an identical slot already exists (idempotent)', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([
        { id: SLOT_ID, startTime: hhmmDate('09:00'), endTime: hhmmDate('10:00'), outcomeId: OUTCOME_ID },
      ])
      slotFindUnique.mockResolvedValue(makeSlotRow())

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        outcomeId: OUTCOME_ID,
        outcomeTitle: 'Energize',
        outcomeDisplayTitle: 'Morning Energize',
      })
      expect(slotCreate).not.toHaveBeenCalled()
      expect(slotFindUnique).toHaveBeenCalledWith({
        where: { id: SLOT_ID },
        include: { outcome: { select: { title: true, displayTitle: true } } },
      })
    })

    // Idempotency must NOT swallow a genuine clash: same day + overlapping time
    // but a DIFFERENT outcome is not "identical" — it still 409s as an overlap.
    it('still returns 409 when an overlapping slot has a different outcome (not idempotent)', async () => {
      storeFindFirst.mockResolvedValue({ id: STORE_ID })
      slotFindMany.mockResolvedValue([
        { id: 'slot-other', startTime: hhmmDate('09:00'), endTime: hhmmDate('10:00'), outcomeId: '99999999-9999-9999-9999-999999999999' },
      ])

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({ error: 'schedule_overlap', message: 'Overlaps with 09:00–10:00' })
      expect(slotCreate).not.toHaveBeenCalled()
      expect(slotFindUnique).not.toHaveBeenCalled()
    })
  })

  // ---------- PUT /schedule-rows/:id ----------

  describe('PUT /schedule-rows/:id', () => {
    it('returns 200 with the updated slot on happy path', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
        store: { clientId: CLIENT_ID },
      })
      slotFindMany.mockResolvedValue([]) // no siblings
      slotUpdate.mockResolvedValue(makeSlotRow({
        dayOfWeek: 1,
        startTime: hhmmDate('11:00'),
        endTime: hhmmDate('12:00'),
      }))

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 1, startTime: '11:00', endTime: '12:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: '11:00',
        endTime: '12:00',
        outcomeId: OUTCOME_ID,
        outcomeTitle: 'Energize',
        outcomeDisplayTitle: 'Morning Energize',
      })
      expect(slotUpdate).toHaveBeenCalledWith({
        where: { id: SLOT_ID },
        data: {
          dayOfWeek: 1,
          startTime: hhmmDate('11:00'),
          endTime: hhmmDate('12:00'),
          outcomeId: OUTCOME_ID,
        },
        include: { outcome: { select: { title: true, displayTitle: true } } },
      })
    })

    it('queries siblings excluding the row being edited (id: { not: id } filter)', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 2,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
        store: { clientId: CLIENT_ID },
      })
      slotFindMany.mockResolvedValue([])
      slotUpdate.mockResolvedValue(makeSlotRow({ dayOfWeek: 2 }))

      const app = await buildTestApp(meRoutes)
      await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 2, startTime: '09:30', endTime: '10:30', outcomeId: OUTCOME_ID },
      })

      expect(slotFindMany).toHaveBeenCalledWith({
        where: { storeId: STORE_ID, dayOfWeek: 2, id: { not: SLOT_ID } },
      })
    })

    it('returns 404 when the row does not exist', async () => {
      slotFindUnique.mockResolvedValue(null)

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
      expect(slotUpdate).not.toHaveBeenCalled()
    })

    it("returns 404 when the row's store belongs to a different client", async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: OTHER_STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
        store: { clientId: 'client-other-002' },
      })

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
      expect(slotUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 on bad body', async () => {
      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 99, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'bad_body' })
      expect(slotFindUnique).not.toHaveBeenCalled()
    })

    it('returns 400 when startTime >= endTime', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
        store: { clientId: CLIENT_ID },
      })

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 1, startTime: '11:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'start_must_precede_end' })
    })

    it('returns 409 with byte-exact message when overlapping a DIFFERENT slot', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
        store: { clientId: CLIENT_ID },
      })
      // Sibling at 14:00-15:00; candidate 14:30-15:30 clashes.
      slotFindMany.mockResolvedValue([
        { id: 'slot-sibling', startTime: hhmmDate('14:00'), endTime: hhmmDate('15:00') },
      ])

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 1, startTime: '14:30', endTime: '15:30', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'schedule_overlap',
        message: 'Overlaps with 14:00–15:00',
      })
      expect(slotUpdate).not.toHaveBeenCalled()
    })

    it("returns 200 when the only 'overlap' is with itself (id: { not: id } filter works)", async () => {
      // The current row at 09:00-10:00 is being edited to 09:30-10:30. The
      // Prisma findMany excludes the row itself (id: { not: id }), so the
      // siblings list is empty — no clash, even though the OLD row's range
      // overlaps the NEW range.
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
        store: { clientId: CLIENT_ID },
      })
      slotFindMany.mockResolvedValue([]) // self-excluded by the where filter
      slotUpdate.mockResolvedValue(makeSlotRow({
        dayOfWeek: 1,
        startTime: hhmmDate('09:30'),
        endTime: hhmmDate('10:30'),
      }))

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        payload: { dayOfWeek: 1, startTime: '09:30', endTime: '10:30', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(slotUpdate).toHaveBeenCalledOnce()
    })
  })

  // ---------- DELETE /schedule-rows/:id ----------

  describe('DELETE /schedule-rows/:id', () => {
    it('returns 200 { ok: true } on happy path', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        store: { clientId: CLIENT_ID },
      })
      slotDelete.mockResolvedValue({ id: SLOT_ID })

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({ method: 'DELETE', url: `/schedule-rows/${SLOT_ID}` })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      expect(slotDelete).toHaveBeenCalledWith({ where: { id: SLOT_ID } })
    })

    it('returns 404 when the row does not exist', async () => {
      slotFindUnique.mockResolvedValue(null)

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({ method: 'DELETE', url: `/schedule-rows/${SLOT_ID}` })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
      expect(slotDelete).not.toHaveBeenCalled()
    })

    it('returns 404 when the row belongs to a different client', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: OTHER_STORE_ID,
        store: { clientId: 'client-other-002' },
      })

      const app = await buildTestApp(meRoutes)
      const res = await app.inject({ method: 'DELETE', url: `/schedule-rows/${SLOT_ID}` })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
      expect(slotDelete).not.toHaveBeenCalled()
    })
  })
})

// Regression: a free-tier customer's intake save must NOT mutate the shared
// FREE_TIER_ICP singleton. The bug was a missing `clientId` filter on the
// `existing` lookup — every free-tier Store is StoreICP-linked to the
// singleton, so the unguarded findFirst would match it and the subsequent
// update would clobber the singleton's fields globally across all free Stores.
//
// Both POST /icp (primary store) and POST /stores/:storeId/icp (per-store)
// share the same shape. The clientId guard means the singleton — whose
// clientId is FREE_TIER_CLIENT_ID, never a real customer id — is excluded
// from the upsert's "existing" branch, forcing a create of a fresh
// client-scoped ICP.
describe('me ICP intake — never mutates FREE_TIER_ICP singleton', () => {
  const icpFindFirst = prisma.iCP.findFirst as ReturnType<typeof vi.fn>
  const icpCreate = prisma.iCP.create as ReturnType<typeof vi.fn>
  const icpUpdate = prisma.iCP.update as ReturnType<typeof vi.fn>

  const INTAKE_BODY = {
    name: 'My Audience',
    ageRange: '30-50',
    fears: 'being upsold',
    values: 'small business',
    desires: 'to find something good',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    icpCreate.mockResolvedValue({
      id: 'new-icp-id',
      clientId: CLIENT_ID,
      name: INTAKE_BODY.name,
      ageRange: INTAKE_BODY.ageRange,
      location: null,
      politicalSpectrum: null,
      openness: null,
      fears: INTAKE_BODY.fears,
      values: INTAKE_BODY.values,
      desires: INTAKE_BODY.desires,
      unexpressedDesires: null,
      turnOffs: null,
      updatedAt: new Date(),
    })
  })

  it('POST /icp scopes the existing-lookup to the requesting clientId', async () => {
    // POST /icp uses findPrimaryStore → prisma.store.findMany.
    ;(prisma.store.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: STORE_ID, tier: 'free', compTier: null, compExpiresAt: null, createdAt: new Date() },
    ])
    icpFindFirst.mockResolvedValue(null)

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({ method: 'POST', url: '/icp', payload: INTAKE_BODY })

    expect(res.statusCode).toBe(200)
    // The where clause MUST include clientId; otherwise the singleton matches.
    expect(icpFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: CLIENT_ID }),
    }))
    // No existing → must create, never update.
    expect(icpCreate).toHaveBeenCalledTimes(1)
    expect(icpUpdate).not.toHaveBeenCalled()
  })

  it('POST /stores/:storeId/icp scopes the existing-lookup to the requesting clientId', async () => {
    storeFindFirst.mockResolvedValue({ id: STORE_ID })
    icpFindFirst.mockResolvedValue(null)

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({
      method: 'POST', url: `/stores/${STORE_ID}/icp`, payload: INTAKE_BODY,
    })

    expect(res.statusCode).toBe(200)
    expect(icpFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: CLIENT_ID }),
    }))
    expect(icpCreate).toHaveBeenCalledTimes(1)
    expect(icpUpdate).not.toHaveBeenCalled()
  })
})

// =========================================================================
// Free-tier allowlist guard on schedule slots + /me/outcomes annotation
// (HANDOFF-free-tier-outcome-leakage #2, customer-dashboard surface)
// =========================================================================

describe('me schedule-slot routes — free-tier allowlist guard', () => {
  const outcomeFindMany = prisma.outcome.findMany as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    isFreeAllowedMock.mockResolvedValue(true)
    freeAllowedIdsMock.mockResolvedValue(new Set<string>())
  })

  const freeStore = { id: STORE_ID, tier: 'free', compTier: null, compExpiresAt: null }

  it('POST rejects a non-allowlisted outcome on a free store with 409', async () => {
    storeFindFirst.mockResolvedValue(freeStore)
    isFreeAllowedMock.mockResolvedValue(false)

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/schedule`,
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('outcome_not_in_free_tier_allowlist')
    expect(slotCreate).not.toHaveBeenCalled()
  })

  it('POST accepts an allowlisted outcome on a free store', async () => {
    storeFindFirst.mockResolvedValue(freeStore)
    isFreeAllowedMock.mockResolvedValue(true)
    slotFindMany.mockResolvedValue([])
    slotCreate.mockResolvedValue(makeSlotRow())

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/schedule`,
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(isFreeAllowedMock).toHaveBeenCalledWith(OUTCOME_ID)
  })

  it('POST does not consult the allowlist for a paid store', async () => {
    storeFindFirst.mockResolvedValue({ id: STORE_ID, tier: 'pro', compTier: null, compExpiresAt: null })
    slotFindMany.mockResolvedValue([])
    slotCreate.mockResolvedValue(makeSlotRow())

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/schedule`,
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(isFreeAllowedMock).not.toHaveBeenCalled()
  })

  it('POST on a comped free store (effectiveTier=core) skips the guard', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    storeFindFirst.mockResolvedValue({ id: STORE_ID, tier: 'free', compTier: 'core', compExpiresAt: farFuture })
    slotFindMany.mockResolvedValue([])
    slotCreate.mockResolvedValue(makeSlotRow())

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/schedule`,
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
    })

    expect(res.statusCode).toBe(201)
    expect(isFreeAllowedMock).not.toHaveBeenCalled()
  })

  it('PUT rejects a non-allowlisted outcome on a free store with 409', async () => {
    slotFindUnique.mockResolvedValue({
      ...makeSlotRow(),
      store: { clientId: CLIENT_ID, tier: 'free', compTier: null, compExpiresAt: null },
    })
    isFreeAllowedMock.mockResolvedValue(false)

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({
      method: 'PUT',
      url: `/schedule-rows/${SLOT_ID}`,
      payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('outcome_not_in_free_tier_allowlist')
    expect(slotUpdate).not.toHaveBeenCalled()
  })

  it('GET /outcomes annotates rows with availableOnFree from the allowlist', async () => {
    outcomeFindMany.mockResolvedValue([
      { id: 'oc-allowed', title: 'Chill', displayTitle: null },
      { id: 'oc-locked', title: 'Value Lift', displayTitle: 'Trade Them Up' },
    ])
    freeAllowedIdsMock.mockResolvedValue(new Set(['oc-allowed']))

    const app = await buildTestApp(meRoutes)
    const res = await app.inject({ method: 'GET', url: '/outcomes' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      { id: 'oc-allowed', title: 'Chill', displayTitle: null, availableOnFree: true },
      { id: 'oc-locked', title: 'Value Lift', displayTitle: 'Trade Them Up', availableOnFree: false },
    ])
  })
})
