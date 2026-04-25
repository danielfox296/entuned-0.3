import type { FastifyPluginAsync } from 'fastify'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    ok: true,
    service: 'entuned-0.3 server',
    ts: new Date().toISOString(),
  }))
}
