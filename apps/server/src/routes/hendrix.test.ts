// Integration tests for the Hendrix HTTP route shell at
// apps/server/src/routes/hendrix.ts.
//
// Scope: the route's translation layer only — request validation, slug-vs-
// store-id auth branching, free-tier outcome-selection guard, error mapping,
// dispatch into `lib/hendrix.ts` (nextQueue) and `lib/outcomeSchedule.ts`
// (setOverride / clearOverride), and the playback-event side-effects on
// outcome-selection. The heavy queue-building logic in `lib/hendrix.ts` is
// fully mocked — that surface is covered by `apps/server/src/lib/hendrix.test.ts`.
//
// Auth model recap (the route has two parallel paths):
//   - store_id  : operator-authed. Bearer token verified via verify(); the
//                 account must be authorized for that store. 401 / 403 on fail.
//   - slug      : slug-as-auth for the freemium player at music.entuned.co/:slug.
//                 No token required; the slug IS the credential. Archived stores
//                 still return 404.
// 400 fires only when neither store_id nor slug is provided. The two-way
// branching is the most error-prone bit of the file — most tests pin it.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Prisma mock. Path is literal relative to this file (route reads
// '../db.js'). Only the models the ROUTE touches directly are listed — the
// lib/hendrix internals get their own mock via vi.mock('../lib/hendrix.js')
// below, so prisma.lineageRow / playbackRules / etc. don't leak in.
vi.mock('../db.js', () => ({
  prisma: {
    store: {
      findUnique: vi.fn(),
    },
    outcome: {
      findMany: vi.fn(),
    },
    freeTierOutcome: {
      findMany: vi.fn(),
    },
    lineageRow: {
      groupBy: vi.fn(),
    },
    playbackEvent: {
      create: vi.fn(),
    },
  },
}))

// Mock the lib the route dispatches into. Fully replace — we don't want any
// real nextQueue/setOverride/clearOverride logic running here.
vi.mock('../lib/hendrix.js', () => ({
  nextQueue: vi.fn(),
}))
vi.mock('../lib/outcomeSchedule.js', () => ({
  setOverride: vi.fn(),
  clearOverride: vi.fn(),
}))

// outcomes / tier / auth helpers — mocked so we control the free-tier guard
// and the operator-auth gate from the test directly.
vi.mock('../lib/outcomes.js', () => ({
  isFreeTierAllowedOutcome: vi.fn(),
}))
vi.mock('../lib/tier.js', () => ({
  effectiveTier: vi.fn(),
}))
vi.mock('../lib/auth.js', () => ({
  verify: vi.fn(),
  isAccountAuthorizedForStore: vi.fn(),
}))

import { hendrixRoutes } from './hendrix.js'
import { prisma } from '../db.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'
import { nextQueue } from '../lib/hendrix.js'
import { setOverride, clearOverride } from '../lib/outcomeSchedule.js'
import { isFreeTierAllowedOutcome } from '../lib/outcomes.js'
import { effectiveTier } from '../lib/tier.js'
import { verify, isAccountAuthorizedForStore } from '../lib/auth.js'

const storeFindUnique = prisma.store.findUnique as ReturnType<typeof vi.fn>
const outcomeFindMany = prisma.outcome.findMany as ReturnType<typeof vi.fn>
const freeTierFindMany = prisma.freeTierOutcome.findMany as ReturnType<typeof vi.fn>
const lineageGroupBy = prisma.lineageRow.groupBy as ReturnType<typeof vi.fn>
const playbackEventCreate = prisma.playbackEvent.create as ReturnType<typeof vi.fn>
const nextQueueMock = nextQueue as ReturnType<typeof vi.fn>
const setOverrideMock = setOverride as ReturnType<typeof vi.fn>
const clearOverrideMock = clearOverride as ReturnType<typeof vi.fn>
const isFreeTierAllowedOutcomeMock = isFreeTierAllowedOutcome as ReturnType<typeof vi.fn>
const effectiveTierMock = effectiveTier as ReturnType<typeof vi.fn>
const verifyMock = verify as ReturnType<typeof vi.fn>
const isAccountAuthorizedForStoreMock = isAccountAuthorizedForStore as ReturnType<typeof vi.fn>

const STORE_ID = '11111111-1111-1111-1111-111111111111'
const OUTCOME_ID = '22222222-2222-2222-2222-222222222222'
const ACCOUNT_ID = '33333333-3333-3333-3333-333333333333'
const SLUG = 'test-store-slug'
const BEARER = 'Bearer fake-jwt-token'

function happyNextQueueResponse() {
  return {
    storeId: STORE_ID,
    decidedAt: '2026-05-18T12:00:00.000Z',
    activeOutcome: null,
    queue: [],
    fallbackTier: 'normal' as const,
    reason: null,
    roomLoudnessSamplingEnabled: false,
  }
}

describe('hendrix routes', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — several tests below set per-test
    // mockRejectedValue / mockResolvedValue on the shared lib mocks; the
    // TESTING.md gotcha section explicitly calls out this exact failure mode.
    vi.resetAllMocks()
  })

  // ----------------------------------------------------------------------
  // GET /next
  // ----------------------------------------------------------------------

  describe('GET /next', () => {
    it('returns 200 with the lib/hendrix nextQueue payload on the operator path', async () => {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(true)
      const payload = happyNextQueueResponse()
      nextQueueMock.mockResolvedValue(payload)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/next?store_id=${STORE_ID}`,
        headers: { authorization: BEARER },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(payload)
      // Pin dispatch: route passes the resolved storeId + a Date + allOutcomes:false.
      expect(nextQueueMock).toHaveBeenCalledTimes(1)
      const [calledStoreId, calledDate, calledOpts] = nextQueueMock.mock.calls[0]
      expect(calledStoreId).toBe(STORE_ID)
      expect(calledDate).toBeInstanceOf(Date)
      expect(calledOpts).toEqual({ allOutcomes: false })
    })

    it('resolves slug to storeId and bypasses auth on the slug-as-auth path', async () => {
      storeFindUnique.mockResolvedValue({ id: STORE_ID, archivedAt: null })
      nextQueueMock.mockResolvedValue(happyNextQueueResponse())

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/next?slug=${SLUG}` })

      expect(res.statusCode).toBe(200)
      expect(storeFindUnique).toHaveBeenCalledWith({
        where: { slug: SLUG },
        select: { id: true, archivedAt: true },
      })
      expect(verifyMock).not.toHaveBeenCalled()
      expect(isAccountAuthorizedForStoreMock).not.toHaveBeenCalled()
      expect(nextQueueMock).toHaveBeenCalledWith(STORE_ID, expect.any(Date), { allOutcomes: false })
    })

    it('passes allOutcomes:true through to nextQueue when all_outcomes=true query param is set', async () => {
      storeFindUnique.mockResolvedValue({ id: STORE_ID, archivedAt: null })
      nextQueueMock.mockResolvedValue(happyNextQueueResponse())

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/next?slug=${SLUG}&all_outcomes=true` })

      expect(res.statusCode).toBe(200)
      expect(nextQueueMock).toHaveBeenCalledWith(STORE_ID, expect.any(Date), { allOutcomes: true })
    })

    it('only treats all_outcomes=true (literal string) as truthy — other values are false', async () => {
      storeFindUnique.mockResolvedValue({ id: STORE_ID, archivedAt: null })
      nextQueueMock.mockResolvedValue(happyNextQueueResponse())

      const app = await buildTestApp(hendrixRoutes)
      await app.inject({ method: 'GET', url: `/next?slug=${SLUG}&all_outcomes=1` })

      expect(nextQueueMock).toHaveBeenCalledWith(STORE_ID, expect.any(Date), { allOutcomes: false })
    })

    it('returns 404 when the slug-resolved store is archived', async () => {
      storeFindUnique.mockResolvedValue({ id: STORE_ID, archivedAt: new Date('2026-01-01T00:00:00Z') })

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/next?slug=${SLUG}` })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_not_found' })
      expect(nextQueueMock).not.toHaveBeenCalled()
    })

    it('returns 404 when the slug does not match any store', async () => {
      storeFindUnique.mockResolvedValue(null)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/next?slug=missing` })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_not_found' })
    })

    it('returns 400 when neither store_id nor slug is provided', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: '/next' })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'need_store_id_or_slug' })
    })

    it('returns 400 when store_id is not a valid uuid (zod failure)', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: '/next?store_id=not-a-uuid' })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error).toBe('bad_query')
      expect(body.details).toBeDefined()
    })

    it('returns 401 on the operator path when Authorization header is missing', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/next?store_id=${STORE_ID}` })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
      expect(verifyMock).not.toHaveBeenCalled()
    })

    it('returns 401 when the bearer token does not verify', async () => {
      verifyMock.mockReturnValue(null)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/next?store_id=${STORE_ID}`,
        headers: { authorization: BEARER },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'invalid_token' })
      expect(isAccountAuthorizedForStoreMock).not.toHaveBeenCalled()
    })

    it('returns 403 when the account is not authorized for the store', async () => {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(false)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/next?store_id=${STORE_ID}`,
        headers: { authorization: BEARER },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: 'forbidden' })
      expect(nextQueueMock).not.toHaveBeenCalled()
    })

    it('prefers store_id over slug when both are supplied (operator path wins; auth is enforced)', async () => {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(true)
      nextQueueMock.mockResolvedValue(happyNextQueueResponse())

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/next?store_id=${STORE_ID}&slug=${SLUG}`,
        headers: { authorization: BEARER },
      })

      expect(res.statusCode).toBe(200)
      // Slug-lookup path is skipped — only the operator authz check is hit.
      expect(storeFindUnique).not.toHaveBeenCalled()
      expect(isAccountAuthorizedForStoreMock).toHaveBeenCalledWith(ACCOUNT_ID, STORE_ID)
    })
  })

  // ----------------------------------------------------------------------
  // GET /outcomes
  // ----------------------------------------------------------------------

  describe('GET /outcomes', () => {
    function setupOutcomesHappy(opts: { icpIds?: string[]; counts?: Array<{ outcomeId: string; _count: { _all: number } }> } = {}) {
      const icpIds = opts.icpIds ?? ['icp-1']
      storeFindUnique
        // First call: slug-resolve / operator-check (only fires on slug path)
        // Second call: the include-icpLinks lookup further down
        .mockResolvedValueOnce({ id: STORE_ID, archivedAt: null })
        .mockResolvedValueOnce({
          id: STORE_ID,
          icpLinks: icpIds.map((id) => ({ icpId: id })),
        })
      outcomeFindMany.mockResolvedValue([
        { id: OUTCOME_ID, outcomeKey: 'energize', title: 'Energize', displayTitle: 'Morning Energize', tempoBpm: 120, mode: 'major' },
        { id: 'outcome-2', outcomeKey: 'wind_down', title: 'Wind Down', displayTitle: null, tempoBpm: 80, mode: 'minor' },
      ])
      freeTierFindMany.mockResolvedValue([{ outcomeKey: 'energize' }])
      lineageGroupBy.mockResolvedValue(opts.counts ?? [{ outcomeId: OUTCOME_ID, _count: { _all: 5 } }])
    }

    it('returns 200 with annotated outcomes (poolSize + availableOnFree) on the slug path', async () => {
      setupOutcomesHappy()

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/outcomes?slug=${SLUG}` })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([
        {
          outcomeId: OUTCOME_ID,
          outcomeKey: 'energize',
          title: 'Morning Energize', // displayTitle preferred over title
          tempoBpm: 120,
          mode: 'major',
          poolSize: 5,
          availableOnFree: true,
        },
        {
          outcomeId: 'outcome-2',
          outcomeKey: 'wind_down',
          title: 'Wind Down', // fell back to title when displayTitle is null
          tempoBpm: 80,
          mode: 'minor',
          poolSize: 0, // no LineageRows for this outcomeId
          availableOnFree: false,
        },
      ])
    })

    it('skips the LineageRow.groupBy call when the store has zero ICPs (load-bearing perf guard)', async () => {
      // Free-tier ICP join always links a store to the Free Tier ICP, so icpIds=[]
      // shouldn't happen in prod — but the route defensively skips groupBy when
      // it does, and that branch is worth pinning so a refactor can't reintroduce
      // the unbounded query.
      setupOutcomesHappy({ icpIds: [], counts: [] })

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/outcomes?slug=${SLUG}` })

      expect(res.statusCode).toBe(200)
      expect(lineageGroupBy).not.toHaveBeenCalled()
      // All outcomes report poolSize: 0.
      expect(res.json().every((o: any) => o.poolSize === 0)).toBe(true)
    })

    it('returns 200 on the operator path when the bearer token is authorized', async () => {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(true)
      // operator path only hits storeFindUnique ONCE (the icpLinks lookup)
      storeFindUnique.mockResolvedValueOnce({ id: STORE_ID, icpLinks: [{ icpId: 'icp-1' }] })
      outcomeFindMany.mockResolvedValue([])
      freeTierFindMany.mockResolvedValue([])
      lineageGroupBy.mockResolvedValue([])

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'GET',
        url: `/outcomes?store_id=${STORE_ID}`,
        headers: { authorization: BEARER },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual([])
    })

    it('returns 404 when slug resolves to an archived store', async () => {
      storeFindUnique.mockResolvedValueOnce({ id: STORE_ID, archivedAt: new Date('2026-01-01') })

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/outcomes?slug=${SLUG}` })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_not_found' })
    })

    it('returns 401 on the operator path when no bearer token is supplied', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: `/outcomes?store_id=${STORE_ID}` })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    })

    it('returns 400 when neither store_id nor slug is provided', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: '/outcomes' })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'need_store_id_or_slug' })
    })

    it('returns 400 when store_id is not a valid uuid', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({ method: 'GET', url: '/outcomes?store_id=not-a-uuid' })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'bad_query' })
    })
  })

  // ----------------------------------------------------------------------
  // POST /outcome-selection
  // ----------------------------------------------------------------------

  describe('POST /outcome-selection', () => {
    const SELECTION_EXPIRES = new Date('2026-05-18T18:00:00.000Z')

    function setupOpHappyPath() {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(true)
      // tier lookup row
      storeFindUnique.mockResolvedValueOnce({ tier: 'pro', compTier: null, compExpiresAt: null })
      effectiveTierMock.mockReturnValue('pro')
      setOverrideMock.mockResolvedValue({ outcomeId: OUTCOME_ID, expiresAt: SELECTION_EXPIRES })
      playbackEventCreate.mockResolvedValue({})
    }

    it('returns 200 with { outcomeId, expiresAt } and writes a playback event (operator path)', async () => {
      setupOpHappyPath()

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        headers: { authorization: BEARER },
        payload: { store_id: STORE_ID, outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        outcomeId: OUTCOME_ID,
        expiresAt: SELECTION_EXPIRES.toISOString(),
      })
      expect(setOverrideMock).toHaveBeenCalledWith(STORE_ID, OUTCOME_ID)
      // Operator path attaches accountId on the event.
      expect(playbackEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'outcome_selection',
          storeId: STORE_ID,
          accountId: ACCOUNT_ID,
          outcomeId: OUTCOME_ID,
        }),
      })
    })

    it('writes a null accountId on the slug path (no operator identity available)', async () => {
      storeFindUnique
        .mockResolvedValueOnce({ id: STORE_ID, archivedAt: null }) // slug resolve
        .mockResolvedValueOnce({ tier: 'pro', compTier: null, compExpiresAt: null }) // tier lookup
      effectiveTierMock.mockReturnValue('pro')
      setOverrideMock.mockResolvedValue({ outcomeId: OUTCOME_ID, expiresAt: SELECTION_EXPIRES })
      playbackEventCreate.mockResolvedValue({})

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        payload: { slug: SLUG, outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(playbackEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'outcome_selection',
          storeId: STORE_ID,
          accountId: null,
          outcomeId: OUTCOME_ID,
        }),
      })
    })

    it('returns 409 outcome_not_in_free_tier_allowlist when a free-tier store picks a non-allowlisted outcome', async () => {
      storeFindUnique
        .mockResolvedValueOnce({ id: STORE_ID, archivedAt: null }) // slug resolve
        .mockResolvedValueOnce({ tier: 'free', compTier: null, compExpiresAt: null })
      effectiveTierMock.mockReturnValue('free')
      isFreeTierAllowedOutcomeMock.mockResolvedValue(false)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        payload: { slug: SLUG, outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toEqual({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
      expect(setOverrideMock).not.toHaveBeenCalled()
      expect(playbackEventCreate).not.toHaveBeenCalled()
    })

    it('lets a free-tier store select an outcome that IS in the allowlist', async () => {
      storeFindUnique
        .mockResolvedValueOnce({ id: STORE_ID, archivedAt: null })
        .mockResolvedValueOnce({ tier: 'free', compTier: null, compExpiresAt: null })
      effectiveTierMock.mockReturnValue('free')
      isFreeTierAllowedOutcomeMock.mockResolvedValue(true)
      setOverrideMock.mockResolvedValue({ outcomeId: OUTCOME_ID, expiresAt: SELECTION_EXPIRES })
      playbackEventCreate.mockResolvedValue({})

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        payload: { slug: SLUG, outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(setOverrideMock).toHaveBeenCalledWith(STORE_ID, OUTCOME_ID)
    })

    it('returns 404 with the lib error message when setOverride throws (e.g. store not found)', async () => {
      setupOpHappyPath()
      setOverrideMock.mockRejectedValue(new Error('store not found: xxx'))

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        headers: { authorization: BEARER },
        payload: { store_id: STORE_ID, outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store not found: xxx' })
      expect(playbackEventCreate).not.toHaveBeenCalled()
    })

    it('returns 400 when outcome_id is missing', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        payload: { slug: SLUG },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'bad_body' })
    })

    it('returns 400 when neither store_id nor slug is provided', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        payload: { outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'need_store_id_or_slug' })
    })

    it('returns 401 on the operator path with no bearer token', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection',
        payload: { store_id: STORE_ID, outcome_id: OUTCOME_ID },
      })

      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    })
  })

  // ----------------------------------------------------------------------
  // POST /outcome-selection/clear
  // ----------------------------------------------------------------------

  describe('POST /outcome-selection/clear', () => {
    it('returns 200 { ok: true } and writes a cleared playback event (operator path)', async () => {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(true)
      clearOverrideMock.mockResolvedValue(undefined)
      playbackEventCreate.mockResolvedValue({})

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection/clear',
        headers: { authorization: BEARER },
        payload: { store_id: STORE_ID },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      expect(clearOverrideMock).toHaveBeenCalledWith(STORE_ID)
      expect(playbackEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'outcome_selection_cleared',
          storeId: STORE_ID,
          accountId: ACCOUNT_ID,
        }),
      })
    })

    it('writes a null accountId on the slug path', async () => {
      storeFindUnique.mockResolvedValueOnce({ id: STORE_ID, archivedAt: null })
      clearOverrideMock.mockResolvedValue(undefined)
      playbackEventCreate.mockResolvedValue({})

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection/clear',
        payload: { slug: SLUG },
      })

      expect(res.statusCode).toBe(200)
      expect(playbackEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'outcome_selection_cleared',
          storeId: STORE_ID,
          accountId: null,
        }),
      })
    })

    it('returns 404 when slug does not resolve', async () => {
      storeFindUnique.mockResolvedValueOnce(null)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection/clear',
        payload: { slug: 'missing' },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'store_not_found' })
      expect(clearOverrideMock).not.toHaveBeenCalled()
    })

    it('returns 400 when neither store_id nor slug is provided', async () => {
      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection/clear',
        payload: {},
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'need_store_id_or_slug' })
    })

    it('returns 403 when the operator is not authorized for the store', async () => {
      verifyMock.mockReturnValue({ accountId: ACCOUNT_ID })
      isAccountAuthorizedForStoreMock.mockResolvedValue(false)

      const app = await buildTestApp(hendrixRoutes)
      const res = await app.inject({
        method: 'POST',
        url: '/outcome-selection/clear',
        headers: { authorization: BEARER },
        payload: { store_id: STORE_ID },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ error: 'forbidden' })
      expect(clearOverrideMock).not.toHaveBeenCalled()
    })
  })
})
