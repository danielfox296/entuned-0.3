// Public Store-resolution endpoints. Used by the player at music.entuned.co
// to translate the URL slug (e.g. `danielchristopherfox-0616`) into a
// store_id so subsequent calls to Hendrix know which Store to play for.
//
// Public on purpose — the slug is the player URL and effectively
// unguessable (4-hex suffix). Device-binding (planned, see Card 18 notes)
// will eventually pin a slug to a single device fingerprint.

import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../db.js'
import { effectiveTier } from '../lib/tier.js'

export const storeRoutes: FastifyPluginAsync = async (app) => {
  // GET /stores/by-slug/:slug → resolves a player URL slug to its Store.
  app.get('/by-slug/:slug', async (req, reply) => {
    const slug = (req.params as { slug?: string } | undefined)?.slug
    if (!slug || typeof slug !== 'string') {
      return reply.code(400).send({ error: 'bad_slug' })
    }

    const store = await prisma.store.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        compTier: true,
        compExpiresAt: true,
        timezone: true,
        archivedAt: true,
        pausedUntil: true,
      },
    })
    if (!store || store.archivedAt) {
      return reply.code(404).send({ error: 'store_not_found' })
    }

    return reply.send({
      id: store.id,
      name: store.name,
      slug: store.slug,
      // Player gets the effective tier — comped Pro stores should play with
      // Pro entitlements just like real ones.
      tier: effectiveTier(store),
      timezone: store.timezone,
      pausedUntil: store.pausedUntil,
    })
  })
}
