// Shared Fastify in-process test helper.
//
// Builds a real Fastify instance with one route plugin registered, ready to
// receive requests via `app.inject()`. Used by every integration test under
// `apps/server/src/routes/*.test.ts`.
//
// Two reasons we use the real Fastify instance instead of stubbing the
// handler: (1) zod body parsing, error replies, and the `request.params`
// shape all flow through Fastify's lifecycle, so a wholly-mocked handler
// would test a different code path than production; (2) the inject API is
// fast enough (~1ms per call) that there's no performance reason to stub.
//
// External I/O (Prisma, fetch, Anthropic SDK) must be mocked separately in
// the test file via `vi.mock(...)`. See TESTING.md for the conventions.

import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify'

export interface BuildTestAppOptions {
  /** Path prefix to register the plugin under. Mirrors the prefix the route
   * file is mounted at in `apps/server/src/index.ts`. */
  prefix?: string
}

/**
 * Spin up a Fastify instance, register the given route plugin, and return it
 * after `app.ready()`. Logging is silenced; the instance is otherwise the
 * same Fastify you'd see in production.
 *
 * @example
 *   const app = await buildTestApp(storeRoutes)
 *   const res = await app.inject({ method: 'GET', url: '/by-slug/abc' })
 *   expect(res.statusCode).toBe(200)
 *
 * @example with prefix matching prod
 *   const app = await buildTestApp(meRoutes, { prefix: '/me' })
 */
export async function buildTestApp(
  plugin: FastifyPluginAsync,
  options: BuildTestAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(plugin, options.prefix ? { prefix: options.prefix } : {})
  await app.ready()
  return app
}
