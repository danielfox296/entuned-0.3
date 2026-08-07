// Integration tests for the Dash station-operations surface:
//   GET   /admin/icps           — ICP list, addressable without a Store
//   GET   /admin/icps/:id       — ICP detail, addressable without a Store
//   GET   /admin/stations       — station catalogue + pool depth + listeners
//   PATCH /admin/stations/:id   — operator-editable station copy
//   GET   /admin/stores/:id     — now carries the Store's station
//
// The regression these pin: Dash reached every ICP through
// `GET /admin/stores/:id`, whose ICP query is `storeLinks: { some: { storeId } }`.
// A Station's ICP has no StoreICP link until a Store actually picks that station
// (see lib/stations.ts setStoreStation), so all six launch stations were
// invisible to the admin app — including the reference-track editor, which is
// the only way to seed a station's pool.
//
// Lives in its own file so the prisma mock surface stays scoped to the models
// these routes touch. Mirrors the conventions in admin-lineage-rows.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: any = {
    account: { findUnique: vi.fn() },
    iCP: { findMany: vi.fn(), findUnique: vi.fn() },
    station: { findMany: vi.fn(), update: vi.fn() },
    lineageRow: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    // Models referenced by other admin route handlers registered alongside.
    // Must exist on the mock or adminRoutes() throws at registration time.
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    scheduleSlot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    client: { findUnique: vi.fn() },
    clientMembership: { create: vi.fn() },
    song: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    playbackEvent: { groupBy: vi.fn() },
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

import { adminRoutes } from './admin.js'
import { prisma } from '../db.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'
import { LAUNCH_STATIONS } from '../lib/stations.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const icpFindMany = prisma.iCP.findMany as ReturnType<typeof vi.fn>
const icpFindUnique = prisma.iCP.findUnique as ReturnType<typeof vi.fn>
const stationFindMany = prisma.station.findMany as ReturnType<typeof vi.fn>
const stationUpdate = prisma.station.update as ReturnType<typeof vi.fn>
const lineageGroupBy = prisma.lineageRow.groupBy as ReturnType<typeof vi.fn>
const storeFindUnique = prisma.store.findUnique as ReturnType<typeof vi.fn>

const AUTH = { authorization: 'Bearer admin-test-token' }

const FREE_TIER_CLIENT_ID = '00000000-0000-0000-0000-000000000001'
const SOLO_PIANO = LAUNCH_STATIONS[0]

function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001',
    email: 'admin@example.com',
    isAdmin: true,
    disabledAt: null,
    tokenVersion: 7,
  })
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: several cases below install one-off
  // rejections / 404 shapes on the shared prisma mock. See TESTING.md.
  vi.resetAllMocks()
  seedAdminAccount()
})

describe('GET /admin/icps', () => {
  it('lists every non-archived ICP with no store filter, so station ICPs appear', async () => {
    icpFindMany.mockResolvedValueOnce([
      {
        id: SOLO_PIANO.icpId,
        name: 'Solo Piano',
        clientId: FREE_TIER_CLIENT_ID,
        client: { companyName: 'Free Tier' },
        // The whole point: zero store links.
        storeLinks: [],
        station: { id: SOLO_PIANO.id, stationKey: 'solo-piano', displayName: 'Solo Piano', active: true },
      },
    ])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/icps', headers: AUTH })

    expect(res.statusCode).toBe(200)
    expect(icpFindMany.mock.calls[0][0].where).toEqual({ archivedAt: null })
    expect(res.json()).toEqual([{
      id: SOLO_PIANO.icpId,
      name: 'Solo Piano',
      clientId: FREE_TIER_CLIENT_ID,
      clientName: 'Free Tier',
      stores: [],
      station: { id: SOLO_PIANO.id, stationKey: 'solo-piano', displayName: 'Solo Piano', active: true },
    }])
  })

  it('narrows to one client when ?clientId= is supplied', async () => {
    icpFindMany.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/icps?clientId=${FREE_TIER_CLIENT_ID}`,
      headers: AUTH,
    })

    expect(res.statusCode).toBe(200)
    expect(icpFindMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      clientId: FREE_TIER_CLIENT_ID,
    })
  })

  it('narrows to one location when ?storeId= is supplied', async () => {
    icpFindMany.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/icps?storeId=store-1', headers: AUTH })

    expect(res.statusCode).toBe(200)
    // Store-scoped, NOT client-scoped. A free Store's pools are owned by the
    // Free Tier client, not by the Store's own client — filtering by client
    // would silently drop them from the Dash selector.
    expect(icpFindMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      storeLinks: { some: { storeId: 'store-1' } },
    })
  })

  it('ANDs clientId and storeId when both are supplied', async () => {
    icpFindMany.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    await app.inject({
      method: 'GET',
      url: `/icps?clientId=${FREE_TIER_CLIENT_ID}&storeId=store-1`,
      headers: AUTH,
    })

    expect(icpFindMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      clientId: FREE_TIER_CLIENT_ID,
      storeLinks: { some: { storeId: 'store-1' } },
    })
  })

  it('returns a cross-client ICP when scoped by store — the free-tier shape', async () => {
    icpFindMany.mockResolvedValueOnce([{
      id: SOLO_PIANO.icpId,
      name: 'Solo Piano',
      // Owned by Free Tier…
      clientId: FREE_TIER_CLIENT_ID,
      client: { companyName: 'Free Tier' },
      // …but linked to a store belonging to a different client.
      storeLinks: [{ store: { id: 'store-1', name: 'Cafe One' } }],
      station: { id: SOLO_PIANO.id, stationKey: 'solo-piano', displayName: 'Solo Piano', active: true },
    }])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/icps?storeId=store-1', headers: AUTH })

    expect(res.json()).toHaveLength(1)
    expect(res.json()[0].clientId).toBe(FREE_TIER_CLIENT_ID)
  })

  it('flattens store links to {id,name} pairs for ICPs that do have stores', async () => {
    icpFindMany.mockResolvedValueOnce([{
      id: 'icp-paid',
      name: 'Mindful Mover',
      clientId: 'client-1',
      client: { companyName: 'Gary' },
      storeLinks: [{ store: { id: 'store-1', name: 'Boulder' } }],
      station: null,
    }])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/icps', headers: AUTH })

    expect(res.json()[0].stores).toEqual([{ id: 'store-1', name: 'Boulder' }])
    expect(res.json()[0].station).toBeNull()
  })
})

describe('GET /admin/icps/:id', () => {
  it('returns a station ICP with its reference tracks even though it has no store links', async () => {
    icpFindUnique.mockResolvedValueOnce({
      id: SOLO_PIANO.icpId,
      clientId: FREE_TIER_CLIENT_ID,
      name: 'Solo Piano',
      fears: null,
      client: { id: FREE_TIER_CLIENT_ID, companyName: 'Free Tier' },
      referenceTracks: [{
        id: 'ref-1',
        icpId: SOLO_PIANO.icpId,
        bucket: 'FormationEra',
        artist: 'Bill Evans',
        title: 'Peace Piece',
        status: 'approved',
        styleAnalysis: { id: 'sa-1', bpm: 62 },
      }],
      storeLinks: [],
      station: {
        id: SOLO_PIANO.id,
        stationKey: 'solo-piano',
        displayName: 'Solo Piano',
        subtitle: 'Quiet keys, nothing else',
        sortOrder: 1,
        active: true,
      },
    })
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: `/icps/${SOLO_PIANO.icpId}`, headers: AUTH })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.stores).toEqual([])
    expect(body.client).toEqual({ id: FREE_TIER_CLIENT_ID, name: 'Free Tier' })
    expect(body.icp.name).toBe('Solo Piano')
    expect(body.icp.station.stationKey).toBe('solo-piano')
    expect(body.icp.referenceTracks).toHaveLength(1)
    expect(body.icp.referenceTracks[0].styleAnalysis.bpm).toBe(62)
    // The `client` relation is lifted out, not left duplicated on the ICP.
    expect(body.icp.client).toBeUndefined()
    expect(body.icp.storeLinks).toBeUndefined()
  })

  it('orders reference tracks the same way the store-detail payload does', async () => {
    icpFindUnique.mockResolvedValueOnce({
      id: 'icp-1', clientId: 'c1', name: 'x',
      client: { id: 'c1', companyName: 'C' },
      referenceTracks: [], storeLinks: [], station: null,
    })
    const app = await buildTestApp(adminRoutes)
    await app.inject({ method: 'GET', url: '/icps/icp-1', headers: AUTH })

    expect(icpFindUnique.mock.calls[0][0].include.referenceTracks.orderBy).toEqual([
      { bucket: 'asc' }, { status: 'desc' }, { artist: 'asc' }, { title: 'asc' },
    ])
    expect(icpFindUnique.mock.calls[0][0].include.referenceTracks.include).toEqual({ styleAnalysis: true })
  })

  it('404s on an unknown ICP', async () => {
    icpFindUnique.mockResolvedValueOnce(null)
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/icps/nope', headers: AUTH })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
  })

  it('reports the stores listening to a station once links exist', async () => {
    icpFindUnique.mockResolvedValueOnce({
      id: SOLO_PIANO.icpId, clientId: FREE_TIER_CLIENT_ID, name: 'Solo Piano',
      client: { id: FREE_TIER_CLIENT_ID, companyName: 'Free Tier' },
      referenceTracks: [],
      storeLinks: [{ store: { id: 'store-9', name: 'Cafe Nine', client: { companyName: 'Nine Co' } } }],
      station: null,
    })
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: `/icps/${SOLO_PIANO.icpId}`, headers: AUTH })

    expect(res.json().stores).toEqual([{ id: 'store-9', name: 'Cafe Nine', clientName: 'Nine Co' }])
  })
})

describe('GET /admin/stations', () => {
  function stationRow(overrides: Record<string, unknown> = {}) {
    return {
      id: SOLO_PIANO.id,
      stationKey: 'solo-piano',
      displayName: 'Solo Piano',
      subtitle: 'Quiet keys',
      genreSteering: 'solo acoustic piano, no drums',
      sortOrder: 1,
      active: true,
      icpId: SOLO_PIANO.icpId,
      icp: { id: SOLO_PIANO.icpId, name: 'Solo Piano', clientId: FREE_TIER_CLIENT_ID, archivedAt: null },
      stores: [],
      updatedAt: new Date('2026-08-06T12:00:00Z'),
      ...overrides,
    }
  }

  it('joins active LineageRow counts onto each station as pool depth', async () => {
    stationFindMany.mockResolvedValueOnce([stationRow()])
    lineageGroupBy.mockResolvedValueOnce([{ icpId: SOLO_PIANO.icpId, _count: { _all: 42 } }])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stations', headers: AUTH })

    expect(res.statusCode).toBe(200)
    expect(res.json()[0].poolSize).toBe(42)
    // Pool depth must count the same rows Hendrix selects over.
    expect(lineageGroupBy.mock.calls[0][0].where).toEqual({
      active: true,
      icpId: { in: [SOLO_PIANO.icpId] },
    })
  })

  it('reports poolSize 0 for a station whose pool has not been generated yet', async () => {
    stationFindMany.mockResolvedValueOnce([stationRow()])
    lineageGroupBy.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stations', headers: AUTH })

    expect(res.json()[0].poolSize).toBe(0)
  })

  it('includes inactive stations — this is the catalogue view, not the picker', async () => {
    stationFindMany.mockResolvedValueOnce([stationRow({ active: false })])
    lineageGroupBy.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stations', headers: AUTH })

    expect(stationFindMany.mock.calls[0][0].where).toBeUndefined()
    expect(res.json()[0].active).toBe(false)
  })

  it('orders by sortOrder then displayName, matching the customer picker', async () => {
    stationFindMany.mockResolvedValueOnce([])
    lineageGroupBy.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    await app.inject({ method: 'GET', url: '/stations', headers: AUTH })

    expect(stationFindMany.mock.calls[0][0].orderBy).toEqual([
      { sortOrder: 'asc' }, { displayName: 'asc' },
    ])
  })

  it('lists the non-archived stores listening to each station', async () => {
    stationFindMany.mockResolvedValueOnce([stationRow({
      stores: [{ id: 'store-1', name: 'Cafe One', tier: 'free', client: { companyName: 'One Co' } }],
    })])
    lineageGroupBy.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stations', headers: AUTH })

    expect(stationFindMany.mock.calls[0][0].include.stores.where).toEqual({ archivedAt: null })
    expect(res.json()[0].stores).toEqual([
      { id: 'store-1', name: 'Cafe One', tier: 'free', clientName: 'One Co' },
    ])
  })

  it('flags a station whose ICP has been archived out from under it', async () => {
    stationFindMany.mockResolvedValueOnce([stationRow({
      icp: { id: SOLO_PIANO.icpId, name: 'Solo Piano', clientId: FREE_TIER_CLIENT_ID, archivedAt: new Date() },
    })])
    lineageGroupBy.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stations', headers: AUTH })

    expect(res.json()[0].icpArchived).toBe(true)
  })
})

describe('PATCH /admin/stations/:id', () => {
  it('saves the operator-editable copy fields', async () => {
    stationUpdate.mockResolvedValueOnce({
      id: SOLO_PIANO.id, stationKey: 'solo-piano',
      displayName: 'Piano Only', subtitle: 'Just keys',
      genreSteering: 'solo acoustic piano', sortOrder: 2, active: true,
      icpId: SOLO_PIANO.icpId, updatedAt: new Date('2026-08-06T13:00:00Z'),
    })
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH',
      url: `/stations/${SOLO_PIANO.id}`,
      headers: AUTH,
      payload: { displayName: 'Piano Only', subtitle: 'Just keys', sortOrder: 2 },
    })

    expect(res.statusCode).toBe(200)
    expect(stationUpdate.mock.calls[0][0]).toEqual({
      where: { id: SOLO_PIANO.id },
      data: { displayName: 'Piano Only', subtitle: 'Just keys', sortOrder: 2 },
    })
    expect(res.json().displayName).toBe('Piano Only')
  })

  it('accepts a null subtitle (clearing the picker descriptor)', async () => {
    stationUpdate.mockResolvedValueOnce({
      id: SOLO_PIANO.id, stationKey: 'solo-piano', displayName: 'Solo Piano',
      subtitle: null, genreSteering: 'x', sortOrder: 1, active: true,
      icpId: SOLO_PIANO.icpId, updatedAt: new Date(),
    })
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH', url: `/stations/${SOLO_PIANO.id}`, headers: AUTH,
      payload: { subtitle: null },
    })

    expect(res.statusCode).toBe(200)
    expect(stationUpdate.mock.calls[0][0].data).toEqual({ subtitle: null })
  })

  it('rejects a stationKey rename — the slug is the durable telemetry identity', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH', url: `/stations/${SOLO_PIANO.id}`, headers: AUTH,
      payload: { stationKey: 'renamed' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('rejects repointing icpId — the 1:1 with the pool is enforced, not editable', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH', url: `/stations/${SOLO_PIANO.id}`, headers: AUTH,
      payload: { icpId: '00000000-0000-0000-0000-0000000000ff' },
    })

    expect(res.statusCode).toBe(400)
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty displayName', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH', url: `/stations/${SOLO_PIANO.id}`, headers: AUTH,
      payload: { displayName: '' },
    })

    expect(res.statusCode).toBe(400)
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('can deactivate a station', async () => {
    stationUpdate.mockResolvedValueOnce({
      id: SOLO_PIANO.id, stationKey: 'solo-piano', displayName: 'Solo Piano',
      subtitle: null, genreSteering: 'x', sortOrder: 1, active: false,
      icpId: SOLO_PIANO.icpId, updatedAt: new Date(),
    })
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH', url: `/stations/${SOLO_PIANO.id}`, headers: AUTH,
      payload: { active: false },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().active).toBe(false)
  })

  it('404s when the station does not exist', async () => {
    stationUpdate.mockRejectedValueOnce(new Error('record not found'))
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'PATCH', url: '/stations/00000000-0000-0000-0000-0000000000zz', headers: AUTH,
      payload: { displayName: 'x' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
  })
})

describe('GET /admin/stores/:id — station', () => {
  it('carries the Store’s current station so the Location editor can show it', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-1', name: 'Cafe One', timezone: 'America/Denver',
      goLiveDate: null, defaultOutcomeId: null, roomLoudnessSamplingEnabled: false,
      tier: 'free', stationId: SOLO_PIANO.id,
      client: { id: FREE_TIER_CLIENT_ID, companyName: 'Free Tier' },
      station: {
        id: SOLO_PIANO.id, stationKey: 'solo-piano',
        displayName: 'Solo Piano', subtitle: 'Quiet keys', active: true,
      },
    })
    icpFindMany.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stores/store-1', headers: AUTH })

    expect(res.statusCode).toBe(200)
    expect(res.json().store.stationId).toBe(SOLO_PIANO.id)
    expect(res.json().store.station.displayName).toBe('Solo Piano')
  })

  it('reports a null station for a Store that has not picked one', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-2', name: 'Paid Shop', timezone: 'America/Denver',
      goLiveDate: null, defaultOutcomeId: null, roomLoudnessSamplingEnabled: false,
      tier: 'pro', stationId: null,
      client: { id: 'client-1', companyName: 'Gary' },
      station: null,
    })
    icpFindMany.mockResolvedValueOnce([])
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({ method: 'GET', url: '/stores/store-2', headers: AUTH })

    expect(res.json().store.stationId).toBeNull()
    expect(res.json().store.station).toBeNull()
  })
})
