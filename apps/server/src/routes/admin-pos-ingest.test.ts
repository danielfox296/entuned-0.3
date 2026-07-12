// Integration tests for the POS ingest admin surface.
//
// Route covered:
//   POST /admin/stores/:storeId/pos/ingest — idempotent transaction upload
//
// Regression focus (DAT-2026-07-11 #6): the POSEvent unique index is
// (posProvider, posExternalId). Providers that don't return a transaction id
// leave posExternalId absent, and Postgres treats NULLs as distinct — so a
// null value would defeat the constraint entirely. The route MUST persist a
// synthetic `<runId>:<index>` key into the column (same value in the upsert
// `where` and `create`) so the DB index actually protects. These tests pin
// that the persisted value is never null and that where/create agree.
//
// Lives in its own file so the prisma mock surface stays scoped to the models
// this route touches. Mirrors the auth + buildTestApp conventions in
// admin.test.ts / admin-song-repair.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: any = {
    account: { findUnique: vi.fn() },
    store: { findUnique: vi.fn(), findMany: vi.fn() },
    pOSPullRun: { create: vi.fn(), update: vi.fn() },
    pOSEvent: { upsert: vi.fn() },
    // Required for adminRoutes to register — handlers we don't exercise here
    // still get attached, so all referenced models must exist.
    scheduleSlot: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    client: { findUnique: vi.fn() },
    clientMembership: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mock)),
  }
  return { prisma: mock }
})

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

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const storeFindUnique = prisma.store.findUnique as ReturnType<typeof vi.fn>
const runCreate = (prisma as any).pOSPullRun.create as ReturnType<typeof vi.fn>
const runUpdate = (prisma as any).pOSPullRun.update as ReturnType<typeof vi.fn>
const eventUpsert = (prisma as any).pOSEvent.upsert as ReturnType<typeof vi.fn>

const AUTH = { authorization: 'Bearer admin-test-token' }
const STORE_ID = 'store-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_ID = 'run-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function seedAdminAccount() {
  accountFindUnique.mockResolvedValue({
    id: 'op-admin-001', email: 'admin@example.com', isAdmin: true, disabledAt: null, tokenVersion: 7,
  })
}

function baseBody(events: any[]) {
  return {
    posProvider: 'square',
    pullWindowStart: '2026-07-01T00:00:00Z',
    pullWindowEnd: '2026-07-02T00:00:00Z',
    events,
  }
}

describe('admin routes — POS ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedAdminAccount()
    storeFindUnique.mockResolvedValue({ id: STORE_ID, clientId: 'client-1' })
    runCreate.mockResolvedValue({ id: RUN_ID })
    runUpdate.mockResolvedValue({})
    eventUpsert.mockResolvedValue({})
  })

  it('persists the provider transaction id as the dedup key when present (where === create)', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/pos/ingest`,
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: baseBody([
        { occurredAt: '2026-07-01T10:00:00Z', transactionValueCents: 1234, itemCount: 3, posExternalId: 'txn-abc' },
      ]),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ runId: RUN_ID, ingested: 1, skipped: 0 })

    const call = eventUpsert.mock.calls[0][0]
    // The lookup key and the persisted value MUST be the same id, otherwise
    // the upsert can never match an existing row on re-pull.
    expect(call.where.posProvider_posExternalId.posExternalId).toBe('txn-abc')
    expect(call.create.posExternalId).toBe('txn-abc')
  })

  it('synthesizes a non-null <runId>:<index> dedup key when the provider omits an id', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/pos/ingest`,
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: baseBody([
        { occurredAt: '2026-07-01T10:00:00Z', transactionValueCents: 500, itemCount: 1 },
        { occurredAt: '2026-07-01T11:00:00Z', transactionValueCents: 750, itemCount: 2 },
      ]),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ingested: 2 })

    // DAT-6 regression pin: for a null-id event the persisted posExternalId must
    // NOT be null (a null defeats the (posProvider, posExternalId) unique index),
    // and the `create` value must equal the `where` lookup value.
    for (const [args] of eventUpsert.mock.calls) {
      const whereId = args.where.posProvider_posExternalId.posExternalId
      expect(whereId).not.toBeNull()
      expect(whereId).toMatch(new RegExp(`^${RUN_ID}:\\d+$`))
      expect(args.create.posExternalId).toBe(whereId)
    }
    // Two events → two distinct synthetic keys (index advances).
    const keys = eventUpsert.mock.calls.map((c) => c[0].create.posExternalId)
    expect(new Set(keys).size).toBe(2)
  })

  it('returns 404 when the store does not exist (no run created)', async () => {
    storeFindUnique.mockResolvedValue(null)
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/pos/ingest`,
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: baseBody([{ occurredAt: '2026-07-01T10:00:00Z', transactionValueCents: 500, itemCount: 1 }]),
    })
    expect(res.statusCode).toBe(404)
    expect(runCreate).not.toHaveBeenCalled()
  })

  it('returns 401 without an Authorization header', async () => {
    const app = await buildTestApp(adminRoutes)
    const res = await app.inject({
      method: 'POST',
      url: `/stores/${STORE_ID}/pos/ingest`,
      headers: { 'content-type': 'application/json' },
      payload: baseBody([{ occurredAt: '2026-07-01T10:00:00Z', transactionValueCents: 500, itemCount: 1 }]),
    })
    expect(res.statusCode).toBe(401)
    expect(eventUpsert).not.toHaveBeenCalled()
  })
})
