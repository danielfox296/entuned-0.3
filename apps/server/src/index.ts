import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyCookie from '@fastify/cookie'
import cron from 'node-cron'
import { healthRoutes } from './routes/health.js'
import { hendrixRoutes } from './routes/hendrix.js'
import { storeRoutes } from './routes/stores.js'
import { eventsRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'
import { loginRoutes } from './routes/login.js'
import { adminRoutes } from './routes/admin.js'
import { billingRoutes } from './routes/billing.js'
import { meRoutes } from './routes/me.js'
import { emailRoutes } from './routes/email.js'
import { sessionPlugin } from './lib/session.js'
import { seedEmailTemplates } from './lib/email.js'
import { runLifecycleEmails } from './lib/lifecycleEmails.js'
import { runPauseAutoResume } from './lib/pauseAutoResume.js'

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
await app.register(emailRoutes, { prefix: '/email' })

// Boot-time seed: ensure each DB-editable email template has a row. Idempotent —
// never overwrites existing rows so operator edits survive deploys.
try {
  const { created } = await seedEmailTemplates()
  if (created.length > 0) {
    app.log.info({ created }, 'email_templates_seeded')
  }
} catch (err) {
  app.log.error({ err }, 'email_template_seed_failed')
}

// Daily lifecycle email + pause-auto-resume tick — 9am America/Denver.
// node-cron handles DST. LIFECYCLE_DRIPS_DISABLED=1 skips registration
// (one-off scripts / CI). The auto-resume scan runs first so any Store whose
// pause expired today is back on the customer's tier before the day-53
// pauseEnding warning emails fire (they only target windows still ≥6 days out,
// so order matters less than logging cleanly). Each tick logs structured stats.
if (process.env.LIFECYCLE_DRIPS_DISABLED !== '1') {
  cron.schedule('0 9 * * *', async () => {
    try {
      const resume = await runPauseAutoResume()
      app.log.info({ resume }, 'pause_auto_resume_tick_complete')
    } catch (err) {
      app.log.error({ err }, 'pause_auto_resume_tick_failed')
    }
    try {
      const stats = await runLifecycleEmails()
      app.log.info({ stats }, 'lifecycle_drip_tick_complete')
    } catch (err) {
      app.log.error({ err }, 'lifecycle_drip_tick_failed')
    }
  }, { timezone: 'America/Denver' })
  app.log.info('daily_cron_registered (9am America/Denver — auto-resume + lifecycle drips)')
}

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
