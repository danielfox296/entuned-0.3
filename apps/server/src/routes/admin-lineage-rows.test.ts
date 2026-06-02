// Integration tests for the Song Browser admin surface:
//   GET /admin/lineage-rows
//
// Regression: when the operator picks a specific ICP in the Dash Song Browser,
// the explicit ICP filter must win over the FREE hide/only toggle. Previously
// the toggle would overwrite `where.icpId` and silently return rows for *other*
// ICPs (e.g. selecting "Free Tier" with the default FREE=hide showed every
// non-Free-Tier row — Gary/Untuckit songs in a Free-Tier-scoped view).
//
// Lives in its own file so the prisma mock surface stays scoped to the models
// this route touches. Mirrors the conventions in admin-song-repair.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: any = {
    account: { findUnique: vi.fn() },
    lineageRow: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    iCP: { findMany: vi.fn() },
    playbackEvent: { groupBy: vi.fn() },
    // Models referenced by other admin route handlers registered alongside.
    // Must exist on the mock or adminRoutes() throws at registration time.
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    scheduleSlot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    client: { findUnique: vi.fn() },
    clientMembership: { create: vi.fn() },
    song: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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

import { adminRoutes } from './admin.js'
import { prisma } from '../db.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'
import { FREE_TIER_ICP_ID } from '../lib/freeTier.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const lineageFindMany = prisma.lineageRow.findMany as ReturnType<typeof vi.fn>
const lineageCount = prisma.lineageRow.count as ReturnType<typeof vi.fn>
const icpFindMany = prisma.iCP.findMany as ReturnType<typeof vi.fn>
const playbackGroupBy = prisma.playbackEvent.groupBy as ReturnType<typeof vi.fn>

const AUTH = { authorization: 'Bearer admin-test-token' }

function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001',
    email: 'admin@example.com',
    isAdmin: true,
    disabledAt: null,
    tokenVersion: 7,
  })
}

describe('GET /admin/lineage-rows — icp + free-tier filter precedence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedAdminAccount()
    lineageFindMany.mockResolvedValue([])
    lineageCount.mockResolvedValue(0)
    icpFindMany.mockResolvedValue([])
    playbackGroupBy.mockResolvedValue([])
  })

  it('selects the song detail fields the dash Song Browser expand panel needs (r2ObjectKey, contentType, uploadedAt)', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/lineage-rows',
      headers: AUTH,
    })
    expect(res.statusCode).toBe(200)
    const include = lineageFindMany.mock.calls[0][0].include
    expect(include.song.select).toMatchObject({
      id: true, r2Url: true, r2ObjectKey: true,
      byteSize: true, contentType: true, uploadedAt: true,
    })
  })

  it('returns songSeedId + song fields on each row so the detail panel can render without an extra fetch', async () => {
    const uploadedAt = new Date('2026-04-01T12:00:00Z')
    lineageFindMany.mockResolvedValueOnce([{
      id: 'row-1',
      active: true,
      createdAt: new Date('2026-04-01T12:00:00Z'),
      icpId: '00000000-0000-0000-0000-0000000000aa',
      songId: 'song-1',
      outcomeId: 'oc-1',
      hookId: 'hk-1',
      songSeedId: 'seed-1',
      song: {
        id: 'song-1',
        r2Url: 'https://r2.example.com/song-1.mp3',
        r2ObjectKey: 'songs/song-1.mp3',
        byteSize: 1234567n,
        contentType: 'audio/mpeg',
        uploadedAt,
      },
      hook: { id: 'hk-1', text: 'the hook' },
      outcome: { id: 'oc-1', title: 'Focus', displayTitle: 'Focus AM', version: 2 },
      songSeed: { id: 'seed-1', title: 'My Song' },
    }])
    lineageCount.mockResolvedValueOnce(1)

    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/lineage-rows',
      headers: AUTH,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.rows[0].songSeedId).toBe('seed-1')
    expect(body.rows[0].song).toMatchObject({
      id: 'song-1',
      r2Url: 'https://r2.example.com/song-1.mp3',
      r2ObjectKey: 'songs/song-1.mp3',
      // BigInt → number coercion: Fastify's default JSON serializer cannot
      // emit BigInts. Regression guard for the 500 the route returned when
      // the response carried a non-null byteSize.
      byteSize: 1234567,
      contentType: 'audio/mpeg',
      uploadedAt: uploadedAt.toISOString(),
    })
  })

  it('explicit icpId=FREE_TIER_ICP_ID with default general=hide returns Free Tier rows (does not get overwritten to { not: FREE_TIER_ICP_ID })', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/lineage-rows?icpId=${FREE_TIER_ICP_ID}`,
      headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    expect(lineageFindMany).toHaveBeenCalledTimes(1)
    const where = lineageFindMany.mock.calls[0][0].where
    expect(where.icpId).toBe(FREE_TIER_ICP_ID)
  })

  it('explicit icpId for a paid ICP wins over general=only (would otherwise be rewritten to FREE_TIER_ICP_ID)', async () => {
    const paidIcp = '99999999-9999-9999-9999-999999999999'
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/lineage-rows?icpId=${paidIcp}&general=only`,
      headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    const where = lineageFindMany.mock.calls[0][0].where
    expect(where.icpId).toBe(paidIcp)
  })

  it('no icpId + default general=hide applies the Free Tier exclusion filter', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/lineage-rows',
      headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    const where = lineageFindMany.mock.calls[0][0].where
    expect(where.icpId).toEqual({ not: FREE_TIER_ICP_ID })
  })

  it('no icpId + general=only restricts to Free Tier rows', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/lineage-rows?general=only',
      headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    const where = lineageFindMany.mock.calls[0][0].where
    expect(where.icpId).toBe(FREE_TIER_ICP_ID)
  })

  it('no icpId + general=all applies no ICP filter', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/lineage-rows?general=all',
      headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    const where = lineageFindMany.mock.calls[0][0].where
    expect(where.icpId).toBeUndefined()
  })
})
