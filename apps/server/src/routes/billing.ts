// Billing routes — Stripe Checkout + Customer Portal + webhook handler.
//
// Post-merger 2026-05-04: customer = `Client`, site = `Store`. The earlier
// `Account`/`Location` models were merged into `Client`/`Store` (UUIDs
// preserved). All Prisma calls in this file work against Client/Store.
//
// Webhook signature verification requires the *raw* request body. The route
// is registered with a custom application/json content-type parser inside
// this plugin (scoped via fastify-plugin's encapsulation) so that ONLY the
// `/webhooks/stripe` route receives the raw string; every other JSON route
// in the app continues to use Fastify's default JSON parser.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import Stripe from 'stripe'
import { prisma } from '../db.js'
import { requireAuth } from '../lib/session.js'
import { sendWelcome, sendDunning } from '../lib/email.js'
import { uniqueStoreSlug } from '../lib/account.js'

// ---------- env ----------

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''
const STRIPE_PRICE_ID_CORE = process.env.STRIPE_PRICE_ID_CORE ?? ''
const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO ?? ''
// APP_URL is the customer dashboard root (set by lib/session.ts contract).
// Prod: https://app.entuned.co. Used for Checkout success_url and the
// post-login destination linked from emails.
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const WEBSITE_URL = process.env.WEBSITE_URL ?? 'https://entuned.co'
const PLAYER_URL = process.env.PLAYER_URL ?? 'https://music.entuned.co'

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion })

// ---------- types ----------

type Tier = 'core' | 'pro'

const TIER_TO_PRICE: Record<Tier, string> = {
  core: STRIPE_PRICE_ID_CORE,
  pro: STRIPE_PRICE_ID_PRO,
}

// ---------- helpers ----------

interface AuthedClient {
  clientId: string
  email: string
}

/**
 * Resolve the authenticated client from the session middleware
 * (`req.account` / `req.user`). The session field is named `account` for
 * backward-compat but post-merger carries the Client. Returns null after
 * sending a 401 response if the request is not authenticated.
 */
function getClient(req: FastifyRequest, reply: FastifyReply): AuthedClient | null {
  if (!req.user || !req.account) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  return { clientId: req.account.id, email: req.user.email }
}

/**
 * Find an existing Client by the User's email (via membership), else create
 * a fresh User + Client + Membership. Returns the Client id + display name.
 *
 * Used by the Stripe webhook to attach a paid Store to the right Client.
 * Distinct from `ensureFreeClientForUser` (which also provisions a free
 * Store) — the webhook does Store creation itself, with the paid tier.
 */
async function findOrCreateClientByEmail(
  email: string,
  name?: string,
): Promise<{ id: string; email: string; name: string }> {
  const normalized = email.trim().toLowerCase()

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    include: {
      memberships: { include: { client: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  })
  if (user?.memberships?.[0]?.client) {
    const c = user.memberships[0].client
    return { id: c.id, email: normalized, name: c.companyName }
  }

  // No membership yet — but maybe an operator-managed Client matches by contact_email.
  const operatorClient = await prisma.client.findFirst({
    where: { contactEmail: normalized },
  })
  if (operatorClient) {
    // Ensure User exists, then attach membership.
    const u = user ?? await prisma.user.create({
      data: { email: normalized, name: name ?? null },
    })
    await prisma.clientMembership.create({
      data: { clientId: operatorClient.id, userId: u.id, role: 'owner' },
    })
    return { id: operatorClient.id, email: normalized, name: operatorClient.companyName }
  }

  // Fresh User + Client + Membership.
  const companyName = name ?? normalized.split('@')[0] ?? 'Account'
  const client = await prisma.client.create({
    data: { companyName },
  })
  const u = user ?? await prisma.user.create({
    data: { email: normalized, name: name ?? null },
  })
  await prisma.clientMembership.create({
    data: { clientId: client.id, userId: u.id, role: 'owner' },
  })
  return { id: client.id, email: normalized, name: client.companyName }
}

// ---------- schemas ----------

const CheckoutBody = z.object({
  tier: z.enum(['core', 'pro']),
  email: z.string().email().optional(),
  clientId: z.string().optional(),
})

const NewStoreBody = z.object({ name: z.string().min(1) })
const StoreIdBody = z.object({ storeId: z.string().min(1) })

// ---------- plugin ----------

export const billingRoutes: FastifyPluginAsync = async (app) => {
  // Stripe webhook signature verification needs the *unparsed* body. Fastify
  // content-type parsers added inside an encapsulated plugin only affect
  // that plugin's scope, so we override the JSON parser here for the
  // webhook path. Any other JSON route registered inside this plugin
  // (currently only /billing/checkout) will fall back to JSON.parse.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      // Stripe webhook: hand back the raw string for signature verification.
      if (req.routeOptions?.url === '/webhooks/stripe') {
        done(null, body)
        return
      }
      try {
        const json = body ? JSON.parse(body as string) : {}
        done(null, json)
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  // ----- POST /billing/checkout — create a Stripe Checkout Session -----
  app.post('/billing/checkout', async (req, reply) => {
    const parsed = CheckoutBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })
    const { tier, email, clientId } = parsed.data

    const priceId = TIER_TO_PRICE[tier]
    if (!priceId) {
      return reply.code(500).send({ error: 'price_not_configured', tier })
    }

    // For guest checkouts we mint a UUID up front so the webhook can correlate
    // back to the originating request (and so the response can return
    // something a thank-you page could persist locally).
    const clientReferenceId = clientId ?? randomUUID()

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}/welcome?session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${WEBSITE_URL}/pricing.html`,
        client_reference_id: clientReferenceId,
        ...(email ? { customer_email: email } : {}),
        metadata: { tier, clientId: clientId ?? '', guestRef: clientId ? '' : clientReferenceId },
        subscription_data: {
          metadata: { tier, clientId: clientId ?? '', guestRef: clientId ? '' : clientReferenceId },
        },
      })

      return reply.send({
        url: session.url,
        sessionId: session.id,
        clientReferenceId,
      })
    } catch (err: any) {
      req.log.error({ err }, 'stripe_checkout_create_failed')
      return reply.code(502).send({ error: 'stripe_error', message: err?.message ?? 'unknown' })
    }
  })

  // Convenience: GET form so the website's <a href> can link straight to
  // checkout without a JS step. Forwards to the POST handler.
  app.get('/billing/checkout', async (req, reply) => {
    const tier = (req.query as any)?.tier
    if (tier !== 'core' && tier !== 'pro') {
      return reply.code(400).send({ error: 'bad_tier' })
    }
    const priceId = TIER_TO_PRICE[tier as Tier]
    if (!priceId) return reply.code(500).send({ error: 'price_not_configured', tier })
    const clientReferenceId = randomUUID()
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}/welcome?session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${WEBSITE_URL}/pricing.html`,
        client_reference_id: clientReferenceId,
        metadata: { tier, clientId: '', guestRef: clientReferenceId },
        subscription_data: { metadata: { tier, clientId: '', guestRef: clientReferenceId } },
      })
      return reply.redirect(session.url ?? `${WEBSITE_URL}/pricing.html`, 303)
    } catch (err: any) {
      req.log.error({ err }, 'stripe_checkout_get_failed')
      return reply.redirect(`${WEBSITE_URL}/pricing.html?checkout=error`, 303)
    }
  })

  // ----- POST /webhooks/stripe — Stripe webhook receiver -----
  // The raw body is required for signature verification. See `index.ts` for
  // the content-type-parser registration that makes `req.body` a raw string
  // for this exact route.
  app.post('/webhooks/stripe', async (req, reply) => {
    const sig = req.headers['stripe-signature']
    if (!sig || typeof sig !== 'string') {
      return reply.code(400).send({ error: 'missing_signature' })
    }
    const raw = req.body
    if (typeof raw !== 'string') {
      return reply.code(400).send({ error: 'expected_raw_body' })
    }

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET)
    } catch (err: any) {
      req.log.warn({ err }, 'stripe_signature_verify_failed')
      return reply.code(400).send({ error: 'bad_signature' })
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          await handleCheckoutCompleted(session)
          break
        }
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription
          await prisma.subscription.updateMany({
            where: { stripeSubscriptionId: sub.id },
            data: {
              status: sub.status,
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
              cancelAtPeriodEnd: sub.cancel_at_period_end,
            },
          })
          break
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription
          await prisma.subscription.updateMany({
            where: { stripeSubscriptionId: sub.id },
            data: { status: 'canceled', cancelAtPeriodEnd: true },
          })
          break
        }
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice
          await handlePaymentFailed(invoice)
          break
        }
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice
          if (invoice.subscription) {
            await prisma.subscription.updateMany({
              where: { stripeSubscriptionId: String(invoice.subscription) },
              data: { dunningAttempt: 0, status: 'active' },
            })
          }
          break
        }
        default:
          // Ignore other events for now; Stripe will not retry on 200.
          break
      }
    } catch (err) {
      req.log.error({ err, type: event.type }, 'stripe_webhook_handler_failed')
      // Return 500 so Stripe retries.
      return reply.code(500).send({ error: 'handler_failed' })
    }

    return reply.send({ received: true })
  })

  // ----- POST /billing/checkout-session/confirm — verify provisioning after checkout -----
  // Called by the dashboard's /welcome page once Stripe redirects back. Looks up the
  // Subscription row created by the webhook; if the webhook hasn't landed yet (or was
  // missed), runs handleCheckoutCompleted inline as a self-heal. Idempotent — relies
  // on the unique constraint on stripeSubscriptionId to safely race with the webhook.
  app.post('/billing/checkout-session/confirm', async (req, reply) => {
    const body = req.body as { sessionId?: string } | undefined
    const sessionId = body?.sessionId
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
      return reply.code(400).send({ error: 'invalid_session_id' })
    }

    let session: Stripe.Checkout.Session
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId)
    } catch (err: any) {
      req.log.warn({ err, sessionId }, 'stripe_session_retrieve_failed')
      return reply.code(404).send({ error: 'session_not_found' })
    }

    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
    if (!subscriptionId) {
      return reply.send({ status: 'pending', account: null })
    }

    let subRow = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      include: { store: { include: { client: true } } },
    })

    if (!subRow) {
      try {
        await handleCheckoutCompleted(session)
      } catch (err: any) {
        // Webhook may have raced and won; the unique constraint trip is fine.
        if (err?.code !== 'P2002') {
          req.log.error({ err, sessionId }, 'checkout_confirm_provision_failed')
          return reply.code(500).send({ error: 'provision_failed' })
        }
      }
      subRow = await prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
        include: { store: { include: { client: true } } },
      })
    }

    if (!subRow?.store?.client) {
      return reply.send({ status: 'pending', account: null })
    }

    const c = subRow.store.client
    // Response field is named `account` for backward-compat with the dashboard.
    return reply.send({
      status: 'provisioned',
      account: { id: c.id, name: c.companyName },
    })
  })

  // ----- GET /billing/portal — Stripe Customer Portal session -----
  app.get('/billing/portal', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return

    // Find any subscription on this client to derive the customer id.
    const sub = await prisma.subscription.findFirst({
      where: { store: { clientId: ctx.clientId } },
      select: { stripeCustomerId: true },
    })
    if (!sub?.stripeCustomerId) {
      return reply.code(404).send({ error: 'no_stripe_customer' })
    }

    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${APP_URL}/settings/billing`,
      })
      return reply.send({ url: portal.url })
    } catch (err: any) {
      req.log.error({ err }, 'stripe_portal_create_failed')
      return reply.code(502).send({ error: 'stripe_error', message: err?.message ?? 'unknown' })
    }
  })

  // ----- POST /billing/stores — add a new Store at the same tier -----
  // ASSUMPTION: per-unit pricing. We add 1 to the existing subscription line's
  // quantity rather than creating a new subscription. Flag this in summary
  // for confirmation — if Stripe pricing is per-subscription instead, this
  // route needs to spin up a second subscription.
  app.post('/billing/stores', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return
    const parsed = NewStoreBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })

    const existing = await prisma.store.findFirst({
      where: { clientId: ctx.clientId, archivedAt: null },
      include: { subscription: true },
    })
    if (!existing) {
      return reply.code(400).send({ error: 'no_existing_store' })
    }
    if (!existing.subscription) {
      return reply.code(400).send({ error: 'no_subscription_on_existing_store' })
    }

    try {
      // 1) Bump the existing subscription's quantity by one.
      const stripeSub = await stripe.subscriptions.retrieve(existing.subscription.stripeSubscriptionId)
      const item = stripeSub.items.data[0]
      if (!item) return reply.code(500).send({ error: 'stripe_subscription_has_no_items' })
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: item.id, quantity: (item.quantity ?? 1) + 1 }],
        proration_behavior: 'create_prorations',
      })

      // 2) Create the new Store record locally. Note: this Store does NOT get
      // its own Subscription row — it shares the existing one via clientId.
      // If you need per-Store subscription lookups, extend the schema with a
      // join model rather than splitting the Stripe sub.
      const slug = await uniqueStoreSlug(parsed.data.name)
      const store = await prisma.store.create({
        data: {
          clientId: ctx.clientId,
          name: parsed.data.name,
          slug,
          tier: existing.tier,
          timezone: existing.timezone,
        },
      })

      return reply.send({ store })
    } catch (err: any) {
      req.log.error({ err }, 'add_store_failed')
      return reply.code(502).send({ error: 'stripe_error', message: err?.message ?? 'unknown' })
    }
  })

  // ----- POST /billing/pause — pause a Store for 60 days -----
  // We use Stripe's `pause_collection` (behavior=void) so the customer is not
  // charged during the pause window but the subscription stays open. The
  // local Store is marked with `pausedUntil = now + 60d` and tier is dropped
  // to 'free' so the player still works on the free tier during the pause.
  // Stripe will not auto-resume on a date — the operator must hit
  // /billing/resume, OR a scheduled job (out of scope here) can call resume
  // on `pausedUntil`.
  app.post('/billing/pause', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return
    const parsed = StoreIdBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })

    const store = await prisma.store.findFirst({
      where: { id: parsed.data.storeId, clientId: ctx.clientId },
      include: { subscription: true },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    if (!store.subscription) return reply.code(400).send({ error: 'no_subscription' })

    try {
      await stripe.subscriptions.update(store.subscription.stripeSubscriptionId, {
        pause_collection: { behavior: 'void' },
      })
      const pausedUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      await prisma.store.update({
        where: { id: store.id },
        data: { pausedUntil, tier: 'free' },
      })
      await prisma.subscription.update({
        where: { id: store.subscription.id },
        data: { status: 'paused' },
      })
      return reply.send({ ok: true, pausedUntil })
    } catch (err: any) {
      req.log.error({ err }, 'pause_failed')
      return reply.code(502).send({ error: 'stripe_error', message: err?.message ?? 'unknown' })
    }
  })

  // ----- POST /billing/resume — undo a pause -----
  app.post('/billing/resume', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getClient(req, reply)
    if (!ctx) return
    const parsed = StoreIdBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })

    const store = await prisma.store.findFirst({
      where: { id: parsed.data.storeId, clientId: ctx.clientId },
      include: { subscription: true },
    })
    if (!store) return reply.code(404).send({ error: 'store_not_found' })
    if (!store.subscription) return reply.code(400).send({ error: 'no_subscription' })

    try {
      // Restore the original tier from the Stripe price → tier map. We can't
      // reliably know the old tier post-pause without storing it; for now we
      // re-derive from the stored stripePriceId.
      const restoredTier: Tier =
        store.subscription.stripePriceId === STRIPE_PRICE_ID_PRO ? 'pro' : 'core'

      await stripe.subscriptions.update(store.subscription.stripeSubscriptionId, {
        pause_collection: '' as unknown as Stripe.SubscriptionUpdateParams['pause_collection'],
      })
      await prisma.store.update({
        where: { id: store.id },
        data: { pausedUntil: null, tier: restoredTier },
      })
      await prisma.subscription.update({
        where: { id: store.subscription.id },
        data: { status: 'active' },
      })
      return reply.send({ ok: true, tier: restoredTier })
    } catch (err: any) {
      req.log.error({ err }, 'resume_failed')
      return reply.code(502).send({ error: 'stripe_error', message: err?.message ?? 'unknown' })
    }
  })
}

// ---------- webhook handlers ----------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const tier = (session.metadata?.tier as Tier | undefined) ?? 'core'
  // Newer sessions carry `metadata.clientId`; older ones may have `accountId`.
  // After the merger UUIDs are reused, so accountId resolves to the same Client.
  const clientIdMeta = session.metadata?.clientId || session.metadata?.accountId || undefined
  const email = session.customer_details?.email ?? session.customer_email ?? null
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

  if (!subscriptionId || !customerId) {
    throw new Error(`checkout.session.completed missing subscription or customer (session=${session.id})`)
  }

  // Pull the subscription so we can persist period end + price id.
  const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
  const stripePriceId = stripeSub.items.data[0]?.price.id ?? ''
  const periodEnd = new Date(stripeSub.current_period_end * 1000)

  // 1) Resolve Client: existing-by-id (from metadata), else find-or-create-by-email.
  let client: { id: string; email: string; name: string } | null = null
  if (clientIdMeta) {
    const found = await prisma.client.findUnique({ where: { id: clientIdMeta } })
    if (found) client = { id: found.id, email: email ?? '', name: found.companyName }
  }
  if (!client) {
    if (!email) throw new Error('no email on checkout.session and no clientId in metadata')
    client = await findOrCreateClientByEmail(email)
  }

  // Persist the Stripe customer id on the Client if not already set.
  await prisma.client.update({
    where: { id: client.id },
    data: { stripeCustomerId: customerId },
  }).catch(() => undefined)

  // 2) Store with auto slug.
  const baseName = client.name ?? (email ? email.split('@')[0] : 'Store')
  const slug = await uniqueStoreSlug(baseName)
  const store = await prisma.store.create({
    data: {
      clientId: client.id,
      name: `${baseName} — Main`,
      slug,
      tier,
      timezone: 'America/Denver',
    },
  })

  // 3) Subscription row.
  await prisma.subscription.create({
    data: {
      storeId: store.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      stripePriceId,
      status: stripeSub.status,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    },
  })

  // 4) Welcome email.
  const dest = email ?? client.email
  if (dest) {
    const playerUrl = `${PLAYER_URL}/${slug}`
    const dashboardUrl = APP_URL
    await sendWelcome(dest, tier, playerUrl, dashboardUrl).catch(() => undefined)
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return
  const stripeSubId = String(invoice.subscription)

  const sub = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubId },
    include: { store: { include: { client: { include: { memberships: { include: { user: true }, take: 1 } } } } } },
  })
  if (!sub) return

  const nextAttempt = (sub.dunningAttempt ?? 0) + 1
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      dunningAttempt: nextAttempt,
      status: nextAttempt >= 3 ? 'past_due' : sub.status,
    },
  })

  // Pull the first member's email for the dunning notice. If no membership
  // exists (operator-managed Client), fall back to the Client.contactEmail.
  const memberEmail = sub.store.client.memberships[0]?.user.email
  const dest = memberEmail ?? sub.store.client.contactEmail
  if (dest) {
    let portalUrl = `${APP_URL}/settings/billing`
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: portalUrl,
      })
      portalUrl = portal.url
    } catch {
      /* fall back to dashboard URL */
    }
    await sendDunning(dest, nextAttempt as any, portalUrl).catch(() => undefined)
  }
}
