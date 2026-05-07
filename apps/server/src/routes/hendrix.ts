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
const OutcomesQuery = z.object({
  store_id: z.string().uuid().optional(),
  slug: z.string().min(1).optional(),
})
const OverrideBody = z.object({
  store_id: z.string().uuid().optional(),
  slug: z.string().min(1).optional(),
  outcome_id: z.string().uuid(),
})
const ClearBody = z.object({
  store_id: z.string().uuid().optional(),
  slug: z.string().min(1).optional(),
})

/** Resolve a Store from a slug (slug-mode auth). 404s if unknown or archived. */
async function resolveStoreBySlug(slug: string, reply: any): Promise<{ id: string } | null> {
  const store = await prisma.store.findUnique({
    where: { slug },
    select: { id: true, archivedAt: true },
  })
  if (!store || store.archivedAt) {
    reply.code(404).send({ error: 'store_not_found' })
    return null
  }
  return { id: store.id }
}

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

  // GET /hendrix/outcomes?store_id=... (operator) | ?slug=... (slug-as-auth)
  // Returns all global outcomes with a poolSize count.
  // - For paid Stores (has ICPs): count = LineageRows tied to the Store's ICPs.
  // - For free Stores (no ICPs): count = LineageRows in the general pool
  //   (icp_id IS NULL) tagged with each outcome — so slug-mode players can
  //   see exactly what's playable on Increase Dwell vs. Lift Energy.
  app.get('/outcomes', async (req, reply) => {
    const parsed = OutcomesQuery.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_query' })
    let storeId = parsed.data.store_id
    if (parsed.data.slug && !storeId) {
      const s = await resolveStoreBySlug(parsed.data.slug, reply); if (!s) return
      storeId = s.id
    } else if (storeId) {
      const op = await requireOperatorForStore(req, reply, storeId); if (!op) return
    } else {
      return reply.code(400).send({ error: 'need_store_id_or_slug' })
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: { icps: { select: { id: true } } },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const icpIds = store.icps.map((i) => i.id)
    const outcomes = await prisma.outcome.findMany({ where: { supersededAt: null } })

    // Counts: ICP-pool for paid, general-pool for free.
    const where = icpIds.length > 0
      ? { icpId: { in: icpIds }, active: true }
      : { icpId: null, active: true }
    const counts = await prisma.lineageRow.groupBy({
      by: ['outcomeId'],
      where,
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

  // POST /hendrix/outcome-selection { store_id|slug, outcome_id }
  // Slug-mode (free tier) writes are allowed because the slug is the auth —
  // anyone with the player URL can already shape the playback.
  app.post('/outcome-selection', async (req, reply) => {
    const parsed = OverrideBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    let storeId = parsed.data.store_id
    let operatorId: string | null = null
    if (parsed.data.slug && !storeId) {
      const s = await resolveStoreBySlug(parsed.data.slug, reply); if (!s) return
      storeId = s.id
    } else if (storeId) {
      const op = await requireOperatorForStore(req, reply, storeId); if (!op) return
      operatorId = op.operatorId
    } else {
      return reply.code(400).send({ error: 'need_store_id_or_slug' })
    }

    const { outcomeId, expiresAt } = await setOverride(storeId, parsed.data.outcome_id)
    await prisma.playbackEvent.create({
      data: {
        eventType: 'outcome_selection',
        storeId,
        occurredAt: new Date(),
        operatorId,
        outcomeId,
      },
    })
    return { outcomeId, expiresAt: expiresAt.toISOString() }
  })

  // POST /hendrix/outcome-selection/clear { store_id|slug }
  app.post('/outcome-selection/clear', async (req, reply) => {
    const parsed = ClearBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    let storeId = parsed.data.store_id
    let operatorId: string | null = null
    if (parsed.data.slug && !storeId) {
      const s = await resolveStoreBySlug(parsed.data.slug, reply); if (!s) return
      storeId = s.id
    } else if (storeId) {
      const op = await requireOperatorForStore(req, reply, storeId); if (!op) return
      operatorId = op.operatorId
    } else {
      return reply.code(400).send({ error: 'need_store_id_or_slug' })
    }

    await clearOverride(storeId)
    await prisma.playbackEvent.create({
      data: {
        eventType: 'outcome_selection_cleared',
        storeId,
        occurredAt: new Date(),
        operatorId,
      },
    })
    return { ok: true }
  })
}
