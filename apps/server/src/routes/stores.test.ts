// Integration tests for the public store-resolution endpoints.
//
// Canonical reference for the Fastify in-process integration test pattern.
// New route integration tests should mirror this shape: mock Prisma at the
// top with vi.mock, build a test app via buildTestApp, inject requests,
// assert on response shape.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Prisma mock. Must be at the top, must use a literal module path —
// see TESTING.md "Mocking conventions" for why.
vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findUnique: vi.fn(),
    },
  },
}))

import { storeRoutes } from './stores.js'
import { prisma } from '../db.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'
import { makeStore } from '../test-utils/fixtures.js'

const findUniqueMock = prisma.store.findUnique as ReturnType<typeof vi.fn>

describe('GET /by-slug/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with the resolved store on a happy-path lookup', async () => {
    findUniqueMock.mockResolvedValue(
      makeStore({ slug: 'test-store-1234', tier: 'pro' }),
    )

    const app = await buildTestApp(storeRoutes)
    const res = await app.inject({ method: 'GET', url: '/by-slug/test-store-1234' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      id: 'store-00000000-0000-0000-0000-000000000001',
      name: 'Test Store',
      slug: 'test-store-1234',
      tier: 'pro',
      timezone: 'America/Denver',
      pausedUntil: null,
    })
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'test-store-1234' } }),
    )
  })

  it('returns 404 when the slug does not exist', async () => {
    findUniqueMock.mockResolvedValue(null)

    const app = await buildTestApp(storeRoutes)
    const res = await app.inject({ method: 'GET', url: '/by-slug/no-such-slug' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'store_not_found' })
  })

  it('returns 404 when the store exists but is archived', async () => {
    findUniqueMock.mockResolvedValue(
      makeStore({ archivedAt: new Date('2026-01-01T00:00:00Z') }),
    )

    const app = await buildTestApp(storeRoutes)
    const res = await app.inject({ method: 'GET', url: '/by-slug/archived-store' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'store_not_found' })
  })

  // Pins the load-bearing invariant: the player gets the EFFECTIVE tier, not
  // the paid tier — comped stores play with their comp entitlements. This is
  // the whole reason the route reaches into effectiveTier instead of just
  // returning store.tier directly. A regression here silently drops comped
  // customers back to their paid tier in the player.
  it('returns the effective tier when a comp upgrades the store (pro comp on free)', async () => {
    findUniqueMock.mockResolvedValue(
      makeStore({
        tier: 'free',
        compTier: 'pro',
        compExpiresAt: new Date('2099-12-31T00:00:00Z'),
      }),
    )

    const app = await buildTestApp(storeRoutes)
    const res = await app.inject({ method: 'GET', url: '/by-slug/comped-store' })

    expect(res.statusCode).toBe(200)
    expect(res.json().tier).toBe('pro')
  })

  it('returns paid tier when the comp has already expired', async () => {
    findUniqueMock.mockResolvedValue(
      makeStore({
        tier: 'core',
        compTier: 'pro',
        compExpiresAt: new Date('2020-01-01T00:00:00Z'),
      }),
    )

    const app = await buildTestApp(storeRoutes)
    const res = await app.inject({ method: 'GET', url: '/by-slug/expired-comp' })

    expect(res.statusCode).toBe(200)
    expect(res.json().tier).toBe('core')
  })
})
