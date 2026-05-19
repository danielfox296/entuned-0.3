// Morning Command Center routes.
//
// Backs the new sidebar group in Dash (apps/admin) that surfaces every
// agentic growth subsystem in one panel. All routes require admin auth
// — same Bearer JWT pattern as apps/server/src/routes/admin.ts.
//
// Endpoints (mounted at /command-center/*):
//   GET    /queue                       — list queue items (filter by type/status)
//   POST   /queue                       — manually add a queue item
//   PATCH  /queue/:id                   — update item (status/draftContent/priority/snoozedUntil)
//   DELETE /queue/:id                   — remove item
//   GET    /digest                      — today's digest (computes if missing)
//   GET    /scoreboard                  — current free/paid/MRR + monthly target
//   GET    /proof-points                — list proof points
//   POST   /proof-points                — create proof point
//   PATCH  /proof-points/:id            — update proof point
//   DELETE /proof-points/:id            — delete proof point
//   GET    /content                     — list content pieces (filter by narrative/format/status)
//   POST   /content                     — create content piece manually
//   PATCH  /content/:id                 — update content piece
//   DELETE /content/:id                 — delete content piece
//
// Spec: ../../../morning-command-center-spec.md
// SSOT: ../../../../entune v0.3/schema/command-center.md

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { verify } from '../lib/auth.js'
import {
  QUEUE_TYPES,
  QUEUE_STATUSES,
  QUEUE_ACTIONS,
  PROOF_CATEGORIES,
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  MONTHLY_TARGET,
  OUTREACH_TARGET_TYPES,
} from '../lib/command-center-config.js'
import { queueOutreachTarget } from '../workers/outreach-queue.js'
import { runSignalScanner } from '../workers/signal-scanner.js'
import { runContentMultiplier } from '../workers/content-multiplier.js'
import { runNurtureDrip } from '../workers/nurture-drip.js'
import { runSeoPipeline } from '../workers/seo-pipeline.js'
import { runTriggerMonitor } from '../workers/trigger-monitor.js'

interface AuthedOp {
  accountId: string
  email: string
  isAdmin: boolean
}

async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthedOp | null> {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  const payload = verify(auth.slice(7))
  if (!payload) {
    reply.code(401).send({ error: 'invalid_token' })
    return null
  }
  if (!payload.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  const op = await prisma.account.findUnique({ where: { id: payload.accountId } })
  if (!op || op.disabledAt || !op.isAdmin) {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }
  if (op.tokenVersion !== payload.tv) {
    reply.code(401).send({ error: 'token_revoked' })
    return null
  }
  return { accountId: op.id, email: op.email, isAdmin: op.isAdmin }
}

// MRR estimate by tier. Stripe is authoritative, but Subscription rows don't
// store unit price — close enough for an at-a-glance scoreboard. Update when
// pricing changes.
const TIER_PRICE_CENTS: Record<string, number> = {
  free: 0,
  core: 9900,
  pro: 24900,
  enterprise: 99900,
}

// ---- Schemas --------------------------------------------------------------

const QueueItemCreate = z.object({
  type: z.enum(QUEUE_TYPES),
  subtype: z.string().min(1).max(60).optional(),
  status: z.enum(QUEUE_STATUSES).optional(),
  priority: z.number().int().optional(),
  title: z.string().min(1).max(500),
  draftContent: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  payload: z.unknown().optional(),
  externalId: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
})

const QueueItemUpdate = z.object({
  status: z.enum(QUEUE_STATUSES).optional(),
  priority: z.number().int().optional(),
  title: z.string().min(1).max(500).optional(),
  draftContent: z.string().optional(),
  payload: z.unknown().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  actedAction: z.enum(QUEUE_ACTIONS).optional(),
})

const ProofPointCreate = z.object({
  label: z.string().min(1).max(80),
  quoteText: z.string().min(1),
  attribution: z.string().min(1).max(200),
  context: z.string().optional(),
  category: z.enum(PROOF_CATEGORIES),
  eventDate: z.string().optional(), // ISO date
  tags: z.array(z.string()).optional(),
})

const ProofPointUpdate = ProofPointCreate.partial()

const ContentPieceCreate = z.object({
  proofPointId: z.string().uuid().optional(),
  narrative: z.string().min(1).max(80),
  format: z.enum(CONTENT_FORMATS),
  title: z.string().max(300).optional(),
  body: z.string().min(1),
  status: z.enum(CONTENT_STATUSES).optional(),
})

const ContentPieceUpdate = z.object({
  proofPointId: z.string().uuid().nullable().optional(),
  narrative: z.string().min(1).max(80).optional(),
  format: z.enum(CONTENT_FORMATS).optional(),
  title: z.string().max(300).nullable().optional(),
  body: z.string().min(1).optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
  publishedUrl: z.string().url().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
})

// ---- Plugin ---------------------------------------------------------------

export const commandCenterRoutes: FastifyPluginAsync = async (app) => {
  // ===== Queue ============================================================

  app.get('/queue', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const q = (req.query ?? {}) as Record<string, string | undefined>
    const where: Record<string, unknown> = {}
    if (q.type) where.type = q.type
    if (q.status) where.status = q.status
    if (q.subtype) where.subtype = q.subtype
    const limit = Math.min(parseInt(q.limit ?? '200', 10) || 200, 500)
    const items = await prisma.queueItem.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    })
    return { items }
  })

  app.post('/queue', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = QueueItemCreate.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const d = parsed.data
    try {
      const row = await prisma.queueItem.create({
        data: {
          type: d.type,
          subtype: d.subtype ?? null,
          status: d.status ?? 'pending',
          priority: d.priority ?? 0,
          title: d.title,
          draftContent: d.draftContent ?? null,
          sourceUrl: d.sourceUrl ?? null,
          payload: (d.payload as never) ?? undefined,
          externalId: d.externalId ?? null,
          expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
        },
      })
      return row
    } catch (e) {
      // Unique externalId collision = already queued; return existing.
      const existing = d.externalId
        ? await prisma.queueItem.findUnique({ where: { externalId: d.externalId } })
        : null
      if (existing) return reply.code(200).send(existing)
      throw e
    }
  })

  app.patch('/queue/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id: string }).id
    const parsed = QueueItemUpdate.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const d = parsed.data
    const data: Record<string, unknown> = {}
    if (d.status !== undefined) {
      data.status = d.status
      // Stamp acted_at on any terminal transition out of pending.
      if (d.status !== 'pending' && d.status !== 'snoozed') {
        data.actedAt = new Date()
      }
    }
    if (d.priority !== undefined) data.priority = d.priority
    if (d.title !== undefined) data.title = d.title
    if (d.draftContent !== undefined) data.draftContent = d.draftContent
    if (d.payload !== undefined) data.payload = d.payload as never
    if (d.snoozedUntil !== undefined) {
      data.snoozedUntil = d.snoozedUntil ? new Date(d.snoozedUntil) : null
    }
    if (d.actedAction !== undefined) {
      data.actedAction = d.actedAction
      data.actedAt = new Date()
    }
    try {
      const row = await prisma.queueItem.update({ where: { id }, data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/queue/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id: string }).id
    try {
      await prisma.queueItem.delete({ where: { id } })
      return reply.code(204).send()
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ===== Digest / Scoreboard =============================================

  app.get('/scoreboard', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    // Free / paid counts from the Store table directly. We count active
    // (non-archived) stores so the scoreboard tracks live entitlements,
    // not historical signups.
    const stores = await prisma.store.findMany({
      where: { archivedAt: null },
      select: { tier: true },
    })
    let free = 0
    let paid = 0
    let mrr = 0
    for (const s of stores) {
      if (s.tier === 'free') {
        free++
      } else {
        paid++
        mrr += TIER_PRICE_CENTS[s.tier] ?? 0
      }
    }
    return {
      free,
      paid,
      mrr,
      target: MONTHLY_TARGET,
    }
  })

  app.get('/digest', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    // Today (UTC). The materialization is best-effort — we just count
    // today's queue items by type and snapshot the scoreboard.
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const startOfDay = today
    const endOfDay = new Date(today.getTime() + 24 * 60 * 60 * 1000)

    const existing = await prisma.dailyDigest.findUnique({ where: { date: startOfDay } })
    if (existing) return existing

    const items = await prisma.queueItem.findMany({
      where: { createdAt: { gte: startOfDay, lt: endOfDay } },
      select: { type: true },
    })
    const counts: Record<string, number> = {}
    for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1

    const stores = await prisma.store.findMany({
      where: { archivedAt: null },
      select: { tier: true },
    })
    let free = 0
    let paid = 0
    let mrr = 0
    for (const s of stores) {
      if (s.tier === 'free') free++
      else {
        paid++
        mrr += TIER_PRICE_CENTS[s.tier] ?? 0
      }
    }

    const row = await prisma.dailyDigest.create({
      data: {
        date: startOfDay,
        signalCount: counts.signal ?? 0,
        outreachCount: counts.outreach ?? 0,
        contentCount: counts.content ?? 0,
        triggerCount: counts.trigger ?? 0,
        freeSignups: free,
        paidUsers: paid,
        mrr,
      },
    })
    return row
  })

  // ===== Proof points =====================================================

  app.get('/proof-points', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const rows = await prisma.proofPoint.findMany({
      orderBy: { createdAt: 'desc' },
      include: { pieces: { select: { id: true, format: true, status: true } } },
    })
    return { items: rows }
  })

  app.post('/proof-points', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = ProofPointCreate.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const d = parsed.data
    const row = await prisma.proofPoint.create({
      data: {
        label: d.label,
        quoteText: d.quoteText,
        attribution: d.attribution,
        context: d.context ?? null,
        category: d.category,
        eventDate: d.eventDate ? new Date(d.eventDate) : null,
        tags: d.tags ?? [],
      },
    })
    return row
  })

  app.patch('/proof-points/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id: string }).id
    const parsed = ProofPointUpdate.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const d = parsed.data
    const data: Record<string, unknown> = {}
    if (d.label !== undefined) data.label = d.label
    if (d.quoteText !== undefined) data.quoteText = d.quoteText
    if (d.attribution !== undefined) data.attribution = d.attribution
    if (d.context !== undefined) data.context = d.context
    if (d.category !== undefined) data.category = d.category
    if (d.eventDate !== undefined) data.eventDate = d.eventDate ? new Date(d.eventDate) : null
    if (d.tags !== undefined) data.tags = d.tags
    try {
      const row = await prisma.proofPoint.update({ where: { id }, data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/proof-points/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id: string }).id
    try {
      await prisma.proofPoint.delete({ where: { id } })
      return reply.code(204).send()
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ===== Content pieces ===================================================

  app.get('/content', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const q = (req.query ?? {}) as Record<string, string | undefined>
    const where: Record<string, unknown> = {}
    if (q.narrative) where.narrative = q.narrative
    if (q.format) where.format = q.format
    if (q.status) where.status = q.status
    if (q.proofPointId) where.proofPointId = q.proofPointId
    const rows = await prisma.contentPiece.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return { items: rows }
  })

  app.post('/content', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = ContentPieceCreate.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const d = parsed.data
    const row = await prisma.contentPiece.create({
      data: {
        proofPointId: d.proofPointId ?? null,
        narrative: d.narrative,
        format: d.format,
        title: d.title ?? null,
        body: d.body,
        status: d.status ?? 'draft',
      },
    })
    return row
  })

  app.patch('/content/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id: string }).id
    const parsed = ContentPieceUpdate.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    const d = parsed.data
    const data: Record<string, unknown> = {}
    if (d.proofPointId !== undefined) data.proofPointId = d.proofPointId
    if (d.narrative !== undefined) data.narrative = d.narrative
    if (d.format !== undefined) data.format = d.format
    if (d.title !== undefined) data.title = d.title
    if (d.body !== undefined) data.body = d.body
    if (d.status !== undefined) {
      data.status = d.status
      // When transitioning to 'published' stamp publishedAt if caller didn't.
      if (d.status === 'published' && d.publishedAt === undefined) {
        data.publishedAt = new Date()
      }
    }
    if (d.publishedUrl !== undefined) data.publishedUrl = d.publishedUrl
    if (d.publishedAt !== undefined) {
      data.publishedAt = d.publishedAt ? new Date(d.publishedAt) : null
    }
    try {
      const row = await prisma.contentPiece.update({ where: { id }, data })
      return row
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  app.delete('/content/:id', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const id = (req.params as { id: string }).id
    try {
      await prisma.contentPiece.delete({ where: { id } })
      return reply.code(204).send()
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
  })

  // ===== Outreach research (on-demand worker trigger) =====================

  app.post('/outreach/research', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const parsed = OutreachResearchBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_body', details: parsed.error.flatten() })
    }
    try {
      const result = await queueOutreachTarget(parsed.data)
      return reply.send(result)
    } catch (e) {
      return reply.code(500).send({ error: 'research_failed', message: (e as Error).message })
    }
  })
}

const OutreachResearchBody = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(OUTREACH_TARGET_TYPES),
  url: z.string().url(),
  notes: z.string().max(2000).optional(),
})

// ===== On-demand worker triggers =========================================
//
// Wraps each worker's `run*` function as POST /workers/:name/run so the UI
// can fire them outside the cron schedule. Same admin-auth gate. Synchronous:
// returns the worker stats when done (workers are bounded by per-run caps).
//
// Mounted as a separate plugin function so the closure above stays tidy —
// these get registered on the same plugin via the export below.

type WorkerName =
  | 'signal-scanner'
  | 'content-multiplier'
  | 'trigger-monitor'
  | 'seo-pipeline'
  | 'nurture-drip'

const WORKERS: Record<WorkerName, () => Promise<unknown>> = {
  'signal-scanner': () => runSignalScanner(),
  'content-multiplier': () => runContentMultiplier(),
  'trigger-monitor': () => runTriggerMonitor(),
  'seo-pipeline': () => runSeoPipeline(),
  'nurture-drip': () => runNurtureDrip(),
}

export const commandCenterWorkerRoutes: FastifyPluginAsync = async (app) => {
  app.post('/workers/:name/run', async (req, reply) => {
    const op = await requireAdmin(req, reply); if (!op) return
    const name = (req.params as { name: string }).name as WorkerName
    const runner = WORKERS[name]
    if (!runner) {
      return reply.code(404).send({ error: 'unknown_worker', name })
    }
    const startedAt = Date.now()
    try {
      const stats = await runner()
      return reply.send({
        worker: name,
        durationMs: Date.now() - startedAt,
        stats,
      })
    } catch (e) {
      return reply.code(500).send({
        error: 'worker_failed',
        worker: name,
        message: (e as Error).message,
      })
    }
  })
}
