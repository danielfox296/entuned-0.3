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
        storeAssignments: { include: { store: { include: { client: { select: { companyName: true } } } } } },
      },
    })
    if (!op || op.disabledAt) return reply.code(401).send({ error: 'operator_disabled' })

    type StoreOut = { id: string; name: string; clientName: string | null }
    let stores: StoreOut[]
    if (op.isAdmin) {
      const rows = await prisma.store.findMany({
        select: { id: true, name: true, client: { select: { companyName: true } } },
      })
      stores = rows.map((s) => ({ id: s.id, name: s.name, clientName: s.client?.companyName ?? null }))
    } else {
      stores = (op as any).storeAssignments.map((a: any) => ({
        id: a.store.id,
        name: a.store.name,
        clientName: a.store.client?.companyName ?? null,
      }))
    }
    // Per "login determines store": non-admin operators are 1:1 with a store.
    // Return `store` (singular) so the player has a strict contract; keep
    // `stores` for admin (cross-store views) and as legacy fallback during
    // rollout.
    const store = !op.isAdmin && stores.length > 0 ? stores[0] : null
    return {
      operator: { id: op.id, email: op.email, displayName: op.displayName, isAdmin: op.isAdmin },
      store,
      stores,
    }
  })
}
