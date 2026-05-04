import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyCookie from '@fastify/cookie'
import { healthRoutes } from './routes/health.js'
import { hendrixRoutes } from './routes/hendrix.js'
import { storeRoutes } from './routes/stores.js'
import { eventsRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'
import { loginRoutes } from './routes/login.js'
import { adminRoutes } from './routes/admin.js'
import { billingRoutes } from './routes/billing.js'
import { meRoutes } from './routes/me.js'
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

// `credentials: true` is required so browsers attach the session cookie on
// cross-origin fetches from app.entuned.co → api.entuned.co. With it, the
// CORS spec also requires Access-Control-Allow-Origin to be a specific
// origin (not `*`); `origin: true` reflects the request origin, which
// satisfies that. Without credentials:true, every dashboard fetch with
// `credentials: 'include'` is blocked client-side ("Failed to fetch").
await app.register(cors, { origin: true, credentials: true })
await app.register(rateLimit, { global: false })
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
// Cookie plugin registered at app scope so reply.setCookie is available to all routes.
await app.register(fastifyCookie)
// sessionPlugin adds the onRequest hook that resolves request.user / request.account.
await app.register(sessionPlugin)
await app.register(healthRoutes)
await app.register(hendrixRoutes, { prefix: '/hendrix' })
await app.register(storeRoutes, { prefix: '/stores' })
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
await app.register(meRoutes, { prefix: '/me' })

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
