import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db.js'
import { verify, isAccountAuthorizedForStore } from '../lib/auth.js'
import { getPublicKey, isPushConfigured } from '../lib/push.js'

const SubscribeSchema = z.object({
  store_id: z.string().uuid(),
  endpoint: z.string().url(),
  p256dh_key: z.string().min(1),
  auth_key: z.string().min(1),
  user_agent: z.string().max(500).optional(),
  // Slug-mode auth — no Bearer token, the slug itself is the auth signal.
  slug: z.string().min(1).optional(),
})

const UnsubscribeSchema = z.object({ endpoint: z.string().url() })

export const pushRoutes: FastifyPluginAsync = async (app) => {
  // GET /push/vapid-public-key — the player fetches this on first subscribe.
  // No auth required: the public key is public by design.
  app.get('/vapid-public-key', async (_req, reply) => {
    const key = getPublicKey()
    if (!key) return reply.code(503).send({ error: 'push_not_configured' })
    return { publicKey: key, configured: isPushConfigured() }
  })

  // POST /push/subscribe — register (or refresh) a device subscription. Idempotent
  // on the endpoint UNIQUE — repeated subscribes just update keys + accountId.
  app.post('/subscribe', async (req, reply) => {
    const parsed = SubscribeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' })

    // Auth: either a Bearer token (operator mode) or a slug that maps to the store.
    let accountId: string | null = null
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      const payload = verify(auth.slice(7))
      if (!payload) return reply.code(401).send({ error: 'invalid_token' })
      const ok = await isAccountAuthorizedForStore(payload.accountId, parsed.data.store_id)
      if (!ok) return reply.code(403).send({ error: 'forbidden' })
      accountId = payload.accountId
    } else if (parsed.data.slug) {
      const store = await prisma.store.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } })
      if (!store || store.id !== parsed.data.store_id) {
        return reply.code(403).send({ error: 'forbidden' })
      }
    } else {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const row = await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      update: {
        storeId: parsed.data.store_id,
        accountId,
        p256dhKey: parsed.data.p256dh_key,
        authKey: parsed.data.auth_key,
        userAgent: parsed.data.user_agent ?? null,
      },
      create: {
        storeId: parsed.data.store_id,
        accountId,
        endpoint: parsed.data.endpoint,
        p256dhKey: parsed.data.p256dh_key,
        authKey: parsed.data.auth_key,
        userAgent: parsed.data.user_agent ?? null,
      },
    })

    return reply.code(201).send({ id: row.id })
  })

  // POST /push/unsubscribe — remove a subscription by endpoint. No auth: anyone
  // holding the endpoint can unsubscribe it (matches Web Push semantics — the
  // user agent owns the endpoint).
  app.post('/unsubscribe', async (req, reply) => {
    const parsed = UnsubscribeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' })
    await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint } })
    return reply.code(204).send()
  })
}
