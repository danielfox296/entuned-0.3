// Integration tests for the reference-track approval surface's auto-decompose.
//
// Routes covered:
//   POST /admin/reference-tracks/:id/approve                    — single approve
//   POST /admin/icps/:id/reference-tracks/approve-all-pending   — bulk approve
//
// Regression guard for SRV-2 (2026-07-11 audit): both endpoints used to fire
// decompose() fire-and-forget (`.then().catch(console.error)`) and return 200
// before any decompose resolved — so a decompose failure was silently
// swallowed and the operator saw a success with zero failure signal, and the
// bulk path fired N simultaneous Claude+web_search calls straight into 429s.
//
// The fix makes both paths decompose SEQUENTIALLY + AWAITED, surfacing
// per-track errors in the response, mirroring `decompose-all`. These tests
// prove (1) a decompose failure surfaces in the response instead of being
// swallowed, and (2) every target is processed (not left behind).
//
// Lives in its own file so the prisma mock surface stays scoped to the models
// these routes touch. Mirrors the auth + buildTestApp conventions in
// admin-song-repair.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: any = {
    account: { findUnique: vi.fn() },
    referenceTrack: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    styleAnalysis: { upsert: vi.fn() },
    iCP: { findUnique: vi.fn() },
    // Required for adminRoutes to register — handlers we don't exercise here
    // still get attached, so referenced models must exist on the mock.
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    scheduleSlot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    client: { findUnique: vi.fn() },
    clientMembership: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mock)),
  }
  return { prisma: mock }
})

// The shared admin guard (adminPreHandler → requireAdmin) lives in lib/auth.js.
// Re-implement it here against the mocked verify + mocked prisma so the
// adminRoutes plugin's preHandler runs the real auth contract.
vi.mock('../lib/auth.js', () => {
  const verify = vi.fn((token: string) => {
    if (token === 'admin-test-token') {
      return { accountId: 'op-admin-001', email: 'admin@example.com', isAdmin: true, tv: 7, exp: Date.now() + 60_000 }
    }
    return null
  })
  async function requireAdmin(req: any, reply: any) {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) { reply.code(401).send({ error: 'unauthorized' }); return null }
    const payload = verify(auth.slice(7))
    if (!payload) { reply.code(401).send({ error: 'invalid_token' }); return null }
    if (!payload.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
    const { prisma } = await import('../db.js')
    const op = await (prisma as any).account.findUnique({ where: { id: payload.accountId } })
    if (!op || op.disabledAt || !op.isAdmin) { reply.code(403).send({ error: 'admin_required' }); return null }
    if (op.tokenVersion !== payload.tv) { reply.code(401).send({ error: 'token_revoked' }); return null }
    return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
  }
  return {
    verify,
    requireAdmin,
    adminPreHandler: async (req: any, reply: any) => {
      const op = await requireAdmin(req, reply)
      if (!op) return reply
      req.operator = op
    },
    ensureOperatorDecorator: (app: any) => {
      if (!app.hasRequestDecorator('operator')) app.decorateRequest('operator', null)
    },
  }
})

vi.mock('../lib/outcomes.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/outcomes.js')>('../lib/outcomes.js')
  return { ...actual, isFreeTierAllowedOutcome: vi.fn(async () => true) }
})

// Mock the decomposer so we control decompose() success/failure and the
// StyleAnalysis payload without invoking Claude or web_search.
vi.mock('../lib/decomposer/decomposer.js', () => ({
  decompose: vi.fn(),
  toStyleAnalysisData: vi.fn((r: any) => r),
}))

import { adminRoutes } from './admin.js'
import { prisma } from '../db.js'
import { decompose } from '../lib/decomposer/decomposer.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const refUpdate = prisma.referenceTrack.update as ReturnType<typeof vi.fn>
const refUpdateMany = prisma.referenceTrack.updateMany as ReturnType<typeof vi.fn>
const refFindMany = prisma.referenceTrack.findMany as ReturnType<typeof vi.fn>
const saUpsert = prisma.styleAnalysis.upsert as ReturnType<typeof vi.fn>
const icpFindUnique = prisma.iCP.findUnique as ReturnType<typeof vi.fn>
const decomposeMock = decompose as ReturnType<typeof vi.fn>

const AUTH = { authorization: 'Bearer admin-test-token' }

function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
  })
}

function makeRef(over: Record<string, unknown> = {}) {
  return {
    id: 'ref-1', artist: 'The Band', title: 'A Song', year: 1975,
    operatorNotes: null, status: 'approved',
    approvedAt: new Date('2026-07-11T00:00:00Z'), approvedById: 'op-admin-001',
    ...over,
  }
}

describe('admin routes — reference-track approve auto-decompose', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seedAdminAccount()
  })

  describe('POST /reference-tracks/:id/approve', () => {
    it('awaits the decompose and upserts the StyleAnalysis before returning', async () => {
      refUpdate.mockResolvedValue(makeRef())
      decomposeMock.mockResolvedValue({ vibePitch: 'warm' })
      saUpsert.mockResolvedValue({ referenceTrackId: 'ref-1' })

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({ method: 'POST', url: '/reference-tracks/ref-1/approve', headers: AUTH })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.id).toBe('ref-1')
      expect(body.decomposeError).toBeNull()
      // The decompose + upsert must have run *before* the response (awaited),
      // not fire-and-forget after the fact.
      expect(decomposeMock).toHaveBeenCalledOnce()
      expect(saUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { referenceTrackId: 'ref-1' } }),
      )
    })

    it('surfaces a decompose failure in the response instead of swallowing it', async () => {
      refUpdate.mockResolvedValue(makeRef())
      decomposeMock.mockRejectedValue(new Error('anthropic 429'))

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({ method: 'POST', url: '/reference-tracks/ref-1/approve', headers: AUTH })

      // Approval still succeeds (the row was flipped), but the failure is
      // reported — the pre-fix code returned 200 with no failure signal.
      expect(res.statusCode).toBe(200)
      expect(res.json().decomposeError).toBe('anthropic 429')
      expect(saUpsert).not.toHaveBeenCalled()
    })
  })

  describe('POST /icps/:id/reference-tracks/approve-all-pending', () => {
    it('processes every target and reports per-track decompose failures', async () => {
      icpFindUnique.mockResolvedValue({ id: 'icp-1' })
      refFindMany.mockResolvedValue([
        { id: 'ref-1', artist: 'A', title: 'One', year: null, operatorNotes: null },
        { id: 'ref-2', artist: 'B', title: 'Two', year: null, operatorNotes: null },
        { id: 'ref-3', artist: 'C', title: 'Three', year: null, operatorNotes: null },
      ])
      refUpdateMany.mockResolvedValue({ count: 3 })
      // Middle track fails; the other two succeed. A fire-and-forget loop
      // would return before any of these resolved and lose the failure.
      decomposeMock
        .mockResolvedValueOnce({ vibePitch: 'x' })
        .mockRejectedValueOnce(new Error('anthropic 429'))
        .mockResolvedValueOnce({ vibePitch: 'z' })
      saUpsert.mockResolvedValue({})

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/icps/icp-1/reference-tracks/approve-all-pending',
        headers: AUTH,
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      // All three targets approved + all three decompose attempts awaited.
      expect(body.approvedCount).toBe(3)
      expect(body.ids).toEqual(['ref-1', 'ref-2', 'ref-3'])
      expect(decomposeMock).toHaveBeenCalledTimes(3)
      expect(body.decomposed).toBe(2)
      expect(body.decomposeFailed).toBe(1)
      expect(body.errors).toEqual([
        { id: 'ref-2', artist: 'B', title: 'Two', error: 'anthropic 429' },
      ])
      // Only the two successful tracks get a StyleAnalysis upsert.
      expect(saUpsert).toHaveBeenCalledTimes(2)
    })

    it('short-circuits with no decompose calls when nothing is pending', async () => {
      icpFindUnique.mockResolvedValue({ id: 'icp-1' })
      refFindMany.mockResolvedValue([])

      const app = await buildTestApp(adminRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/icps/icp-1/reference-tracks/approve-all-pending',
        headers: AUTH,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ approvedCount: 0, ids: [] })
      expect(decomposeMock).not.toHaveBeenCalled()
      expect(refUpdateMany).not.toHaveBeenCalled()
    })
  })
})
