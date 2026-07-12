// Integration tests for the audio-event ingest route.
//
// Pins the player-traffic path: zod allow-list, quarantine fallback, batch
// handling, idempotency-key dedupe (via Prisma skipDuplicates), hook auto-fill
// from LineageRow, campaign play-state counter side effects, and the
// authed GET /loved endpoint.
//
// All Prisma calls are mocked. No DB, no auth library, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Prisma mock — must be a literal call at top level. The events
// route imports prisma from '../db.js'; path is relative to THIS file.
vi.mock('../db.js', () => ({
  prisma: {
    playbackEvent: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    playbackEventRaw: {
      create: vi.fn(),
    },
    lineageRow: {
      findMany: vi.fn(),
    },
    campaignPlayState: {
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    campaignAssetState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    adAsset: {
      count: vi.fn(),
    },
    store: {
      findUnique: vi.fn(),
    },
  },
}))

// Stub the auth lib — `verify` accepts a magic token; `isAccountAuthorizedForStore`
// returns true unless a test overrides it. The route imports both from
// '../lib/auth.js'.
vi.mock('../lib/auth.js', () => ({
  verify: vi.fn((token: string) => {
    if (token === 'good-token') {
      return {
        accountId: '00000000-0000-0000-0000-000000000aaa',
        email: 'op@example.com',
        isAdmin: false,
        tv: 1,
        exp: Date.now() + 60_000,
      }
    }
    return null
  }),
  isAccountAuthorizedForStore: vi.fn(async () => true),
}))

import { eventsRoutes } from './events.js'
import { prisma } from '../db.js'
import { isAccountAuthorizedForStore } from '../lib/auth.js'
import { buildTestApp } from '../test-utils/fastifyApp.js'

const createManyMock = prisma.playbackEvent.createMany as ReturnType<typeof vi.fn>
const findManyEventsMock = prisma.playbackEvent.findMany as ReturnType<typeof vi.fn>
const rawCreateMock = prisma.playbackEventRaw.create as ReturnType<typeof vi.fn>
const lineageFindManyMock = prisma.lineageRow.findMany as ReturnType<typeof vi.fn>
const cpsUpdateManyMock = prisma.campaignPlayState.updateMany as ReturnType<typeof vi.fn>
const cpsUpsertMock = prisma.campaignPlayState.upsert as ReturnType<typeof vi.fn>
const casFindUniqueMock = prisma.campaignAssetState.findUnique as ReturnType<typeof vi.fn>
const casUpsertMock = prisma.campaignAssetState.upsert as ReturnType<typeof vi.fn>
const adAssetCountMock = prisma.adAsset.count as ReturnType<typeof vi.fn>
const storeFindUniqueMock = prisma.store.findUnique as ReturnType<typeof vi.fn>
const authMock = isAccountAuthorizedForStore as ReturnType<typeof vi.fn>

// All POST / tests below authenticate as an operator (Bearer good-token); the
// mocked `isAccountAuthorizedForStore` returns true by default so the store
// scope check passes. Auth-specific paths (missing/invalid credential, wrong
// store, slug mode) are exercised in the dedicated 'POST / — auth' block.
const AUTHED = { authorization: 'Bearer good-token' }

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const SONG_ID = '00000000-0000-0000-0000-00000000beef'
const HOOK_ID = '00000000-0000-0000-0000-00000000face'
const OUTCOME_ID = '00000000-0000-0000-0000-00000000c0de'
const OPERATOR_ID = '00000000-0000-0000-0000-00000000a11c'
const SESSION_ID = '00000000-0000-0000-0000-00000000dead'
const EFFECTIVE_OUTCOME_ID = '00000000-0000-0000-0000-00000000ef0c'

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'song_start',
    store_id: STORE_ID,
    occurred_at: '2026-05-18T12:00:00.000Z',
    ...overrides,
  }
}

describe('POST /', () => {
  beforeEach(() => {
    // resetAllMocks so per-test mockResolvedValue / mockImplementation calls
    // don't leak into the next test (TESTING.md gotcha). Re-install defaults.
    vi.resetAllMocks()
    createManyMock.mockResolvedValue({ count: 1 })
    rawCreateMock.mockResolvedValue({ id: 'raw-1' })
    lineageFindManyMock.mockResolvedValue([])
    cpsUpdateManyMock.mockResolvedValue({ count: 0 })
    cpsUpsertMock.mockResolvedValue({})
    casFindUniqueMock.mockResolvedValue(null)
    casUpsertMock.mockResolvedValue({})
    adAssetCountMock.mockResolvedValue(0)
  })

  it('accepts a single valid event and returns 201 with accepted=1', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent(),
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ accepted: 1, quarantined: 0 })
    expect(createManyMock).toHaveBeenCalledTimes(1)
    const arg = createManyMock.mock.calls[0]![0]
    expect(arg.skipDuplicates).toBe(true)
    expect(arg.data).toHaveLength(1)
    expect(arg.data[0]).toMatchObject({
      eventType: 'song_start',
      storeId: STORE_ID,
      occurredAt: new Date('2026-05-18T12:00:00.000Z'),
    })
  })

  it('quarantines an event with an unknown event_type and returns 202', async () => {
    createManyMock.mockResolvedValue({ count: 0 })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'this_is_not_real' }),
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ accepted: 0, quarantined: 1 })
    expect(rawCreateMock).toHaveBeenCalledTimes(1)
    const raw = rawCreateMock.mock.calls[0]![0]
    expect(raw.data.eventType).toBe('this_is_not_real')
    expect(raw.data.storeId).toBe(STORE_ID)
    // playbackEvent.createMany should not have been called for an empty batch.
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('quarantines a payload with a non-uuid store_id and skips main insert', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ store_id: 'not-a-uuid' }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalledTimes(1)
    // Non-uuid store_id should not bleed into the quarantine row's storeId column.
    expect(rawCreateMock.mock.calls[0]![0].data.storeId).toBeNull()
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('quarantines events with bad occurred_at datetime', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ occurred_at: 'not-a-date' }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
  })

  it('accepts a batch with mixed valid and invalid events', async () => {
    createManyMock.mockResolvedValue({ count: 2 })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: {
        events: [
          baseEvent({ event_type: 'song_start' }),
          baseEvent({ event_type: 'song_complete', completion_reason: 'ended' }),
          baseEvent({ event_type: 'bogus_event' }),
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ accepted: 2, quarantined: 1 })
    expect(rawCreateMock).toHaveBeenCalledTimes(1)
    expect(createManyMock).toHaveBeenCalledTimes(1)
    expect(createManyMock.mock.calls[0]![0].data).toHaveLength(2)
  })

  it('rejects a batch envelope with no events (zod parse throws)', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: { events: [] },
    })

    // BatchSchema.parse throws on min(1) — the global Fastify error handler
    // surfaces it as a 500. Either way createMany should NOT have been called.
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('translates wire-format report_reason ("Not our Vibe") to the prisma identifier', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        event_type: 'song_report',
        song_id: SONG_ID,
        report_reason: 'Not our Vibe',
      }),
    })

    expect(res.statusCode).toBe(201)
    expect(createManyMock.mock.calls[0]![0].data[0].reportReason).toBe('NotOurVibe')
  })

  it('rejects an unknown report_reason via quarantine path (zod enum)', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        event_type: 'song_report',
        song_id: SONG_ID,
        report_reason: 'Made Up Reason',
      }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
  })

  it('auto-fills hook_id from LineageRow when song_id is present but hook_id is missing', async () => {
    lineageFindManyMock.mockResolvedValue([
      { songId: SONG_ID, hookId: HOOK_ID },
    ])
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'song_complete', song_id: SONG_ID, completion_reason: 'ended' }),
    })

    expect(res.statusCode).toBe(201)
    expect(lineageFindManyMock).toHaveBeenCalledWith({
      where: { songId: { in: [SONG_ID] } },
      select: { songId: true, hookId: true },
    })
    expect(createManyMock.mock.calls[0]![0].data[0].hookId).toBe(HOOK_ID)
  })

  it('does not look up LineageRow when hook_id is already provided on the event', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'song_start', song_id: SONG_ID, hook_id: HOOK_ID }),
    })

    expect(res.statusCode).toBe(201)
    expect(lineageFindManyMock).not.toHaveBeenCalled()
    expect(createManyMock.mock.calls[0]![0].data[0].hookId).toBe(HOOK_ID)
  })

  it('leaves hookId null when LineageRow has no match for the song', async () => {
    lineageFindManyMock.mockResolvedValue([]) // no rows
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'song_start', song_id: SONG_ID }),
    })

    expect(res.statusCode).toBe(201)
    expect(createManyMock.mock.calls[0]![0].data[0].hookId).toBeNull()
  })

  it('passes skipDuplicates=true so the idempotency_key unique index dedupes retries', async () => {
    const app = await buildTestApp(eventsRoutes)
    const ev = baseEvent({
      event_type: 'song_start',
      idempotency_key: 'abc12345-retry-key',
    })
    const res = await app.inject({ method: 'POST', url: '/', headers: AUTHED, payload: ev })

    expect(res.statusCode).toBe(201)
    expect(createManyMock.mock.calls[0]![0].skipDuplicates).toBe(true)
    expect(createManyMock.mock.calls[0]![0].data[0].idempotencyKey).toBe('abc12345-retry-key')
  })

  it('quarantines events whose idempotency_key is shorter than the schema min(8)', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ idempotency_key: 'short' }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
  })

  it('preserves Phase-3 correlation fields (playback_session_id, device_id, etc.) on insert', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        event_type: 'heartbeat',
        playback_session_id: SESSION_ID,
        device_id: 'ipad-front-counter-1',
        play_duration_ms: 60000,
        effective_outcome_id: EFFECTIVE_OUTCOME_ID,
        client_sent_at: '2026-05-18T12:00:01.000Z',
        client_build: 'player@2026.05.18-abc',
        extra: { is_playing: true, queue_depth: 4 },
      }),
    })

    expect(res.statusCode).toBe(201)
    const row = createManyMock.mock.calls[0]![0].data[0]
    expect(row).toMatchObject({
      eventType: 'heartbeat',
      playbackSessionId: SESSION_ID,
      deviceId: 'ipad-front-counter-1',
      playDurationMs: 60000,
      effectiveOutcomeId: EFFECTIVE_OUTCOME_ID,
      clientBuild: 'player@2026.05.18-abc',
    })
    expect(row.clientSentAt).toBeInstanceOf(Date)
    expect(row.extra).toEqual({ is_playing: true, queue_depth: 4 })
  })

  it('rejects device_id over 80 chars to quarantine', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ device_id: 'x'.repeat(81) }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
  })

  it('rejects negative play_duration_ms to quarantine', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ play_duration_ms: -1 }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
  })

  it('rejects an unknown completion_reason value to quarantine', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        event_type: 'song_complete',
        completion_reason: 'cancelled',
      }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
  })

  it('increments songs_played_since_ad once per song_complete (excluding errored)', async () => {
    createManyMock.mockResolvedValue({ count: 3 })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: {
        events: [
          baseEvent({ event_type: 'song_complete', completion_reason: 'ended' }),
          baseEvent({ event_type: 'song_complete', completion_reason: 'skipped' }),
          baseEvent({ event_type: 'song_complete', completion_reason: 'errored' }),
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    expect(cpsUpdateManyMock).toHaveBeenCalledTimes(1)
    expect(cpsUpdateManyMock).toHaveBeenCalledWith({
      where: { storeId: STORE_ID },
      data: { songsPlayedSinceAd: { increment: 2 } },
    })
  })

  it('folds a straddling [complete, complete, ad_play, complete] batch to songsPlayedSinceAd=1 (SRV-3)', async () => {
    // Offline-flushed batch: an ad_play sits chronologically BETWEEN completes.
    // Old code applied all +increments first (+3) then reset to 0, losing the
    // post-ad completion. Correct post-ad counter is 1 (one complete after the
    // last ad). The counter drifts LOW otherwise, firing the next ad late.
    createManyMock.mockResolvedValue({ count: 4 })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: {
        events: [
          baseEvent({ event_type: 'song_complete', completion_reason: 'ended', occurred_at: '2026-05-18T12:00:00.000Z' }),
          baseEvent({ event_type: 'song_complete', completion_reason: 'ended', occurred_at: '2026-05-18T12:01:00.000Z' }),
          baseEvent({ event_type: 'ad_play', occurred_at: '2026-05-18T12:02:00.000Z' }),
          baseEvent({ event_type: 'song_complete', completion_reason: 'ended', occurred_at: '2026-05-18T12:03:00.000Z' }),
        ],
      },
    })

    expect(res.statusCode).toBe(201)
    // The batch contains an ad_play, so the counter is set absolutely to the
    // post-ad completion count (1) — NOT incremented, NOT reset to 0.
    expect(cpsUpsertMock).toHaveBeenCalledTimes(1)
    expect(cpsUpsertMock).toHaveBeenCalledWith({
      where: { storeId: STORE_ID },
      update: { songsPlayedSinceAd: 1 },
      create: { storeId: STORE_ID, songsPlayedSinceAd: 1 },
    })
    // No blind increment path when an ad reset the counter mid-batch.
    expect(cpsUpdateManyMock).not.toHaveBeenCalled()
  })

  it('does not increment CampaignPlayState for non-completion events', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'song_start' }),
    })

    expect(res.statusCode).toBe(201)
    expect(cpsUpdateManyMock).not.toHaveBeenCalled()
  })

  it('upserts CampaignPlayState to 0 on ad_play and advances CampaignAssetState when a campaign has assets', async () => {
    adAssetCountMock.mockResolvedValue(3)
    casFindUniqueMock.mockResolvedValue({ campaignId: 'camp-1', nextAssetIndex: 1 })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        event_type: 'ad_play',
        extra: { campaignId: 'camp-1' },
      }),
    })

    expect(res.statusCode).toBe(201)
    expect(cpsUpsertMock).toHaveBeenCalledWith({
      where: { storeId: STORE_ID },
      update: { songsPlayedSinceAd: 0 },
      create: { storeId: STORE_ID, songsPlayedSinceAd: 0 },
    })
    expect(adAssetCountMock).toHaveBeenCalledWith({ where: { campaignId: 'camp-1' } })
    expect(casUpsertMock).toHaveBeenCalledWith({
      where: { campaignId: 'camp-1' },
      update: { nextAssetIndex: 2 },
      create: { campaignId: 'camp-1', nextAssetIndex: 2 },
    })
  })

  it('wraps CampaignAssetState.nextAssetIndex modulo asset count', async () => {
    adAssetCountMock.mockResolvedValue(3)
    // currently on index 2 (last); next should wrap to 0.
    casFindUniqueMock.mockResolvedValue({ campaignId: 'camp-1', nextAssetIndex: 2 })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'ad_play', extra: { campaignId: 'camp-1' } }),
    })

    expect(res.statusCode).toBe(201)
    expect(casUpsertMock).toHaveBeenCalledWith({
      where: { campaignId: 'camp-1' },
      update: { nextAssetIndex: 0 },
      create: { campaignId: 'camp-1', nextAssetIndex: 0 },
    })
  })

  it('skips CampaignAssetState advance when the campaign has no assets', async () => {
    adAssetCountMock.mockResolvedValue(0)
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'ad_play', extra: { campaignId: 'camp-empty' } }),
    })

    expect(res.statusCode).toBe(201)
    expect(cpsUpsertMock).toHaveBeenCalled()
    expect(casUpsertMock).not.toHaveBeenCalled()
  })

  it('still resets CampaignPlayState on ad_play even with no campaignId in extra', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'ad_play' }),
    })

    expect(res.statusCode).toBe(201)
    expect(cpsUpsertMock).toHaveBeenCalledWith({
      where: { storeId: STORE_ID },
      update: { songsPlayedSinceAd: 0 },
      create: { storeId: STORE_ID, songsPlayedSinceAd: 0 },
    })
    // No campaignId → asset state shouldn't be touched.
    expect(adAssetCountMock).not.toHaveBeenCalled()
    expect(casUpsertMock).not.toHaveBeenCalled()
  })

  it('parses occurred_at and client_sent_at as Date objects', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        occurred_at: '2026-05-18T12:00:00.000Z',
        client_sent_at: '2026-05-18T12:00:05.000Z',
      }),
    })

    expect(res.statusCode).toBe(201)
    const row = createManyMock.mock.calls[0]![0].data[0]
    expect(row.occurredAt).toBeInstanceOf(Date)
    expect(row.occurredAt.toISOString()).toBe('2026-05-18T12:00:00.000Z')
    expect(row.clientSentAt).toBeInstanceOf(Date)
    expect(row.clientSentAt.toISOString()).toBe('2026-05-18T12:00:05.000Z')
  })

  it('quarantines timestamps without the Z suffix (zod .datetime() rejects offsets by default)', async () => {
    // Documents the current contract: clients MUST send UTC with Z. An offset
    // timestamp like '2026-05-18T12:00:00.000-06:00' is rejected by the strict
    // datetime parser and routed to PlaybackEventRaw rather than dropped.
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ occurred_at: '2026-05-18T12:00:00.000-06:00' }),
    })

    expect(res.statusCode).toBe(202)
    expect(rawCreateMock).toHaveBeenCalled()
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('rejects a batch larger than 500 events', async () => {
    const events = Array.from({ length: 501 }, () => baseEvent())
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: { events },
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('writes nullable fields as null on the playbackEvent row when omitted', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({ event_type: 'song_start' }),
    })

    expect(res.statusCode).toBe(201)
    const row = createManyMock.mock.calls[0]![0].data[0]
    expect(row.accountId).toBeNull()
    expect(row.songId).toBeNull()
    expect(row.hookId).toBeNull()
    expect(row.reportReason).toBeNull()
    expect(row.outcomeId).toBeNull()
    expect(row.playbackSessionId).toBeNull()
    expect(row.deviceId).toBeNull()
    expect(row.idempotencyKey).toBeNull()
  })

  it('maps operator_id (wire) → accountId (column) and outcome_id → outcomeId', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent({
        event_type: 'outcome_selection',
        operator_id: OPERATOR_ID,
        outcome_id: OUTCOME_ID,
      }),
    })

    expect(res.statusCode).toBe(201)
    const row = createManyMock.mock.calls[0]![0].data[0]
    expect(row.accountId).toBe(OPERATOR_ID)
    expect(row.outcomeId).toBe(OUTCOME_ID)
  })
})

describe('POST / — auth (SEC-3)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    createManyMock.mockResolvedValue({ count: 1 })
    rawCreateMock.mockResolvedValue({ id: 'raw-1' })
    lineageFindManyMock.mockResolvedValue([])
    cpsUpdateManyMock.mockResolvedValue({ count: 0 })
    cpsUpsertMock.mockResolvedValue({})
    casFindUniqueMock.mockResolvedValue(null)
    casUpsertMock.mockResolvedValue({})
    adAssetCountMock.mockResolvedValue(0)
  })

  it('rejects an unauthenticated POST (no bearer, no slug) with 401 and writes nothing', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({ method: 'POST', url: '/', payload: baseEvent() })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
    // The whole point of SEC-3: an anonymous caller creates no rows at all —
    // not even a quarantine row for a malformed flood.
    expect(createManyMock).not.toHaveBeenCalled()
    expect(rawCreateMock).not.toHaveBeenCalled()
  })

  it('does not quarantine even a malformed event when unauthenticated', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      payload: baseEvent({ event_type: 'totally_bogus' }),
    })

    expect(res.statusCode).toBe(401)
    expect(rawCreateMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid bearer token with 401 invalid_token', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: { authorization: 'Bearer nope' },
      payload: baseEvent(),
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_token' })
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('rejects a bearer not authorized for the event store with 403', async () => {
    authMock.mockResolvedValue(false)
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent(),
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden' })
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('accepts an authorized bearer and writes the event (201)', async () => {
    authMock.mockResolvedValue(true)
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/',
      headers: AUTHED,
      payload: baseEvent(),
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ accepted: 1, quarantined: 0 })
    expect(createManyMock).toHaveBeenCalledTimes(1)
  })

  it('accepts slug-mode auth when the slug resolves to the event store (201)', async () => {
    storeFindUniqueMock.mockResolvedValue({ id: STORE_ID, archivedAt: null })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/?slug=good-slug',
      payload: baseEvent(),
    })

    expect(res.statusCode).toBe(201)
    expect(storeFindUniqueMock).toHaveBeenCalledWith({
      where: { slug: 'good-slug' },
      select: { id: true, archivedAt: true },
    })
    expect(createManyMock).toHaveBeenCalledTimes(1)
  })

  it('rejects slug-mode when the event store_id differs from the slug store (403)', async () => {
    storeFindUniqueMock.mockResolvedValue({
      id: '00000000-0000-0000-0000-0000000000ff',
      archivedAt: null,
    })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/?slug=other-store',
      payload: baseEvent(), // store_id = STORE_ID
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden' })
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it('rejects slug-mode when the slug store is archived (403)', async () => {
    storeFindUniqueMock.mockResolvedValue({ id: STORE_ID, archivedAt: new Date() })
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'POST',
      url: '/?slug=archived-store',
      payload: baseEvent(),
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden' })
    expect(createManyMock).not.toHaveBeenCalled()
  })
})

describe('GET /loved', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    findManyEventsMock.mockResolvedValue([])
    authMock.mockResolvedValue(true)
  })

  it('returns 400 when store_id is missing', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/loved',
      headers: { authorization: 'Bearer good-token' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'bad_query' })
  })

  it('returns 400 when store_id is not a uuid', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: '/loved?store_id=not-a-uuid',
      headers: { authorization: 'Bearer good-token' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 401 when no Authorization header is sent', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/loved?store_id=${STORE_ID}`,
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 401 when the bearer token is invalid', async () => {
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/loved?store_id=${STORE_ID}`,
      headers: { authorization: 'Bearer bogus-token' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_token' })
  })

  it('returns 403 when the account is not authorized for the store', async () => {
    authMock.mockResolvedValue(false)
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/loved?store_id=${STORE_ID}`,
      headers: { authorization: 'Bearer good-token' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'forbidden' })
  })

  it('returns the distinct songIds the account loved at that store', async () => {
    findManyEventsMock.mockResolvedValue([
      { songId: SONG_ID },
      { songId: '00000000-0000-0000-0000-000000000bbb' },
    ])
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/loved?store_id=${STORE_ID}`,
      headers: { authorization: 'Bearer good-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      songIds: [SONG_ID, '00000000-0000-0000-0000-000000000bbb'],
    })
    expect(findManyEventsMock).toHaveBeenCalledWith({
      where: {
        eventType: 'song_love',
        storeId: STORE_ID,
        accountId: '00000000-0000-0000-0000-000000000aaa',
        songId: { not: null },
      },
      select: { songId: true },
      distinct: ['songId'],
    })
  })

  it('returns an empty array when the account has no loved songs', async () => {
    findManyEventsMock.mockResolvedValue([])
    const app = await buildTestApp(eventsRoutes)
    const res = await app.inject({
      method: 'GET',
      url: `/loved?store_id=${STORE_ID}`,
      headers: { authorization: 'Bearer good-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ songIds: [] })
  })
})
