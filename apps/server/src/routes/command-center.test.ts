// Integration tests for the Morning Command Center routes.
//
// Auth surface: Bearer JWT, admin-only (same shape as admin.ts).
// Mocked: prisma (the four new models + account for requireAdmin),
// auth.verify (returns canned payload for the magic test token).
//
// Covers: 401/403 paths, queue list/create/patch/delete, idempotent
// queue create on externalId collision, scoreboard MRR math, proof
// point + content piece CRUD, terminal-status acted_at stamping.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => {
  const mock: Record<string, unknown> = {
    account: { findUnique: vi.fn() },
    queueItem: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    dailyDigest: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    proofPoint: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contentPiece: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    store: {
      findMany: vi.fn(),
    },
  }
  return { prisma: mock }
})

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

import { commandCenterRoutes } from './command-center.js'
import { prisma } from '../db.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const accountFindUnique = prisma.account.findUnique as ReturnType<typeof vi.fn>
const queueFindMany = prisma.queueItem.findMany as ReturnType<typeof vi.fn>
const queueFindUnique = prisma.queueItem.findUnique as ReturnType<typeof vi.fn>
const queueCreate = prisma.queueItem.create as ReturnType<typeof vi.fn>
const queueUpdate = prisma.queueItem.update as ReturnType<typeof vi.fn>
const queueDelete = prisma.queueItem.delete as ReturnType<typeof vi.fn>
const digestFindUnique = prisma.dailyDigest.findUnique as ReturnType<typeof vi.fn>
const digestCreate = prisma.dailyDigest.create as ReturnType<typeof vi.fn>
const proofFindMany = prisma.proofPoint.findMany as ReturnType<typeof vi.fn>
const proofCreate = prisma.proofPoint.create as ReturnType<typeof vi.fn>
const proofUpdate = prisma.proofPoint.update as ReturnType<typeof vi.fn>
const proofDelete = prisma.proofPoint.delete as ReturnType<typeof vi.fn>
const contentFindMany = prisma.contentPiece.findMany as ReturnType<typeof vi.fn>
const contentCreate = prisma.contentPiece.create as ReturnType<typeof vi.fn>
const contentUpdate = prisma.contentPiece.update as ReturnType<typeof vi.fn>
const contentDelete = prisma.contentPiece.delete as ReturnType<typeof vi.fn>
const storeFindMany = prisma.store.findMany as ReturnType<typeof vi.fn>

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

beforeEach(() => {
  vi.resetAllMocks()
  seedAdminAccount()
})

describe('command-center auth gating', () => {
  it('401s when no Authorization header is present', async () => {
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'GET', url: '/queue' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('401s on an unknown bearer token', async () => {
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/queue',
      headers: { authorization: 'Bearer garbage' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_token' })
  })

  it('403s when the JWT is valid but the account is not admin', async () => {
    accountFindUnique.mockResolvedValue({
      id: 'op-user-002',
      email: 'user@example.com',
      isAdmin: false,
      disabledAt: null,
      tokenVersion: 1,
    })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/queue',
      headers: { authorization: 'Bearer non-admin-test-token' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'admin_required' })
  })
})

describe('GET /queue', () => {
  it('returns items filtered by type and status', async () => {
    queueFindMany.mockResolvedValue([
      { id: 'q1', type: 'signal', status: 'pending', title: 'r/smallbusiness post' },
    ])
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/queue?type=signal&status=pending',
      headers: AUTH,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [
      { id: 'q1', type: 'signal', status: 'pending', title: 'r/smallbusiness post' },
    ] })
    expect(queueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: 'signal', status: 'pending' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
    )
  })
})

describe('POST /queue', () => {
  it('rejects an unknown type at the Zod boundary', async () => {
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: AUTH,
      payload: { type: 'not-a-type', title: 'x' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_body')
  })

  it('creates a queue item and defaults status to pending', async () => {
    queueCreate.mockResolvedValue({
      id: 'q-new',
      type: 'signal',
      subtype: 'reddit',
      status: 'pending',
      title: 'matched post',
    })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: AUTH,
      payload: { type: 'signal', subtype: 'reddit', title: 'matched post' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'q-new', status: 'pending' })
    expect(queueCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'signal',
          subtype: 'reddit',
          status: 'pending',
          title: 'matched post',
        }),
      }),
    )
  })

  // Idempotency: workers run on cron and call POST /queue with externalId
  // every time. A unique-violation on external_id must NOT 500 the worker;
  // it should return the already-queued row.
  it('returns the existing row on externalId collision instead of 500ing', async () => {
    queueCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    )
    queueFindUnique.mockResolvedValue({
      id: 'q-existing',
      type: 'signal',
      externalId: 't3_abc123',
      title: 'already queued',
    })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/queue',
      headers: AUTH,
      payload: { type: 'signal', title: 'matched post', externalId: 't3_abc123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'q-existing', externalId: 't3_abc123' })
  })
})

describe('PATCH /queue/:id', () => {
  it('stamps acted_at when transitioning to a terminal status', async () => {
    queueUpdate.mockResolvedValue({ id: 'q1', status: 'sent', actedAt: new Date() })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'PATCH',
      url: '/queue/q1',
      headers: AUTH,
      payload: { status: 'sent' },
    })
    expect(res.statusCode).toBe(200)
    const call = queueUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'q1' })
    expect(call.data.status).toBe('sent')
    expect(call.data.actedAt).toBeInstanceOf(Date)
  })

  it('does NOT stamp acted_at when only snoozing', async () => {
    queueUpdate.mockResolvedValue({ id: 'q1', status: 'snoozed', actedAt: null })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'PATCH',
      url: '/queue/q1',
      headers: AUTH,
      payload: {
        status: 'snoozed',
        snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })
    expect(res.statusCode).toBe(200)
    const call = queueUpdate.mock.calls[0][0]
    expect(call.data.status).toBe('snoozed')
    expect(call.data.actedAt).toBeUndefined()
    expect(call.data.snoozedUntil).toBeInstanceOf(Date)
  })

  it('404s when the item does not exist', async () => {
    queueUpdate.mockRejectedValue(new Error('not found'))
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'PATCH',
      url: '/queue/nope',
      headers: AUTH,
      payload: { status: 'sent' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
  })
})

describe('DELETE /queue/:id', () => {
  it('204s on success', async () => {
    queueDelete.mockResolvedValue({ id: 'q1' })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'DELETE', url: '/queue/q1', headers: AUTH })
    expect(res.statusCode).toBe(204)
  })
})

describe('GET /scoreboard', () => {
  it('computes free/paid/MRR from active stores by tier', async () => {
    storeFindMany.mockResolvedValue([
      { tier: 'free' },
      { tier: 'free' },
      { tier: 'core' }, // 9900
      { tier: 'pro' }, // 24900
      { tier: 'enterprise' }, // 99900
    ])
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'GET', url: '/scoreboard', headers: AUTH })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.free).toBe(2)
    expect(body.paid).toBe(3)
    expect(body.mrr).toBe(9900 + 24900 + 99900)
    expect(body.target).toEqual({ freeSignups: 100, paidUsers: 10 })
    expect(storeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    )
  })
})

describe('GET /digest', () => {
  it('returns the existing row when already generated for today', async () => {
    digestFindUnique.mockResolvedValue({ id: 'd1', signalCount: 3 })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'GET', url: '/digest', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 'd1', signalCount: 3 })
    expect(digestCreate).not.toHaveBeenCalled()
  })

  it('materializes a fresh digest when none exists for today', async () => {
    digestFindUnique.mockResolvedValue(null)
    queueFindMany.mockResolvedValue([
      { type: 'signal' }, { type: 'signal' }, { type: 'outreach' },
    ])
    storeFindMany.mockResolvedValue([{ tier: 'free' }, { tier: 'core' }])
    digestCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'd-new',
      ...args.data,
    }))

    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'GET', url: '/digest', headers: AUTH })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.signalCount).toBe(2)
    expect(body.outreachCount).toBe(1)
    expect(body.freeSignups).toBe(1)
    expect(body.paidUsers).toBe(1)
    expect(body.mrr).toBe(9900)
  })
})

describe('proof points', () => {
  it('GET /proof-points includes pieces for content-coverage rendering', async () => {
    proofFindMany.mockResolvedValue([
      { id: 'pp1', label: 'kari-lift', pieces: [{ id: 'cp1', format: 'linkedin', status: 'draft' }] },
    ])
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'GET', url: '/proof-points', headers: AUTH })
    expect(res.statusCode).toBe(200)
    expect(res.json().items[0].pieces).toHaveLength(1)
    expect(proofFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ pieces: expect.anything() }) }),
    )
  })

  it('POST /proof-points rejects an invalid category', async () => {
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/proof-points',
      headers: AUTH,
      payload: {
        label: 'x', quoteText: 'y', attribution: 'z', category: 'not-a-category',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /proof-points creates with default empty tags', async () => {
    proofCreate.mockResolvedValue({ id: 'pp-new', label: 'add-to-pile', tags: [] })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/proof-points',
      headers: AUTH,
      payload: {
        label: 'add-to-pile',
        quoteText: 'just add it to the pile',
        attribution: 'Customer at pilot store',
        category: 'customer_quote',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(proofCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tags: [] }),
      }),
    )
  })

  it('PATCH /proof-points/:id updates only provided fields', async () => {
    proofUpdate.mockResolvedValue({ id: 'pp1', context: 'updated' })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'PATCH',
      url: '/proof-points/pp1',
      headers: AUTH,
      payload: { context: 'updated' },
    })
    expect(res.statusCode).toBe(200)
    const call = proofUpdate.mock.calls[0][0]
    expect(call.data).toEqual({ context: 'updated' })
  })

  it('DELETE /proof-points/:id 204s on success', async () => {
    proofDelete.mockResolvedValue({ id: 'pp1' })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({ method: 'DELETE', url: '/proof-points/pp1', headers: AUTH })
    expect(res.statusCode).toBe(204)
  })
})

describe('content pieces', () => {
  it('GET /content filters by narrative + format + status', async () => {
    contentFindMany.mockResolvedValue([{ id: 'cp1', narrative: 'kari-lift', format: 'linkedin' }])
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/content?narrative=kari-lift&format=linkedin&status=draft',
      headers: AUTH,
    })
    expect(res.statusCode).toBe(200)
    expect(contentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { narrative: 'kari-lift', format: 'linkedin', status: 'draft' },
      }),
    )
  })

  it('POST /content rejects an unknown format', async () => {
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/content',
      headers: AUTH,
      payload: { narrative: 'kari-lift', format: 'not-a-format', body: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  // Pins the publish-stamp contract: transitioning to 'published' without
  // explicit publishedAt should fill it in server-side. Removing this
  // silently lets approved drafts ship without a publish timestamp.
  it('PATCH /content/:id stamps publishedAt when transitioning to published', async () => {
    contentUpdate.mockResolvedValue({ id: 'cp1', status: 'published' })
    const app = await buildTestApp(commandCenterRoutes)
    const res = await app.inject({
      method: 'PATCH',
      url: '/content/cp1',
      headers: AUTH,
      payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(200)
    const call = contentUpdate.mock.calls[0][0]
    expect(call.data.status).toBe('published')
    expect(call.data.publishedAt).toBeInstanceOf(Date)
  })

  it('PATCH /content/:id does NOT overwrite an explicit publishedAt', async () => {
    contentUpdate.mockResolvedValue({ id: 'cp1', status: 'published' })
    const app = await buildTestApp(commandCenterRoutes)
    const explicit = '2026-01-01T12:00:00.000Z'
    const res = await app.inject({
      method: 'PATCH',
      url: '/content/cp1',
      headers: AUTH,
      payload: { status: 'published', publishedAt: explicit },
    })
    expect(res.statusCode).toBe(200)
    const call = contentUpdate.mock.calls[0][0]
    expect(call.data.publishedAt.toISOString()).toBe(explicit)
  })
})
