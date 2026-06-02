import Fastify, { type FastifyError } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import fastifyCookie from '@fastify/cookie'
import cron from 'node-cron'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { AppError, sendError } from './lib/http-errors.js'
import { healthRoutes } from './routes/health.js'
import { hendrixRoutes } from './routes/hendrix.js'
import { storeRoutes } from './routes/stores.js'
import { eventsRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'
import { loginRoutes } from './routes/login.js'
import { adminRoutes } from './routes/admin.js'
import { adminRetentionRoutes } from './routes/admin-retention.js'
import { adminReliabilityRoutes } from './routes/admin-reliability.js'
import { adminImportRoutes } from './routes/admin-imports.js'
import { billingRoutes } from './routes/billing.js'
import { meRoutes } from './routes/me.js'
import { emailRoutes } from './routes/email.js'
import { pushRoutes } from './routes/push.js'
import { devLoginRoutes } from './routes/dev-login.js'
import { sessionPlugin } from './lib/session.js'
import { seedEmailTemplates } from './lib/email.js'
import { runLifecycleEmails } from './lib/lifecycleEmails.js'
import { runPauseAutoResume } from './lib/pauseAutoResume.js'
import { runCompExpiryCron } from './lib/compExpiry.js'
import { runBoostTrialClockActivation } from './lib/boostTrialClock.js'
import { runPlaybackHeartbeat } from './lib/playbackHeartbeat.js'
import { isPushConfigured } from './lib/push.js'

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

// Global error handler — the safety net for anything that propagates as a
// *throw* out of a route handler (uncaught exception, rejected promise, a
// thrown AppError / ZodError / Prisma known error). Routes that send their own
// `reply.code(...).send({ error })` envelopes by hand are unaffected: they
// never reach here. The envelope is always `{ error: <code>, details? }`.
app.setErrorHandler((error: FastifyError, request, reply) => {
  // Zod parse failure (a thrown `schema.parse(...)`). Hand-rolled
  // `safeParse` sites already send their own envelope, so this only fires for
  // the throwing form.
  if (error instanceof ZodError) {
    return sendError(reply, 400, 'bad_body', error.flatten())
  }

  // Application errors carry their own status + code.
  if (error instanceof AppError) {
    return sendError(reply, error.status, error.code, error.details)
  }

  // Prisma known request errors: missing row → 404, unique violation → 409.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') return sendError(reply, 404, 'not_found')
    if (error.code === 'P2002') return sendError(reply, 409, 'duplicate')
  }

  // Fastify schema validation errors (e.g. JSON-schema body validation).
  if (error.validation) {
    return sendError(reply, 400, 'bad_body', error.validation)
  }

  // Fastify's own thrown HTTP errors (e.g. bad JSON → 400) carry a statusCode.
  // Preserve a client-error status if present; otherwise treat as a 500.
  const status = error.statusCode ?? 500
  if (status >= 400 && status < 500) {
    return sendError(reply, status, error.code ?? 'bad_request')
  }

  // Everything else is an unexpected server fault. Log the real error
  // server-side; never leak internals (message/stack) to the client.
  request.log.error({ err: error }, 'unhandled_error')
  return sendError(reply, 500, 'internal')
})

// Uniform 404 for unmatched routes.
app.setNotFoundHandler((_request, reply) => {
  return sendError(reply, 404, 'not_found')
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
await app.register(adminRetentionRoutes, { prefix: '/admin' })
await app.register(adminReliabilityRoutes, { prefix: '/admin' })
await app.register(adminImportRoutes, { prefix: '/admin' })
// Billing — registered with NO prefix because the routes themselves carry
// their full paths (`/billing/*` and `/webhooks/stripe`). The plugin
// installs its own content-type parser inside its encapsulated scope so the
// Stripe webhook receives the raw request body for signature verification.
await app.register(billingRoutes)
await app.register(meRoutes, { prefix: '/me' })
await app.register(emailRoutes, { prefix: '/email' })
await app.register(pushRoutes, { prefix: '/push' })
// Dev-only auth bypass. Self-disables when DEV_LOGIN_TOKEN is unset (404s),
// so leaving it always-registered is safe — production Railway must never
// set DEV_LOGIN_TOKEN. See routes/dev-login.ts.
await app.register(devLoginRoutes)

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
    // Activate Boost Trial clocks for stores whose first generation just landed.
    // Runs before lifecycle drips so newly-activated trials reach the correct
    // drip bucket (day-1, day-3 stream-ready, etc.) on the same tick.
    try {
      const stats = await runBoostTrialClockActivation()
      app.log.info({ stats }, 'boost_trial_clock_activation_tick_complete')
    } catch (err) {
      app.log.error({ err }, 'boost_trial_clock_activation_tick_failed')
    }
    try {
      const stats = await runLifecycleEmails()
      app.log.info({ stats }, 'lifecycle_drip_tick_complete')
    } catch (err) {
      app.log.error({ err }, 'lifecycle_drip_tick_failed')
    }
    // Comp expiry runs after lifecycle drips so a Store that aged past its
    // comp gets the final compEnded email even if a separate lifecycle
    // template would have qualified mid-comp (lifecycle templates check
    // effective tier — once the comp expires here, downstream ticks see
    // the customer at their paid tier and route correctly).
    try {
      const stats = await runCompExpiryCron()
      app.log.info({ stats }, 'comp_expiry_tick_complete')
    } catch (err) {
      app.log.error({ err }, 'comp_expiry_tick_failed')
    }
  }, { timezone: 'America/Denver' })
  app.log.info('daily_cron_registered (9am America/Denver — auto-resume + boost-trial clock + lifecycle drips + comp expiry)')
}

// Playback heartbeat — every 5 min, find active stores that went silent
// without explicit operator pause and fire a "music paused — tap to resume"
// web push. Skipped entirely when VAPID isn't configured so dev / CI don't
// hammer the DB looking for subscriptions that can't be reached anyway.
if (process.env.PLAYBACK_HEARTBEAT_DISABLED !== '1' && isPushConfigured()) {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const stats = await runPlaybackHeartbeat()
      if (stats.nudged > 0 || stats.expired > 0) {
        app.log.info({ stats }, 'playback_heartbeat_tick_complete')
      }
    } catch (err) {
      app.log.error({ err }, 'playback_heartbeat_tick_failed')
    }
  })
  app.log.info('playback_heartbeat_cron_registered (every 5min)')
}

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
