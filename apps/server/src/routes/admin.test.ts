// Integration tests for operator (Dash) admin routes.
//
// Scope so far: schedule-slot CRUD only (GET/POST /stores/:id/schedule,
// PUT/DELETE /schedule-rows/:id). These routes are the operator-side
// integration layer over apps/server/src/lib/scheduleSlots.ts. The /me
// surface has a parallel test file at me.test.ts; the two surfaces share
// helpers but diverge on (1) auth (admin = JWT-style Bearer + isAdmin
// check; me = cookie session), (2) the free-tier outcome guard (admin
// enforces it; me does not), and (3) the schedule_overlap message wording.
//
// Wrapped in a top-level `describe('schedule slots', ...)` so future
// admin-route test groups can sit alongside in their own describes
// (musicological-rules, style-exclusion-rules, lyric-prompts, etc.)
// without renaming this file.
//
// Mocking strategy:
//   - Prisma: vi.mock('../db.js') — `account`, `store`, `scheduleSlot`.
//   - Auth: vi.mock('../lib/auth.js') overrides `verify` to return a
//     known admin payload, and prisma.account.findUnique returns a
//     matching admin row (requireAdmin re-verifies the operator is
//     still active and tokenVersion matches the payload's `tv`).
//   - Free-tier guard: vi.mock('../lib/outcomes.js') stubs
//     `isFreeTierAllowedOutcome` directly. Default is to allow the
//     outcome (true); tests that want to hit the guard override to
//     false. This keeps the FreeTierOutcome / Outcome lookup pair out
//     of the Prisma mock surface (those models aren't otherwise used
//     by the schedule routes).
//
// The schedule_overlap message wording on the admin surface is the public
// contract: "Overlaps with existing slot HH:MM–HH:MM" (em-dash, with the
// "existing slot" prefix). Pinned byte-for-byte below. This differs from
// /me which omits "existing slot" — legacy admin clients depend on the
// exact string.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Prisma mock. Path is literal (relative to this test file), per
// TESTING.md "Mocking conventions". Only the models the schedule routes
// (and requireAdmin) touch.
vi.mock('../db.js', () => {
  // $transaction callback form: invoke with the same prisma mock so the
  // route's `tx.account.findUnique` etc. hit the same mocks as direct calls.
  // Tests override individual model fns per-case via mockResolvedValueOnce.
  const mock: any = {
    account: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    store: {
      findUnique: vi.fn(),
    },
    scheduleSlot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    clientMembership: {
      create: vi.fn(),
    },
    genreCraftRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    marsContaminationTerm: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    marsAxisRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    styleTemplate: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mock)),
  }
  return { prisma: mock }
})

// Bypass JWT signing by stubbing `verify` to return a known admin payload
// for the magic test token. requireAdmin still re-fetches the account row
// from Prisma and checks tokenVersion — that's covered by the account mock.
vi.mock('../lib/auth.js', () => ({
  verify: vi.fn((token: string) => {
    if (token === 'admin-test-token') {
      return {
        accountId: 'op-admin-001',
        email: 'admin@example.com',
        isAdmin: true,
        tv: 7,
        exp: Date.now() + 60_000,
      }
    }
    if (token === 'non-admin-test-token') {
      return {
        accountId: 'op-user-002',
        email: 'user@example.com',
        isAdmin: false,
        tv: 1,
        exp: Date.now() + 60_000,
      }
    }
    return null
  }),
}))

// Free-tier outcome allowlist: default to "allowed" so most tests don't
// have to touch it. Tests that exercise the guard override per-call.
vi.mock('../lib/outcomes.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/outcomes.js')>('../lib/outcomes.js')
  return {
    ...actual,
    isFreeTierAllowedOutcome: vi.fn(async () => true),
  }
})

import { adminRoutes } from './admin.js'
import { prisma } from '../db.js'
import { isFreeTierAllowedOutcome } from '../lib/outcomes.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const storeFindUnique = prisma.store.findUnique as ReturnType<typeof vi.fn>
const slotFindMany = prisma.scheduleSlot.findMany as ReturnType<typeof vi.fn>
const slotFindUnique = prisma.scheduleSlot.findUnique as ReturnType<typeof vi.fn>
const slotCreate = prisma.scheduleSlot.create as ReturnType<typeof vi.fn>
const slotUpdate = prisma.scheduleSlot.update as ReturnType<typeof vi.fn>
const slotDelete = prisma.scheduleSlot.delete as ReturnType<typeof vi.fn>
const freeTierAllowedMock = isFreeTierAllowedOutcome as ReturnType<typeof vi.fn>

const STORE_ID = 'store-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OUTCOME_ID = '11111111-1111-1111-1111-111111111111'
const SLOT_ID = 'slot-cccccccc-cccc-cccc-cccc-cccccccccccc'
const AUTH = { authorization: 'Bearer admin-test-token' }

// Mirrors hhmmToTime — Prisma @db.Time(6) round-trips as a Date with the
// UTC time portion set. Use this for fixture rows the handlers will
// format back to HH:MM via timeToHHMM.
function hhmmDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`)
}

interface SlotRowOverrides {
  id?: string
  storeId?: string
  dayOfWeek?: number
  startTime?: Date
  endTime?: Date
  outcomeId?: string
  outcome?: { id?: string; title: string; displayTitle: string | null; version: number }
}

function makeSlotRow(overrides: SlotRowOverrides = {}) {
  return {
    id: SLOT_ID,
    storeId: STORE_ID,
    dayOfWeek: 1,
    startTime: hhmmDate('09:00'),
    endTime: hhmmDate('10:00'),
    outcomeId: OUTCOME_ID,
    outcome: { id: OUTCOME_ID, title: 'Energize', displayTitle: 'Morning Energize', version: 3 },
    ...overrides,
  }
}

// requireAdmin re-fetches the operator row from Prisma. Default seed is
// an active admin matching the payload tokenVersion. Tests that want to
// exercise auth edge-cases override with .mockResolvedValueOnce.
function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001',
    email: 'admin@example.com',
    isAdmin: true,
    disabledAt: null,
    tokenVersion: 7,
  })
}

describe('admin routes — schedule slots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-prime defaults that vi.clearAllMocks wiped.
    freeTierAllowedMock.mockResolvedValue(true)
    seedAdminAccount()
  })

  // ---------- GET /stores/:id/schedule ----------

  describe('GET /stores/:id/schedule', () => {
    it('returns 200 with formatted rows (outcomeVersion included — operator surface contract)', async () => {
      slotFindMany.mockResolvedValue([
        makeSlotRow({ dayOfWeek: 1, startTime: hhmmDate('09:00'), endTime: hhmmDate('10:00') }),
        makeSlotRow({
          id: 'slot-other',
          dayOfWeek: 3,
          startTime: hhmmDate('13:00'),
          endTime: hhmmDate('14:30'),
          outcome: { id: OUTCOME_ID, title: 'Focus', displayTitle: 'Afternoon Focus', version: 5 },
        }),
      ])

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
      })

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
        outcomeVersion: 3,
      })
      expect(body[1].outcomeVersion).toBe(5)
      // Query shape: storeId scope, ordered for the weekly grid.
      expect(slotFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: STORE_ID },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        }),
      )
    })

    it('returns 401 when no Authorization header is sent', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({ method: 'GET', url: `/stores/${STORE_ID}/schedule` })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
      expect(slotFindMany).not.toHaveBeenCalled()
    })

    it('returns 403 when the token is valid but the operator is not admin', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/stores/${STORE_ID}/schedule`,
        headers: { authorization: 'Bearer non-admin-test-token' },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: 'admin_required' })
    })
  })

  // ---------- POST /stores/:id/schedule ----------

  describe('POST /stores/:id/schedule', () => {
    it('returns 200 with the created slot on happy path (correct Prisma write)', async () => {
      storeFindUnique.mockResolvedValue({ tier: 'pro' })
      slotFindMany.mockResolvedValue([]) // no existing slots to clash with
      slotCreate.mockResolvedValue(
        makeSlotRow({ dayOfWeek: 2, startTime: hhmmDate('12:00'), endTime: hhmmDate('13:00') }),
      )

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 2, startTime: '12:00', endTime: '13:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 2,
        startTime: '12:00',
        endTime: '13:00',
        outcomeId: OUTCOME_ID,
        outcomeTitle: 'Energize',
        outcomeDisplayTitle: 'Morning Energize',
        outcomeVersion: 3,
      })

      // Pin the Prisma create shape — HH:MM strings come in, Date with UTC
      // time portion goes out. A drift here silently shifts hours on the
      // @db.Time(6) column.
      expect(slotCreate).toHaveBeenCalledWith({
        data: {
          storeId: STORE_ID,
          dayOfWeek: 2,
          startTime: hhmmDate('12:00'),
          endTime: hhmmDate('13:00'),
          outcomeId: OUTCOME_ID,
        },
        include: { outcome: { select: { title: true, displayTitle: true, version: true } } },
      })
    })

    it('returns 404 when the store does not exist (P2003 FK violation on create)', async () => {
      storeFindUnique.mockResolvedValue(null) // store gone — free-tier guard skips (target?.tier === 'free' is false)
      slotFindMany.mockResolvedValue([])
      // The route doesn't pre-check store existence; it relies on the FK to
      // surface 404. The handler instanceof-checks
      // Prisma.PrismaClientKnownRequestError, so we throw a real one.
      const { Prisma } = await import('@prisma/client')
      const prismaErr = new Prisma.PrismaClientKnownRequestError('FK fail', {
        code: 'P2003',
        clientVersion: 'test',
      })
      slotCreate.mockRejectedValue(prismaErr)

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_or_outcome_not_found' })
    })

    it('returns 400 on bad body (zod — missing outcomeId)', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('bad_body')
      expect(slotCreate).not.toHaveBeenCalled()
    })

    it('returns 400 on bad body (zod — malformed time string)', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '9am', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('bad_body')
    })

    it('returns 400 when startTime >= endTime (start_must_precede_end)', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '10:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'start_must_precede_end' })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    // The schedule_overlap message wording is the PUBLIC CONTRACT. Admin uses
    // "Overlaps with existing slot HH:MM–HH:MM" (em-dash, with "existing
    // slot" prefix). Byte-exact. /me sibling omits the prefix.
    it('returns 409 with byte-exact schedule_overlap message on overlap', async () => {
      storeFindUnique.mockResolvedValue({ tier: 'pro' })
      slotFindMany.mockResolvedValue([
        // Existing 12:00–13:00; the candidate 12:30–13:30 clashes.
        { id: 'slot-existing', startTime: hhmmDate('12:00'), endTime: hhmmDate('13:00') },
      ])

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '12:30', endTime: '13:30', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'schedule_overlap',
        message: 'Overlaps with existing slot 12:00–13:00',
      })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    // Free-tier guard: only the admin surface enforces it. Returns 409
    // with outcome_not_in_free_tier_allowlist.
    it('returns 409 when the store is free-tier and the outcome is not allowlisted', async () => {
      storeFindUnique.mockResolvedValue({ tier: 'free' })
      freeTierAllowedMock.mockResolvedValueOnce(false)

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
      expect(slotCreate).not.toHaveBeenCalled()
    })

    it('does NOT apply free-tier guard when the store is paid (pro)', async () => {
      // Same outcome that would be blocked on free should pass through on pro
      // because the guard's allowlist check is gated by `target?.tier === 'free'`.
      storeFindUnique.mockResolvedValue({ tier: 'pro' })
      freeTierAllowedMock.mockResolvedValue(false) // would block if checked
      slotFindMany.mockResolvedValue([])
      slotCreate.mockResolvedValue(makeSlotRow())

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: `/stores/${STORE_ID}/schedule`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(slotCreate).toHaveBeenCalled()
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
      })
      storeFindUnique.mockResolvedValue({ tier: 'pro' })
      slotFindMany.mockResolvedValue([]) // no siblings
      slotUpdate.mockResolvedValue(
        makeSlotRow({ dayOfWeek: 1, startTime: hhmmDate('11:00'), endTime: hhmmDate('12:00') }),
      )

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
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
        outcomeVersion: 3,
      })
      // Self-exclusion filter: siblings query must use id: { not: id }.
      expect(slotFindMany).toHaveBeenCalledWith({
        where: { storeId: STORE_ID, dayOfWeek: 1, id: { not: SLOT_ID } },
      })
    })

    it('returns 404 when the row does not exist', async () => {
      slotFindUnique.mockResolvedValue(null)

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
      expect(slotUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 on bad body', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
        payload: { dayOfWeek: 99, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('bad_body')
      expect(slotFindUnique).not.toHaveBeenCalled()
    })

    it('returns 400 when startTime >= endTime', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '11:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'start_must_precede_end' })
      expect(slotFindUnique).not.toHaveBeenCalled()
    })

    it('returns 409 with byte-exact message when overlapping a DIFFERENT slot', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
      })
      storeFindUnique.mockResolvedValue({ tier: 'pro' })
      // Sibling at 14:00-15:00; candidate 14:30-15:30 clashes.
      slotFindMany.mockResolvedValue([
        { id: 'slot-sibling', startTime: hhmmDate('14:00'), endTime: hhmmDate('15:00') },
      ])

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '14:30', endTime: '15:30', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'schedule_overlap',
        message: 'Overlaps with existing slot 14:00–15:00',
      })
      expect(slotUpdate).not.toHaveBeenCalled()
    })

    it('returns 409 free-tier guard on update (same rule as create)', async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
      })
      storeFindUnique.mockResolvedValue({ tier: 'free' })
      freeTierAllowedMock.mockResolvedValueOnce(false)

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:00', endTime: '10:00', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
      expect(slotUpdate).not.toHaveBeenCalled()
    })

    // Pins the self-exclusion filter (id: { not: id }) — without it, editing
    // a row to a range overlapping its OWN current range would falsely
    // return 409. This test would fail before the filter was added.
    it("returns 200 when the only 'overlap' is with the row's own current range (self-excluded)", async () => {
      slotFindUnique.mockResolvedValue({
        id: SLOT_ID,
        storeId: STORE_ID,
        dayOfWeek: 1,
        startTime: hhmmDate('09:00'),
        endTime: hhmmDate('10:00'),
        outcomeId: OUTCOME_ID,
      })
      storeFindUnique.mockResolvedValue({ tier: 'pro' })
      slotFindMany.mockResolvedValue([]) // self-excluded by the where filter
      slotUpdate.mockResolvedValue(
        makeSlotRow({ dayOfWeek: 1, startTime: hhmmDate('09:30'), endTime: hhmmDate('10:30') }),
      )

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'PUT',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
        payload: { dayOfWeek: 1, startTime: '09:30', endTime: '10:30', outcomeId: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(slotUpdate).toHaveBeenCalled()
    })
  })

  // ---------- DELETE /schedule-rows/:id ----------

  describe('DELETE /schedule-rows/:id', () => {
    it('returns 200 { ok: true } on happy path and calls prisma.scheduleSlot.delete', async () => {
      slotDelete.mockResolvedValue({ id: SLOT_ID })

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'DELETE',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      expect(slotDelete).toHaveBeenCalledWith({ where: { id: SLOT_ID } })
    })

    it('returns 404 when the row does not exist', async () => {
      slotDelete.mockRejectedValue(new Error('not found'))

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'DELETE',
        url: `/schedule-rows/${SLOT_ID}`,
        headers: AUTH,
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'not_found' })
    })

    it('returns 401 when no Authorization header is sent', async () => {
      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({ method: 'DELETE', url: `/schedule-rows/${SLOT_ID}` })

      expect(res.statusCode).toBe(401)
      expect(slotDelete).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────
// POST /admin/clients/:id/owner — attach an Account as Client owner.
// Closes the "operator-managed Client" gap (Client with zero memberships).
// ─────────────────────────────────────────────────────────────────────────

const clientFindUnique = prisma.client.findUnique as ReturnType<typeof vi.fn>
const membershipCreate = prisma.clientMembership.create as ReturnType<typeof vi.fn>
const accountCreate = prisma.account.create as ReturnType<typeof vi.fn>

const CLIENT_ID = 'client-dddddddd-dddd-dddd-dddd-dddddddddddd'
const ACCOUNT_ID = 'acct-eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
const OTHER_CLIENT_ID = 'client-ffffffff-ffff-ffff-ffff-ffffffffffff'

describe('admin routes — attach owner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedAdminAccount()
  })

  it('creates a new Account + ClientMembership when neither exists', async () => {
    // findUnique is called twice: first by requireAdmin (admin row), then by
    // the route to look up the target email (returns null → triggers create).
    // Override both with explicit Once mocks; the default seedAdminAccount
    // value would be consumed by requireAdmin and leave the route call also
    // hitting the admin row, which doesn't match the email lookup shape.
    accountFindUnique.mockReset()
    accountFindUnique.mockResolvedValueOnce({
      id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
    }) // requireAdmin
    accountFindUnique.mockResolvedValueOnce(null) // route lookup by email
    accountCreate.mockResolvedValue({
      id: ACCOUNT_ID,
      email: 'daniel+untuckit@entuned.co',
      name: null,
      isAdmin: false,
      disabledAt: null,
    })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, companyName: 'Untuckit' })
    membershipCreate.mockResolvedValue({ id: 'mem-1', role: 'owner', createdAt: new Date('2026-05-18T00:00:00Z') })

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'Daniel+Untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.created).toBe(true)
    expect(body.accountCreated).toBe(true)
    expect(body.role).toBe('owner')
    expect(body.client).toEqual({ id: CLIENT_ID, companyName: 'Untuckit' })
    expect(body.account.email).toBe('daniel+untuckit@entuned.co')

    // Email was normalized before Account.create
    expect(accountCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { email: 'daniel+untuckit@entuned.co' },
    }))
    expect(membershipCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { clientId: CLIENT_ID, accountId: ACCOUNT_ID, role: 'owner' },
    }))
  })

  it('attaches an existing Account that has no memberships', async () => {
    // Second findUnique call = the Account-by-email lookup. seedAdminAccount
    // already set up .mockResolvedValue, so we use mockResolvedValueOnce to
    // make the FIRST call return the admin and SECOND return the target.
    // Simpler approach: chain the queue using mockResolvedValueOnce twice.
    accountFindUnique.mockReset()
    accountFindUnique.mockResolvedValueOnce({
      id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
    }) // requireAdmin
    accountFindUnique.mockResolvedValueOnce({
      id: ACCOUNT_ID,
      email: 'daniel+untuckit@entuned.co',
      name: null,
      isAdmin: false,
      disabledAt: null,
      memberships: [],
    })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, companyName: 'Untuckit' })
    membershipCreate.mockResolvedValue({ id: 'mem-1', role: 'owner', createdAt: new Date() })

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().created).toBe(true)
    expect(res.json().accountCreated).toBe(false)
    expect(accountCreate).not.toHaveBeenCalled()
    expect(membershipCreate).toHaveBeenCalledOnce()
  })

  it('is idempotent when the membership already exists', async () => {
    accountFindUnique.mockReset()
    accountFindUnique.mockResolvedValueOnce({
      id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
    })
    accountFindUnique.mockResolvedValueOnce({
      id: ACCOUNT_ID,
      email: 'daniel+untuckit@entuned.co',
      name: null,
      isAdmin: false,
      disabledAt: null,
      memberships: [{ clientId: CLIENT_ID, role: 'owner' }],
    })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, companyName: 'Untuckit' })

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().created).toBe(false)
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  it('refuses (409) when the Account is already attached to a different Client', async () => {
    accountFindUnique.mockReset()
    accountFindUnique.mockResolvedValueOnce({
      id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
    })
    accountFindUnique.mockResolvedValueOnce({
      id: ACCOUNT_ID,
      email: 'daniel+untuckit@entuned.co',
      name: null,
      isAdmin: false,
      disabledAt: null,
      memberships: [{ clientId: OTHER_CLIENT_ID, role: 'owner' }],
    })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, companyName: 'Untuckit' })

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({
      error: 'account_already_attached',
      otherClientId: OTHER_CLIENT_ID,
      message: 'Account is already a member of a different Client. Clear that membership first.',
    })
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  it('refuses (409) when the Account is disabled', async () => {
    accountFindUnique.mockReset()
    accountFindUnique.mockResolvedValueOnce({
      id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
    })
    accountFindUnique.mockResolvedValueOnce({
      id: ACCOUNT_ID,
      email: 'daniel+untuckit@entuned.co',
      name: null,
      isAdmin: false,
      disabledAt: new Date('2026-01-01T00:00:00Z'),
      memberships: [],
    })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, companyName: 'Untuckit' })

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'account_disabled' })
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  it('returns 404 when the Client does not exist', async () => {
    clientFindUnique.mockResolvedValue(null)

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'client_not_found' })
    expect(membershipCreate).not.toHaveBeenCalled()
  })

  it('returns 400 on bad body (zod — invalid email)', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: AUTH,
      payload: { email: 'not-an-email' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(clientFindUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is sent', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(401)
    expect(clientFindUnique).not.toHaveBeenCalled()
  })

  it('returns 403 when the token is valid but the operator is not admin', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/clients/${CLIENT_ID}/owner`,
      headers: { authorization: 'Bearer non-admin-test-token' },
      payload: { email: 'daniel+untuckit@entuned.co' },
    })

    expect(res.statusCode).toBe(403)
    expect(clientFindUnique).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// GenreCraftRule CRUD — DB-backed lyric craft overlays editable in Dash.
// Mirrors LyricBanEntry shape (list / create / update / delete with admin auth).
// ════════════════════════════════════════════════════════════════════════════

const genreFindMany = prisma.genreCraftRule.findMany as ReturnType<typeof vi.fn>
const genreCreate = prisma.genreCraftRule.create as ReturnType<typeof vi.fn>
const genreUpdate = prisma.genreCraftRule.update as ReturnType<typeof vi.fn>
const genreDelete = prisma.genreCraftRule.delete as ReturnType<typeof vi.fn>

const GENRE_RULE_ID = 'gcr-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeGenreRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: GENRE_RULE_ID,
    familyName: 'hip-hop',
    tags: ['hip-hop', 'rap'],
    densityGuidance: 'Dense bars.',
    rhymeGuidance: 'Multisyllabic rhymes.',
    lineStructureGuidance: '8 or 16 bars.',
    voiceGuidance: 'Declarative.',
    typographyGuidance: 'Sparse parens.',
    sortOrder: 0,
    isActive: true,
    notes: null,
    createdAt: new Date('2026-05-25T12:00:00Z'),
    updatedAt: new Date('2026-05-25T12:00:00Z'),
    updatedById: null,
    ...overrides,
  }
}

function genreRulePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    familyName: 'hip-hop',
    tags: ['hip-hop', 'rap'],
    densityGuidance: 'Dense bars.',
    rhymeGuidance: 'Multisyllabic rhymes.',
    lineStructureGuidance: '8 or 16 bars.',
    voiceGuidance: 'Declarative.',
    typographyGuidance: 'Sparse parens.',
    sortOrder: 0,
    isActive: true,
    notes: null,
    ...overrides,
  }
}

describe('admin routes — genre craft rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    freeTierAllowedMock.mockResolvedValue(true)
    seedAdminAccount()
  })

  it('GET /genre-craft-rules returns all rules ordered by sortOrder then familyName', async () => {
    genreFindMany.mockResolvedValue([makeGenreRule(), makeGenreRule({ id: 'gcr-2', familyName: 'country', sortOrder: 1 })])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/genre-craft-rules', headers: AUTH })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    expect(genreFindMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { familyName: 'asc' }],
    })
  })

  it('POST /genre-craft-rules creates a rule and stamps updatedById from the operator', async () => {
    genreCreate.mockResolvedValue(makeGenreRule())
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/genre-craft-rules', headers: AUTH, payload: genreRulePayload(),
    })

    expect(res.statusCode).toBe(200)
    expect(genreCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyName: 'hip-hop',
        updatedById: 'op-admin-001',
      }),
    })
  })

  it('POST /genre-craft-rules returns 400 on missing required fields', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/genre-craft-rules', headers: AUTH,
      payload: { familyName: '', densityGuidance: 'x' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(genreCreate).not.toHaveBeenCalled()
  })

  it('POST /genre-craft-rules returns 409 on duplicate familyName', async () => {
    genreCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/genre-craft-rules', headers: AUTH, payload: genreRulePayload(),
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('duplicate')
  })

  it('PUT /genre-craft-rules/:id updates the rule', async () => {
    genreUpdate.mockResolvedValue(makeGenreRule({ familyName: 'country' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PUT', url: `/genre-craft-rules/${GENRE_RULE_ID}`,
      headers: AUTH, payload: genreRulePayload({ familyName: 'country' }),
    })

    expect(res.statusCode).toBe(200)
    expect(genreUpdate).toHaveBeenCalledWith({
      where: { id: GENRE_RULE_ID },
      data: expect.objectContaining({ familyName: 'country', updatedById: 'op-admin-001' }),
    })
  })

  it('PUT /genre-craft-rules/:id returns 404 when the row is missing', async () => {
    genreUpdate.mockRejectedValue(Object.assign(new Error('Record not found'), { code: 'P2025' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PUT', url: `/genre-craft-rules/${GENRE_RULE_ID}`,
      headers: AUTH, payload: genreRulePayload(),
    })

    expect(res.statusCode).toBe(404)
  })

  it('DELETE /genre-craft-rules/:id removes the row', async () => {
    genreDelete.mockResolvedValue(makeGenreRule())
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'DELETE', url: `/genre-craft-rules/${GENRE_RULE_ID}`, headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(genreDelete).toHaveBeenCalledWith({ where: { id: GENRE_RULE_ID } })
  })

  it('returns 401 without a Bearer token', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/genre-craft-rules' })
    expect(res.statusCode).toBe(401)
    expect(genreFindMany).not.toHaveBeenCalled()
  })

  it('returns 403 when the operator is not admin', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET', url: '/genre-craft-rules',
      headers: { authorization: 'Bearer non-admin-test-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(genreFindMany).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// MarsContaminationTerm CRUD — flat term lists (always_fire / modern_drift /
// modern_family) editable in Dash → Mars Style Axes.
// ════════════════════════════════════════════════════════════════════════════

const contamFindMany = prisma.marsContaminationTerm.findMany as ReturnType<typeof vi.fn>
const contamCreate = prisma.marsContaminationTerm.create as ReturnType<typeof vi.fn>
const contamUpdate = prisma.marsContaminationTerm.update as ReturnType<typeof vi.fn>
const contamDelete = prisma.marsContaminationTerm.delete as ReturnType<typeof vi.fn>

const CONTAM_ID = 'mct-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function makeContamRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTAM_ID,
    category: 'always_fire',
    term: 'live',
    sortOrder: 0,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('admin routes — mars contamination terms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    freeTierAllowedMock.mockResolvedValue(true)
    seedAdminAccount()
  })

  it('GET /mars-contamination-terms returns rows ordered by category then sortOrder then term', async () => {
    contamFindMany.mockResolvedValue([makeContamRow(), makeContamRow({ id: 'mct-2', category: 'modern_drift', term: 'autotune' })])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/mars-contamination-terms', headers: AUTH })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    expect(contamFindMany).toHaveBeenCalledWith({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { term: 'asc' }],
    })
  })

  it('POST /mars-contamination-terms creates a row with valid category enum', async () => {
    contamCreate.mockResolvedValue(makeContamRow())
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/mars-contamination-terms', headers: AUTH,
      payload: { category: 'always_fire', term: 'live', sortOrder: 0, isActive: true, notes: null },
    })

    expect(res.statusCode).toBe(200)
    expect(contamCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ category: 'always_fire', term: 'live' }),
    })
  })

  it('POST /mars-contamination-terms returns 400 on invalid category', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/mars-contamination-terms', headers: AUTH,
      payload: { category: 'bogus', term: 'live' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(contamCreate).not.toHaveBeenCalled()
  })

  it('POST /mars-contamination-terms returns 409 on duplicate category+term', async () => {
    contamCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/mars-contamination-terms', headers: AUTH,
      payload: { category: 'always_fire', term: 'live' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('duplicate')
  })

  it('PUT /mars-contamination-terms/:id updates the row', async () => {
    contamUpdate.mockResolvedValue(makeContamRow({ term: 'arena' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PUT', url: `/mars-contamination-terms/${CONTAM_ID}`,
      headers: AUTH, payload: { category: 'always_fire', term: 'arena' },
    })

    expect(res.statusCode).toBe(200)
    expect(contamUpdate).toHaveBeenCalledWith({
      where: { id: CONTAM_ID },
      data: expect.objectContaining({ term: 'arena' }),
    })
  })

  it('DELETE /mars-contamination-terms/:id removes the row', async () => {
    contamDelete.mockResolvedValue(makeContamRow())
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'DELETE', url: `/mars-contamination-terms/${CONTAM_ID}`, headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('returns 401 without auth', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/mars-contamination-terms' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when not admin', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET', url: '/mars-contamination-terms',
      headers: { authorization: 'Bearer non-admin-test-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// MarsAxisRule CRUD — per-axis opposite-style rules editable in Dash.
// ════════════════════════════════════════════════════════════════════════════

const axisFindMany = prisma.marsAxisRule.findMany as ReturnType<typeof vi.fn>
const axisCreate = prisma.marsAxisRule.create as ReturnType<typeof vi.fn>
const axisUpdate = prisma.marsAxisRule.update as ReturnType<typeof vi.fn>
const axisDelete = prisma.marsAxisRule.delete as ReturnType<typeof vi.fn>

const AXIS_ID = 'mar-cccccccc-cccc-cccc-cccc-cccccccccccc'

function makeAxisRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: AXIS_ID,
    axisType: 'genre',
    label: 'rock-metal',
    matchTerms: ['rock', 'metal'],
    opposites: ['orchestral', 'ambient'],
    secondaryOpposites: ['ukulele', 'harp'],
    sortOrder: 0,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('admin routes — mars axis rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    freeTierAllowedMock.mockResolvedValue(true)
    seedAdminAccount()
  })

  it('GET /mars-axis-rules returns rows ordered by axisType then sortOrder then label', async () => {
    axisFindMany.mockResolvedValue([makeAxisRow(), makeAxisRow({ id: 'mar-2', axisType: 'vocal', label: 'breathy' })])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/mars-axis-rules', headers: AUTH })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    expect(axisFindMany).toHaveBeenCalledWith({
      orderBy: [{ axisType: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    })
  })

  it('POST /mars-axis-rules accepts a genre rule with secondaryOpposites', async () => {
    axisCreate.mockResolvedValue(makeAxisRow())
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/mars-axis-rules', headers: AUTH,
      payload: {
        axisType: 'genre', label: 'rock-metal',
        matchTerms: ['rock', 'metal'], opposites: ['orchestral'], secondaryOpposites: ['ukulele'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(axisCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        axisType: 'genre', label: 'rock-metal',
        secondaryOpposites: ['ukulele'],
      }),
    })
  })

  it('POST /mars-axis-rules returns 400 on invalid axisType', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/mars-axis-rules', headers: AUTH,
      payload: { axisType: 'instrumentation', label: 'foo' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(axisCreate).not.toHaveBeenCalled()
  })

  it('POST /mars-axis-rules returns 409 on duplicate axisType+label', async () => {
    axisCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/mars-axis-rules', headers: AUTH,
      payload: { axisType: 'genre', label: 'rock-metal' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('duplicate')
  })

  it('PUT /mars-axis-rules/:id updates the rule', async () => {
    axisUpdate.mockResolvedValue(makeAxisRow({ label: 'punk' }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PUT', url: `/mars-axis-rules/${AXIS_ID}`, headers: AUTH,
      payload: { axisType: 'genre', label: 'punk' },
    })

    expect(res.statusCode).toBe(200)
    expect(axisUpdate).toHaveBeenCalledWith({
      where: { id: AXIS_ID },
      data: expect.objectContaining({ label: 'punk' }),
    })
  })

  it('DELETE /mars-axis-rules/:id removes the row', async () => {
    axisDelete.mockResolvedValue(makeAxisRow())
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'DELETE', url: `/mars-axis-rules/${AXIS_ID}`, headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('returns 401 without auth', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/mars-axis-rules' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when not admin', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET', url: '/mars-axis-rules',
      headers: { authorization: 'Bearer non-admin-test-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// StyleTemplate — structured config for Mars legacy style assembly.
// Operator picks decomposition fields + char cap; route auto-generates the
// human-readable templateText summary. Append-only versioned (no PUT/DELETE).
// ════════════════════════════════════════════════════════════════════════════

const styleTemplateFindMany = prisma.styleTemplate.findMany as ReturnType<typeof vi.fn>
const styleTemplateAggregate = prisma.styleTemplate.aggregate as ReturnType<typeof vi.fn>
const styleTemplateCreate = prisma.styleTemplate.create as ReturnType<typeof vi.fn>

function makeStyleTemplateRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'st-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    version: 1,
    fields: ['vibePitch', 'eraProductionSignature'],
    charCap: 950,
    templateText: 'fields: [vibePitch, eraProductionSignature] · cap: 950',
    notes: null,
    createdAt: new Date('2026-05-25T12:00:00Z'),
    createdById: null,
    ...overrides,
  }
}

describe('admin routes — style template', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    freeTierAllowedMock.mockResolvedValue(true)
    seedAdminAccount()
  })

  it('GET /style-template returns latest + history + the available-fields catalog', async () => {
    styleTemplateFindMany.mockResolvedValue([makeStyleTemplateRow({ version: 2 }), makeStyleTemplateRow({ id: 'st-2', version: 1 })])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/style-template', headers: AUTH })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.latest.version).toBe(2)
    expect(body.history).toHaveLength(2)
    expect(body.availableFields).toContain('vibePitch')
    expect(body.availableFields).toContain('harmonicAndGroove')
  })

  it('POST /style-template creates a new version, auto-incrementing + summarizing templateText', async () => {
    styleTemplateAggregate.mockResolvedValue({ _max: { version: 3 } })
    styleTemplateCreate.mockResolvedValue(makeStyleTemplateRow({ version: 4 }))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/style-template', headers: AUTH,
      payload: {
        fields: ['vibePitch', 'eraProductionSignature', 'instrumentationPalette'],
        charCap: 800,
        notes: 'Dropping standout to save chars',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(styleTemplateCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 4,
        fields: ['vibePitch', 'eraProductionSignature', 'instrumentationPalette'],
        charCap: 800,
        templateText: 'fields: [vibePitch, eraProductionSignature, instrumentationPalette] · cap: 800',
        notes: 'Dropping standout to save chars',
        createdById: 'op-admin-001',
      }),
    })
  })

  it('POST /style-template returns 400 on empty fields array', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/style-template', headers: AUTH,
      payload: { fields: [], charCap: 800 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(styleTemplateCreate).not.toHaveBeenCalled()
  })

  it('POST /style-template returns 400 with unknown_fields when payload includes an unknown field key', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/style-template', headers: AUTH,
      payload: { fields: ['vibePitch', 'imaginaryField'], charCap: 800 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('unknown_fields')
    expect(res.json().unknown).toEqual(['imaginaryField'])
    expect(styleTemplateCreate).not.toHaveBeenCalled()
  })

  it('POST /style-template returns 400 on charCap out of allowed range', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST', url: '/style-template', headers: AUTH,
      payload: { fields: ['vibePitch'], charCap: 50 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(styleTemplateCreate).not.toHaveBeenCalled()
  })

  it('returns 401 without auth', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/style-template' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when not admin', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET', url: '/style-template',
      headers: { authorization: 'Bearer non-admin-test-token' },
    })
    expect(res.statusCode).toBe(403)
  })
})
