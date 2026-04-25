import type { FastifyPluginAsync } from 'fastify'

export const hendrixRoutes: FastifyPluginAsync = async (app) => {
  // GET /hendrix/next?store_id=...
  // Resolves active outcome for (store, now), filters LineageRow pool by ICP+outcome+active,
  // applies rotation rules with tiered fallback, returns top 3 songs.
  // Stub for Phase 0.
  app.get('/next', async (req, reply) => {
    return reply.code(501).send({
      error: 'not_implemented',
      message: 'Hendrix /next stub. To be wired against Card 18 + Card 8 resolver.',
    })
  })
}
