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

vi.mock('../lib/auth.js', () => ({
  verify: vi.fn((token: string) => {
    if (token === 'admin-test-token') {
      return { accountId: 'op-admin-001', email: 'admin@example.com', isAdmin: true, tv: 7, exp: Date.now() + 60_000 }
    }
    return null
  }),
}))

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
