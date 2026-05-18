import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { verify, isAccountAuthorizedForStore } from '../lib/auth.js'

// Card 20 contract — Oscar emits these directly. Server is append-only and accepts out-of-order.
//
// event_type is the canonical allow-list. The Prisma column is TEXT (demoted
// from enum on 2026-05-16); validation is enforced here so new types ship
// without a migration. Append, don't reorder.
//
// On zod parse failure: the raw payload is quarantined into PlaybackEventRaw
// rather than dropped on the floor — see schema/20-audio-event-stream.md.
// That makes player ↔ server allow-list drift visible after the fact instead
// of corrupting the audio-event stream silently.
const EventSchema = z.object({
  event_type: z.enum([
    // Card 19 originals.
    'song_start',
    'song_complete',
    'song_skip',
    'song_report',
    'song_love',
    'outcome_selection',
    'outcome_selection_cleared',
    'playback_starved',
    'operator_login',
    'operator_logout',
    'ad_play',
    'room_loudness_sample',
    // Phase-1 reliability telemetry (2026-05-16).
    'mediasession_action',
    'wake_lock_acquired',
    'wake_lock_failed',
    'wake_lock_released',
    'playback_stalled',
    'playback_resumed_after_stall',
    'visibility_hidden',
    'visibility_visible',
    'interruption_suspected',
    'pwa_standalone_launch',
    // Phase-2 reliability telemetry (2026-05-16).
    'audio_cache_hit',
    'audio_cache_miss',
    'operator_pause',
    'operator_resume',
    'push_subscribed',
    'push_unsubscribed',
    // Phase-3 (2026-05-17): POS-correlation columns + persistent buffer.
    // `song_load_failed` carries { reason, audio_url, media_error_code }.
    // `heartbeat` is the every-60s liveness ping with { is_playing, queue_depth }.
    'song_load_failed',
    'heartbeat',
    // Hendrix rotation debugging (2026-05-17): emitted by player after every
    // /hendrix/next call. extra carries { fallback_tier, queue_size, all_outcomes }.
    // 'panic' fallback means the sibling+no-repeat filters wiped the pool and
    // we served from the full pool ranked by least-played — a signal the
    // library is too small relative to playback rate.
    'queue_refill',
  ]),
  store_id: z.string().uuid(),
  occurred_at: z.string().datetime(),
  operator_id: z.string().uuid().nullable().optional(),
  song_id: z.string().uuid().nullable().optional(),
  hook_id: z.string().uuid().nullable().optional(),
  report_reason: z.enum([
    'Not our Vibe', 'Boring', 'Awkward Lyrics', 'Too Slow', 'Too Intense', 'Song Audio Issues',
  ]).nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  extra: z.record(z.any()).nullable().optional(),
  // Phase-3 fields (all optional — old clients keep working).
  playback_session_id: z.string().uuid().nullable().optional(),
  device_id: z.string().max(80).nullable().optional(),
  play_duration_ms: z.number().int().nonnegative().nullable().optional(),
  completion_reason: z.enum(['ended', 'skipped', 'errored', 'outcome_changed']).nullable().optional(),
  effective_outcome_id: z.string().uuid().nullable().optional(),
  client_sent_at: z.string().datetime().nullable().optional(),
  client_build: z.string().max(80).nullable().optional(),
  idempotency_key: z.string().min(8).max(80).nullable().optional(),
})
type ParsedEvent = z.infer<typeof EventSchema>

const BatchSchema = z.object({ events: z.array(z.unknown()).min(1).max(500) })

// Wire format uses the display-cased values ('Not our Vibe', etc.) but Prisma's
// generated client expects the TS-enum identifiers; the @map() in schema.prisma
// only handles the DB column. This translates from one to the other.
const REPORT_REASON_TO_PRISMA: Record<string, string> = {
  'Not our Vibe': 'NotOurVibe',
  'Boring': 'Boring',
  'Awkward Lyrics': 'AwkwardLyrics',
  'Too Slow': 'TooSlow',
  'Too Intense': 'TooIntense',
  'Song Audio Issues': 'SongAudioIssues',
}

// Try the strict schema; on failure park into PlaybackEventRaw and return
// null so the main pipeline drops the row instead of rejecting the whole
// batch. Single-event POSTs return the same sentinel so the caller can 202
// rather than 400 — a future event type from a stale player should not look
// like a client bug.
async function parseOrQuarantine(raw: unknown): Promise<ParsedEvent | null> {
  const r = EventSchema.safeParse(raw)
  if (r.success) return r.data
  const rawAny = (raw ?? {}) as Record<string, unknown>
  await prisma.playbackEventRaw.create({
    data: {
      rawJson: rawAny as any,
      errorText: r.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ').slice(0, 500),
      storeId: typeof rawAny.store_id === 'string' && /^[0-9a-f-]{36}$/i.test(rawAny.store_id) ? rawAny.store_id : null,
      eventType: typeof rawAny.event_type === 'string' ? (rawAny.event_type as string).slice(0, 80) : null,
    },
  })
  return null
}

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  // POST /events — single or batch (offline-flush friendly).
  app.post('/', async (req, reply) => {
    const body = req.body as any
    const isBatch = body && typeof body === 'object' && Array.isArray(body.events)
    const rawEvents = isBatch ? BatchSchema.parse(body).events : [body]

    const parsed = await Promise.all(rawEvents.map((r) => parseOrQuarantine(r)))
    const events = parsed.filter((e): e is ParsedEvent => e !== null)
    if (events.length === 0) {
      // Everything quarantined — return 202 so the buffer treats it as
      // accepted and stops retrying. Rejections are not the client's bug.
      return reply.code(202).send({ accepted: 0, quarantined: rawEvents.length })
    }

    // Auto-fill hook_id from LineageRow when the event has a song_id but no hook_id.
    // Oscar should send hook_id directly per the denormalization contract; this is a safety net.
    const songIds = [...new Set(events.filter((e) => e.song_id && !e.hook_id).map((e) => e.song_id!))]
    const hookBySong = new Map<string, string>()
    if (songIds.length > 0) {
      const rows = await prisma.lineageRow.findMany({
        where: { songId: { in: songIds } },
        select: { songId: true, hookId: true },
      })
      // hookId is nullable on LineageRow now (general pool); skip null entries.
      for (const r of rows) {
        if (r.hookId) hookBySong.set(r.songId, r.hookId)
      }
    }

    // skipDuplicates dedupes the idempotency_key unique index. The persistent
    // IndexedDB buffer on the client retries failed flushes, so the same
    // event can arrive twice; the second insert is a no-op.
    const created = await prisma.playbackEvent.createMany({
      skipDuplicates: true,
      data: events.map((e) => ({
        eventType: e.event_type as any,
        storeId: e.store_id,
        occurredAt: new Date(e.occurred_at),
        accountId: e.operator_id ?? null,
        songId: e.song_id ?? null,
        hookId: e.hook_id ?? (e.song_id ? hookBySong.get(e.song_id) ?? null : null),
        reportReason: (e.report_reason ? REPORT_REASON_TO_PRISMA[e.report_reason] : null) as any,
        outcomeId: e.outcome_id ?? null,
        extra: e.extra ?? undefined,
        playbackSessionId: e.playback_session_id ?? null,
        deviceId: e.device_id ?? null,
        playDurationMs: e.play_duration_ms ?? null,
        completionReason: e.completion_reason ?? null,
        effectiveOutcomeId: e.effective_outcome_id ?? null,
        clientSentAt: e.client_sent_at ? new Date(e.client_sent_at) : null,
        clientBuild: e.client_build ?? null,
        idempotencyKey: e.idempotency_key ?? null,
      })),
    })

    // Update campaign play state counters.
    // song_complete → increment songs_played_since_ad by the exact number of
    // completions for that store in this batch (batches may contain multiple
    // song_completes when songs are short or events are held before flush).
    // Only count ended/skipped — errored completions didn't actually play.
    // updateMany is a no-op for stores with no CampaignPlayState row; the row
    // is bootstrapped by injectAdIfDue the first time a campaign is active.
    const songCompleteCountByStore = new Map<string, number>()
    for (const e of events.filter((e) => e.event_type === 'song_complete' && e.completion_reason !== 'errored')) {
      songCompleteCountByStore.set(e.store_id, (songCompleteCountByStore.get(e.store_id) ?? 0) + 1)
    }
    await Promise.all([...songCompleteCountByStore.entries()].map(([storeId, count]) =>
      prisma.campaignPlayState.updateMany({
        where: { storeId },
        data: { songsPlayedSinceAd: { increment: count } },
      }),
    ))

    // ad_play → reset songs_played_since_ad, advance nextAssetIndex for that campaign.
    for (const e of events.filter((e) => e.event_type === 'ad_play')) {
      await prisma.campaignPlayState.upsert({
        where: { storeId: e.store_id },
        update: { songsPlayedSinceAd: 0 },
        create: { storeId: e.store_id, songsPlayedSinceAd: 0 },
      })
      const campaignId = (e.extra as any)?.campaignId as string | undefined
      if (campaignId) {
        const assetCount = await prisma.adAsset.count({ where: { campaignId } })
        if (assetCount > 0) {
          const cur = await prisma.campaignAssetState.findUnique({ where: { campaignId } })
          const next = ((cur?.nextAssetIndex ?? 0) + 1) % assetCount
          await prisma.campaignAssetState.upsert({
            where: { campaignId },
            update: { nextAssetIndex: next },
            create: { campaignId, nextAssetIndex: next },
          })
        }
      }
    }

    return reply.code(201).send({ accepted: created.count, quarantined: rawEvents.length - events.length })
  })

  // GET /events/loved?store_id=... — songIds the authed operator has loved at
  // this store. Today "love" is write-once (no song_unlove event in the enum),
  // so any song with at least one song_love event is loved.
  app.get('/loved', async (req, reply) => {
    const q = z.object({ store_id: z.string().uuid() }).safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'bad_query' })
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' })
    const payload = verify(auth.slice(7))
    if (!payload) return reply.code(401).send({ error: 'invalid_token' })
    const ok = await isAccountAuthorizedForStore(payload.accountId, q.data.store_id)
    if (!ok) return reply.code(403).send({ error: 'forbidden' })

    const rows = await prisma.playbackEvent.findMany({
      where: {
        eventType: 'song_love',
        storeId: q.data.store_id,
        accountId: payload.accountId,
        songId: { not: null },
      },
      select: { songId: true },
      distinct: ['songId'],
    })
    return { songIds: rows.map((r) => r.songId!) }
  })
}
