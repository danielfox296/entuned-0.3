import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { login, verify } from '../lib/auth.js'
import { prisma } from '../db.js'

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) })

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
      },
    },
  }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const result = await login(parsed.data.email, parsed.data.password)
    if (!result) return reply.code(401).send({ error: 'invalid_credentials' })

    // Log operator_login as an AudioEvent? Per Card 19, operator_login is an Oscar-emitted event tied to a store.
    // The /auth/login endpoint itself is store-agnostic (could be admin), so don't log here. Oscar will emit
    // operator_login separately once the operator picks/enters a store context.

    return {
      token: result.token,
      operator: {
        id: result.operator.operatorId,
        email: result.operator.email,
        isAdmin: result.operator.isAdmin,
      },
    }
  })

  // GET /auth/me — verify a token and return operator + their store assignments.
  app.get('/me', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' })
    const payload = verify(auth.slice(7))
    if (!payload) return reply.code(401).send({ error: 'invalid_token' })

    const op = await prisma.operator.findUnique({
      where: { id: payload.operatorId },
      include: payload.isAdmin ? undefined : {
        storeAssignments: { include: { store: true } },
      },
    })
    if (!op || op.disabledAt) return reply.code(401).send({ error: 'operator_disabled' })

    let stores: { id: string; name: string }[]
    if (op.isAdmin) {
      stores = (await prisma.store.findMany({ select: { id: true, name: true } }))
    } else {
      stores = (op as any).storeAssignments.map((a: any) => ({ id: a.store.id, name: a.store.name }))
    }
    return {
      operator: { id: op.id, email: op.email, displayName: op.displayName, isAdmin: op.isAdmin },
      stores,
    }
  })
}
