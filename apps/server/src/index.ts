import Fastify from 'fastify'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'
import { hendrixRoutes } from './routes/hendrix.js'
import { eventsRoutes } from './routes/events.js'
import { authRoutes } from './routes/auth.js'

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : undefined,
  },
})

await app.register(cors, { origin: true })
await app.register(healthRoutes)
await app.register(hendrixRoutes, { prefix: '/hendrix' })
await app.register(eventsRoutes, { prefix: '/events' })
await app.register(authRoutes, { prefix: '/auth' })

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
