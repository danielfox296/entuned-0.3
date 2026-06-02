// Admin: player reliability summary. Surfaces phase-1 + phase-2 telemetry
// (lockscreen / wake-lock / visibility / stall / PWA-install / audio cache /
// web push) so Dash operators can see per-store interruption rates and
// installation adoption without writing SQL.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { adminPreHandler, ensureOperatorDecorator } from '../lib/auth.js'

// Event types we surface in the summary. Listed explicitly so a future
// addition to the Zod allow-list doesn't silently change the panel.
const RELIABILITY_EVENT_TYPES = [
  'song_start',
  'song_complete',
  'interruption_suspected',
  'playback_stalled',
  'playback_resumed_after_stall',
  'visibility_hidden',
  'visibility_visible',
  'mediasession_action',
  'wake_lock_acquired',
  'wake_lock_failed',
  'wake_lock_released',
  'pwa_standalone_launch',
  'audio_cache_hit',
  'audio_cache_miss',
  'push_subscribed',
  'push_unsubscribed',
  'operator_pause',
  'operator_resume',
] as const

const QuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) })

export const adminReliabilityRoutes: FastifyPluginAsync = async (app) => {
  ensureOperatorDecorator(app)
  app.addHook('preHandler', adminPreHandler)

  // GET /admin/reliability/summary?days=7 — per-store rollup.
  app.get('/reliability/summary', async (req, reply) => {
    const q = QuerySchema.safeParse(req.query)
    if (!q.success) return reply.code(400).send({ error: 'bad_query' })
    const since = new Date(Date.now() - q.data.days * 24 * 60 * 60 * 1000)

    const rows = await prisma.playbackEvent.groupBy({
      by: ['storeId', 'eventType'],
      where: {
        occurredAt: { gte: since },
        eventType: { in: [...RELIABILITY_EVENT_TYPES] },
      },
      _count: { _all: true },
    })

    // Standalone-launch breakdown needs the `extra.is_standalone` flag. One
    // extra query rather than dragging the whole event table through groupBy.
    const standaloneRows = await prisma.playbackEvent.findMany({
      where: { occurredAt: { gte: since }, eventType: 'pwa_standalone_launch' },
      select: { storeId: true, extra: true },
    })
    const standalone = new Map<string, { installed: number; tab: number }>()
    for (const r of standaloneRows) {
      const isStandalone = !!(r.extra as { is_standalone?: boolean } | null)?.is_standalone
      const cur = standalone.get(r.storeId) ?? { installed: 0, tab: 0 }
      if (isStandalone) cur.installed += 1
      else cur.tab += 1
      standalone.set(r.storeId, cur)
    }

    // Pivot into per-store records.
    const perStore = new Map<string, Record<string, number>>()
    for (const r of rows) {
      const cur = perStore.get(r.storeId) ?? {}
      cur[r.eventType] = (cur[r.eventType] ?? 0) + r._count._all
      perStore.set(r.storeId, cur)
    }

    const storeIds = [...perStore.keys()]
    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true, tier: true, client: { select: { companyName: true } } },
    })
    const storeMap = new Map(stores.map((s) => [s.id, s]))

    const summary = storeIds
      .map((sid) => {
        const counts = perStore.get(sid) ?? {}
        const st = storeMap.get(sid)
        const adopt = standalone.get(sid) ?? { installed: 0, tab: 0 }
        const totalLaunches = adopt.installed + adopt.tab
        const songStarts = counts['song_start'] ?? 0
        const mediasessionCount = counts['mediasession_action'] ?? 0
        const operatorPause = counts['operator_pause'] ?? 0
        const operatorResume = counts['operator_resume'] ?? 0
        const inappPlayPause = Math.max(0, operatorPause + operatorResume)
        const totalControl = mediasessionCount + inappPlayPause
        const cacheHits = counts['audio_cache_hit'] ?? 0
        const cacheMisses = counts['audio_cache_miss'] ?? 0
        const cacheTotal = cacheHits + cacheMisses
        return {
          storeId: sid,
          storeName: st?.name ?? '(unknown)',
          clientName: st?.client?.companyName ?? null,
          tier: st?.tier ?? null,
          songStarts,
          songCompletes: counts['song_complete'] ?? 0,
          interruptions: counts['interruption_suspected'] ?? 0,
          interruptionsPerSession: songStarts > 0 ? (counts['interruption_suspected'] ?? 0) / songStarts : 0,
          stalls: counts['playback_stalled'] ?? 0,
          stallResumes: counts['playback_resumed_after_stall'] ?? 0,
          wakeLockFailures: counts['wake_lock_failed'] ?? 0,
          standaloneInstalled: adopt.installed,
          standaloneTab: adopt.tab,
          standaloneAdoption: totalLaunches > 0 ? adopt.installed / totalLaunches : 0,
          osMediatedControlShare: totalControl > 0 ? mediasessionCount / totalControl : 0,
          cacheHits,
          cacheMisses,
          cacheHitRate: cacheTotal > 0 ? cacheHits / cacheTotal : 0,
          pushSubscribed: counts['push_subscribed'] ?? 0,
          pushUnsubscribed: counts['push_unsubscribed'] ?? 0,
        }
      })
      .sort((a, b) => b.songStarts - a.songStarts)

    return { days: q.data.days, since: since.toISOString(), stores: summary }
  })
}
