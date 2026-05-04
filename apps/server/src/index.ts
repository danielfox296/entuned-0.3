import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { healthRoutes } from './routes/health.js'
import { hendrixRoutes } from './routes/hendrix.js'
import { eventsRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'
import { loginRoutes } from './routes/login.js'
import { adminRoutes } from './routes/admin.js'
import { billingRoutes } from './routes/billing.js'
import { sessionPlugin } from './lib/session.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
  },
  // Prisma returns BigInt for byteSize; JSON.stringify can't handle it natively.
  serializerOpts: {
    bigint: true,
  },
})

// Convert any BigInt values to Number before JSON serialization.
app.addHook('preSerialization', async (_req, _reply, payload) => {
  return JSON.parse(JSON.stringify(payload, (_k, v) => typeof v === 'bigint' ? Number(v) : v))
})

await app.register(cors, { origin: true })
await app.register(rateLimit, { global: false })
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
// sessionPlugin must be registered BEFORE any route plugin that reads cookies / uses requireAuth.
// It registers @fastify/cookie and an onRequest hook that resolves request.user / request.account.
await app.register(sessionPlugin)
await app.register(healthRoutes)
await app.register(hendrixRoutes, { prefix: '/hendrix' })
await app.register(eventsRoutes, { prefix: '/events' })
await app.register(authRoutes, { prefix: '/auth' })
// Customer dashboard auth routes. Mounted at `/login` (NOT `/auth`) to avoid a route
// collision with the Operator `GET /auth/me`. So the spec routes resolve as:
//   POST /login/magic-link, GET /login/verify, GET /login/google,
//   GET  /login/google/callback, POST /login/logout, GET /login/me
// See login.ts top-of-file note.
await app.register(loginRoutes, { prefix: '/login' })
await app.register(adminRoutes, { prefix: '/admin' })
// Billing — registered with NO prefix because the routes themselves carry
// their full paths (`/billing/*` and `/webhooks/stripe`). The plugin
// installs its own content-type parser inside its encapsulated scope so the
// Stripe webhook receives the raw request body for signature verification.
await app.register(billingRoutes)

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
