import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'

// Card 20 contract — Oscar emits these directly. Server is append-only and accepts out-of-order.
const EventSchema = z.object({
  event_type: z.enum([
    'song_start',
    'song_complete',
    'song_skip',
    'song_report',
    'song_love',
    'outcome_override',
    'outcome_override_cleared',
    'playback_starved',
    'operator_login',
    'operator_logout',
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

    const created = await prisma.audioEvent.createMany({
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

    return reply.code(201).send({ accepted: created.count })
  })
}
