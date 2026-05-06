// Customer-dashboard /me/* endpoints. Operate on the authed Client (the
// session middleware resolves req.account = Client post-merger). Distinct
// from Operator/admin routes; everything here is gated by requireAuth and
// scoped to a single Client.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAuth } from '../lib/session.js'
import { effectiveTier, compIsActive, tierRank } from '../lib/tier.js'

interface AuthedClient {
  clientId: string
}

function getClient(req: FastifyRequest, reply: FastifyReply): AuthedClient | null {
  if (!req.account) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  return { clientId: req.account.id }
}

// "Primary" Store — the Store the dashboard operates on for single-Store
// surfaces (e.g. Brand Intake). Picks the highest-*effective*-tier active
// Store (so a Core store comped to Pro outranks a paid Core sibling), breaks
// ties on createdAt asc. Returns null if the Client has no active Stores.
async function findPrimaryStore(clientId: string) {
  const stores = await prisma.store.findMany({
    where: { clientId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tier: true, compTier: true, compExpiresAt: true, createdAt: true },
  })
  if (stores.length === 0) return null
  return stores.reduce((best, s) =>
    tierRank(effectiveTier(s)) > tierRank(effectiveTier(best)) ? s : best,
  )
}

const IcpInput = z.object({
  name: z.string().trim().min(1).max(120),
  ageRange: z.string().trim().max(120).optional().nullable(),
  location: z.string().trim().max(240).optional().nullable(),
  values: z.string().trim().max(2000).optional().nullable(),
  desires: z.string().trim().max(2000).optional().nullable(),
  unexpressedDesires: z.string().trim().max(2000).optional().nullable(),
  turnOffs: z.string().trim().max(2000).optional().nullable(),
})

function pickIcpFields(row: {
  id: string
  name: string
  ageRange: string | null
  location: string | null
  values: string | null
  desires: string | null
  unexpressedDesires: string | null
  turnOffs: string | null
  updatedAt: Date
}) {
  return {
    id: row.id,
    name: row.name,
    ageRange: row.ageRange,
    location: row.location,
    values: row.values,
    desires: row.desires,
    unexpressedDesires: row.unexpressedDesires,
    turnOffs: row.turnOffs,
    updatedAt: row.updatedAt,
  }
}

export const meRoutes: FastifyPluginAsync = async (app) => {
  // GET /me/stores — list of Stores for the authed Client.
  // Includes a flat subscription summary so the dashboard can render tier,
  // pause state, and renewal date in one round-trip.
  app.get('/stores', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    const stores = await prisma.store.findMany({
      where: { clientId: ctx.clientId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { subscription: true },
    })

    const rows = stores.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      // `tier` is the *effective* tier — paid tier or comp tier, whichever
      // ranks higher. This is what gates dashboard features. Stripe-paid
      // tier is exposed separately as `paidTier` so the customer-facing
      // billing UI can render "Core ($99/mo, comped to Pro through Aug 12)".
      tier: effectiveTier(s),
      paidTier: s.tier,
      compTier: compIsActive(s) ? s.compTier : null,
      compExpiresAt: compIsActive(s) ? s.compExpiresAt : null,
      pausedUntil: s.pausedUntil,
      subscription: s.subscription
        ? {
            status: s.subscription.status,
            currentPeriodEnd: s.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: s.subscription.cancelAtPeriodEnd,
          }
        : null,
    }))

    return reply.send({ stores: rows })
  })

  // GET /me/icp — current ICP for the authed Client's primary Store.
  // Returns { icp: null, store: null } if the Client has no active Stores or
  // no ICP has been saved yet. Multi-Store Clients see only the primary Store's
  // ICP for now; per-Store intake selection is a v2 concern.
  app.get('/icp', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    const store = await findPrimaryStore(ctx.clientId)
    if (!store) return reply.send({ icp: null, store: null })

    const icp = await prisma.iCP.findFirst({
      where: { storeId: store.id },
      orderBy: { updatedAt: 'desc' },
    })

    return reply.send({
      icp: icp ? pickIcpFields(icp) : null,
      store: { id: store.id },
    })
  })

  // POST /me/icp — upsert the ICP for the authed Client's primary Store.
  // First save creates a row; subsequent saves update the most recent row in
  // place. Operator-side ICP suggestions, hooks, and reference tracks survive
  // an update because they hang off icp.id and the row identity is preserved.
  app.post('/icp', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    const parsed = IcpInput.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
    }

    const store = await findPrimaryStore(ctx.clientId)
    if (!store) return reply.code(409).send({ error: 'no_active_store' })

    const fields = {
      clientId: ctx.clientId,
      storeId: store.id,
      name: parsed.data.name,
      ageRange: parsed.data.ageRange ?? null,
      location: parsed.data.location ?? null,
      values: parsed.data.values ?? null,
      desires: parsed.data.desires ?? null,
      unexpressedDesires: parsed.data.unexpressedDesires ?? null,
      turnOffs: parsed.data.turnOffs ?? null,
    }

    const existing = await prisma.iCP.findFirst({
      where: { storeId: store.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })

    const saved = existing
      ? await prisma.iCP.update({ where: { id: existing.id }, data: fields })
      : await prisma.iCP.create({ data: fields })

    return reply.send({ icp: pickIcpFields(saved) })
  })

  // PATCH /me/stores/:id — rename a Store. Only writes to `Store.name`. The
  // slug stays put — it's the URL the customer has likely shared, and we
  // never want a rename to break a music.entuned.co/<slug> link.
  app.patch<{ Params: { id: string }; Body: { name?: string } }>(
    '/stores/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const ctx = getClient(req, reply)
      if (!ctx) return

      const { id } = req.params
      const parsed = z.object({
        name: z.string().trim().min(1).max(120),
      }).safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues })
      }

      const store = await prisma.store.findFirst({
        where: { id, clientId: ctx.clientId, archivedAt: null },
        select: { id: true },
      })
      if (!store) return reply.code(404).send({ error: 'store_not_found' })

      const updated = await prisma.store.update({
        where: { id: store.id },
        data: { name: parsed.data.name },
        select: { id: true, name: true },
      })

      return reply.send({ store: updated })
    },
  )
}
