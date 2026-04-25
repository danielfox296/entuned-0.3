import type { FastifyPluginAsync } from 'fastify'

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  // POST /events
  // Append-only AudioEvent ingest from Oscar. Accepts out-of-order arrivals (offline buffering).
  // Stub for Phase 0.
  app.post('/', async (req, reply) => {
    return reply.code(501).send({
      error: 'not_implemented',
      message: 'AudioEvent ingest stub. To be wired against Card 20.',
    })
  })
}
