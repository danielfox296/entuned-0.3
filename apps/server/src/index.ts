import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { healthRoutes } from './routes/health.js'
import { hendrixRoutes } from './routes/hendrix.js'
import { eventsRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'
import { adminRoutes } from './routes/admin.js'

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
await app.register(healthRoutes)
await app.register(hendrixRoutes, { prefix: '/hendrix' })
await app.register(eventsRoutes, { prefix: '/events' })
await app.register(authRoutes, { prefix: '/auth' })
await app.register(adminRoutes, { prefix: '/admin' })

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
