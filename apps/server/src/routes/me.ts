// Customer-dashboard /me/* endpoints. Operate on the authed Client (the
// session middleware resolves req.account = Client post-merger). Distinct
// from Operator/admin routes; everything here is gated by requireAuth and
// scoped to a single Client.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../db.js'
import { requireAuth } from '../lib/session.js'

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
      tier: s.tier,
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
}
