import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { verify, isOperatorAuthorizedForStore } from '../lib/auth.js'

// Card 20 contract — Oscar emits these directly. Server is append-only and accepts out-of-order.
const EventSchema = z.object({
  event_type: z.enum([
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
})

const BatchSchema = z.object({ events: z.array(EventSchema).min(1).max(500) })

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  // POST /events — single or batch (offline-flush friendly).
  app.post('/', async (req, reply) => {
    const body = req.body as any
    const isBatch = body && typeof body === 'object' && Array.isArray(body.events)
    const events = isBatch ? BatchSchema.parse(body).events : [EventSchema.parse(body)]

    // Auto-fill hook_id from LineageRow when the event has a song_id but no hook_id.
    // Oscar should send hook_id directly per the denormalization contract; this is a safety net.
    const songIds = [...new Set(events.filter((e) => e.song_id && !e.hook_id).map((e) => e.song_id!))]
    let hookBySong = new Map<string, string>()
    if (songIds.length > 0) {
      const rows = await prisma.lineageRow.findMany({
        where: { songId: { in: songIds } },
        select: { songId: true, hookId: true },
      })
      hookBySong = new Map(rows.map((r) => [r.songId, r.hookId]))
    }

    const created = await prisma.playbackEvent.createMany({
      data: events.map((e) => ({
        eventType: e.event_type as any,
        storeId: e.store_id,
        occurredAt: new Date(e.occurred_at),
        operatorId: e.operator_id ?? null,
        songId: e.song_id ?? null,
        hookId: e.hook_id ?? (e.song_id ? hookBySong.get(e.song_id) ?? null : null),
        reportReason: e.report_reason as any ?? null,
        outcomeId: e.outcome_id ?? null,
        extra: e.extra ?? undefined,
      })),
    })

    // Update campaign play state counters.
    // song_complete → increment songs_played_since_ad for the store.
    const songCompleteStores = [...new Set(
      events.filter((e) => e.event_type === 'song_complete').map((e) => e.store_id),
    )]
    await Promise.all(songCompleteStores.map((storeId) =>
      prisma.campaignPlayState.upsert({
        where: { storeId },
        update: { songsPlayedSinceAd: { increment: 1 } },
        create: { storeId, songsPlayedSinceAd: 1 },
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

    return reply.code(201).send({ accepted: created.count })
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
    const ok = await isOperatorAuthorizedForStore(payload.operatorId, q.data.store_id)
    if (!ok) return reply.code(403).send({ error: 'forbidden' })

    const rows = await prisma.playbackEvent.findMany({
      where: {
        eventType: 'song_love',
        storeId: q.data.store_id,
        operatorId: payload.operatorId,
        songId: { not: null },
      },
      select: { songId: true },
      distinct: ['songId'],
    })
    return { songIds: rows.map((r) => r.songId!) }
  })
}
