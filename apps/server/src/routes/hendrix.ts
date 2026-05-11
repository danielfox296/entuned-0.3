import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { nextQueue } from '../lib/hendrix.js'
import { setOverride, clearOverride } from '../lib/outcomeSchedule.js'
import { isFreeTierAllowedOutcome } from '../lib/outcomes.js'
import { verify, isAccountAuthorizedForStore } from '../lib/auth.js'
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
  const ok = await isAccountAuthorizedForStore(payload.accountId, storeId)
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
  // Returns all global outcomes with a poolSize count = LineageRows tied to
  // the Store's linked ICPs (Free Tier ICP for free Stores; per-store ICPs
  // for paid). Stores always have ≥1 ICP via the StoreICP join.
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
      include: { icpLinks: { select: { icpId: true } } },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    const icpIds = store.icpLinks.map((l) => l.icpId)
    const [outcomes, allowedFree] = await Promise.all([
      prisma.outcome.findMany({ where: { supersededAt: null } }),
      prisma.freeTierOutcome.findMany({ select: { outcomeKey: true } }),
    ])
    const allowedFreeSet = new Set(allowedFree.map((a) => a.outcomeKey))

    const counts = icpIds.length === 0 ? [] : await prisma.lineageRow.groupBy({
      by: ['outcomeId'],
      where: { icpId: { in: icpIds }, active: true },
      _count: { _all: true },
    })
    const countMap = new Map(counts.map((c) => [c.outcomeId, c._count._all]))
    return outcomes.map((o) => ({
      outcomeId: o.id,
      outcomeKey: o.outcomeKey,
      title: o.displayTitle ?? o.title,
      tempoBpm: o.tempoBpm,
      mode: o.mode,
      poolSize: countMap.get(o.id) ?? 0,
      availableOnFree: allowedFreeSet.has(o.outcomeKey),
    }))
  })

  // POST /hendrix/outcome-selection { store_id|slug, outcome_id }
  // Slug-mode (free tier) writes are allowed because the slug is the auth —
  // anyone with the player URL can already shape the playback.
  app.post('/outcome-selection', async (req, reply) => {
    const parsed = OverrideBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    let storeId = parsed.data.store_id
    let accountId: string | null = null
    if (parsed.data.slug && !storeId) {
      const s = await resolveStoreBySlug(parsed.data.slug, reply); if (!s) return
      storeId = s.id
    } else if (storeId) {
      const op = await requireOperatorForStore(req, reply, storeId); if (!op) return
      accountId = op.accountId
    } else {
      return reply.code(400).send({ error: 'need_store_id_or_slug' })
    }

    // Free-tier guard: a free-tier Store can only select outcomes in the
    // FreeTierOutcome allowlist. The player UI locks them already, but this
    // path is reachable via the slug (anyone with the URL), so enforce here.
    const target = await prisma.store.findUnique({ where: { id: storeId }, select: { tier: true } })
    if (target?.tier === 'free' && !(await isFreeTierAllowedOutcome(parsed.data.outcome_id))) {
      return reply.code(409).send({
        error: 'outcome_not_in_free_tier_allowlist',
        message: 'This outcome is not available on the free tier.',
      })
    }

    const { outcomeId, expiresAt } = await setOverride(storeId, parsed.data.outcome_id)
    await prisma.playbackEvent.create({
      data: {
        eventType: 'outcome_selection',
        storeId,
        occurredAt: new Date(),
        accountId,
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
    let accountId: string | null = null
    if (parsed.data.slug && !storeId) {
      const s = await resolveStoreBySlug(parsed.data.slug, reply); if (!s) return
      storeId = s.id
    } else if (storeId) {
      const op = await requireOperatorForStore(req, reply, storeId); if (!op) return
      accountId = op.accountId
    } else {
      return reply.code(400).send({ error: 'need_store_id_or_slug' })
    }

    await clearOverride(storeId)
    await prisma.playbackEvent.create({
      data: {
        eventType: 'outcome_selection_cleared',
        storeId,
        occurredAt: new Date(),
        accountId,
      },
    })
    return { ok: true }
  })
}
