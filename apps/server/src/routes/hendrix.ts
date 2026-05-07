import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { nextQueue } from '../lib/hendrix.js'
import { setOverride, clearOverride } from '../lib/outcomeSchedule.js'
import { verify, isOperatorAuthorizedForStore } from '../lib/auth.js'
import { prisma } from '../db.js'

const NextQuery = z.object({
  store_id: z.string().uuid().optional(),
  slug: z.string().min(1).optional(),
  all_outcomes: z.string().optional(),
})
const OverrideBody = z.object({ store_id: z.string().uuid(), outcome_id: z.string().uuid() })
const ClearBody = z.object({ store_id: z.string().uuid() })

async function requireOperatorForStore(req: any, reply: any, storeId: string) {
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
  const ok = await isOperatorAuthorizedForStore(payload.operatorId, storeId)
  if (!ok) {
    reply.code(403).send({ error: 'forbidden' })
    return null
  }
  return payload
}

export const hendrixRoutes: FastifyPluginAsync = async (app) => {
  // GET /hendrix/next?store_id=... (operator-authed) | ?slug=... (slug-as-auth)
  // Slug path is for the freemium player at music.entuned.co/<slug>: anyone
  // with the URL can call. Operator path stays for admin-managed stores.
  app.get('/next', async (req, reply) => {
    const parsed = NextQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_query', details: parsed.error.flatten() })

    let storeId = parsed.data.store_id
    if (parsed.data.slug && !storeId) {
      const store = await prisma.store.findUnique({
        where: { slug: parsed.data.slug },
        select: { id: true, archivedAt: true },
      })
      if (!store || store.archivedAt) return reply.code(404).send({ error: 'store_not_found' })
      storeId = store.id
    } else if (storeId) {
      const op = await requireOperatorForStore(req, reply, storeId)
      if (!op) return
    } else {
      return reply.code(400).send({ error: 'need_store_id_or_slug' })
    }

    return nextQueue(storeId, new Date(), { allOutcomes: parsed.data.all_outcomes === 'true' })
  })

  // GET /hendrix/outcomes?store_id=... — picker source for Oscar's override UI.
  // Operator-only (requires store_id + bearer). Returns all global outcomes,
  // flagging which have a non-empty pool for this store's ICP.
  app.get('/outcomes', async (req, reply) => {
    const parsed = NextQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_query' })
    if (!parsed.data.store_id) return reply.code(400).send({ error: 'store_id_required' })
    const op = await requireOperatorForStore(req, reply, parsed.data.store_id)
    if (!op) return
    const store = await prisma.store.findUnique({
      where: { id: parsed.data.store_id },
      include: { icps: { select: { id: true } } },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const icpIds = store.icps.map((i) => i.id)
    const outcomes = await prisma.outcome.findMany({ where: { supersededAt: null } })
    const counts = icpIds.length === 0 ? [] : await prisma.lineageRow.groupBy({
      by: ['outcomeId'],
      where: { icpId: { in: icpIds }, active: true },
      _count: { _all: true },
    })
    const countMap = new Map(counts.map((c) => [c.outcomeId, c._count._all]))
    return outcomes.map((o) => ({
      outcomeId: o.id,
      title: o.displayTitle ?? o.title,
      tempoBpm: o.tempoBpm,
      mode: o.mode,
      poolSize: countMap.get(o.id) ?? 0,
    }))
  })

  // POST /hendrix/outcome-selection { store_id, outcome_id }
  app.post('/outcome-selection', async (req, reply) => {
    const parsed = OverrideBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const op = await requireOperatorForStore(req, reply, parsed.data.store_id)
    if (!op) return
    const { outcomeId, expiresAt } = await setOverride(parsed.data.store_id, parsed.data.outcome_id)
    // Log the override as an AudioEvent (Card 19 / Card 20 contract).
    await prisma.playbackEvent.create({
      data: {
        eventType: 'outcome_selection',
        storeId: parsed.data.store_id,
        occurredAt: new Date(),
        operatorId: op.operatorId,
        outcomeId,
      },
    })
    return { outcomeId, expiresAt: expiresAt.toISOString() }
  })

  // POST /hendrix/outcome-selection/clear { store_id }
  app.post('/outcome-selection/clear', async (req, reply) => {
    const parsed = ClearBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const op = await requireOperatorForStore(req, reply, parsed.data.store_id)
    if (!op) return
    await clearOverride(parsed.data.store_id)
    await prisma.playbackEvent.create({
      data: {
        eventType: 'outcome_selection_cleared',
        storeId: parsed.data.store_id,
        occurredAt: new Date(),
        operatorId: op.operatorId,
      },
    })
    return { ok: true }
  })
}
