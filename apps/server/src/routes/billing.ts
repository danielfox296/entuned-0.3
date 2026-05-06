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
import { effectiveTier, tierRank, applyTierChange } from '../lib/tier.js'

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
          // If the customer changed plan via the Customer Portal, the price
          // id on the sub will differ from what we have on Store.tier.
          // Re-derive paid tier from the new price and write it through
          // applyTierChange so the audit log records the transition.
          await syncStoreTierFromSubscription(sub)
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

  // ----- GET /billing/upgrade-from-comp — convert a comped tier into a real paid sub -----
  //
  // Linked from compEnding / compEnded emails. Two cases:
  //
  //   A) Store already has a Stripe subscription (Core paid, comped to Pro):
  //      swap the subscription's price to the comp tier's price, with
  //      proration. Local Store.tier syncs via the customer.subscription.updated
  //      webhook (which also auto-clears the comp). Redirect to
  //      app.entuned.co/account?upgrade=success.
  //
  //   B) Store has no Stripe subscription yet (Free, comped to Core):
  //      redirect to a fresh Stripe Checkout session at the comp tier.
  //      The webhook on completion absorbs the orphan free Store and
  //      auto-clears the comp.
  //
  // Auth: requires a cookie session. If the user clicks the email while
  // logged out, requireAuth's 401 isn't friendly — instead we 302 to
  // /start?next=… so they can magic-link in and bounce back. Same UX as
  // the player binding flow.
  app.get('/billing/upgrade-from-comp', async (req, reply) => {
    const storeId = (req.query as { store?: string } | undefined)?.store
    if (!storeId) return reply.code(400).send({ error: 'missing_store_param' })

    if (!req.user || !req.account) {
      // /start passes `next` through both magic-link verify and Google OAuth
      // so the user lands back here after auth. The server validates `next`
      // against an APP_URL/API_URL origin allowlist (see safeNext in login.ts)
      // before honoring it.
      const apiBase = process.env.API_URL ?? 'https://api.entuned.co'
      const next = encodeURIComponent(`${apiBase}/billing/upgrade-from-comp?store=${storeId}`)
      return reply.redirect(`${APP_URL}/start?next=${next}`, 302)
    }
    const clientId = req.account.id

    const store = await prisma.store.findFirst({
      where: { id: storeId, clientId, archivedAt: null },
      include: { subscription: true },
    })
    if (!store) {
      return reply.redirect(`${APP_URL}/account?upgrade=not_found`, 302)
    }
    if (!store.compTier) {
      // Comp already cleared (expired + cron ran, or operator revoked, or
      // they already upgraded). Send them to /account to see their state.
      return reply.redirect(`${APP_URL}/account?upgrade=no_comp`, 302)
    }

    // Enterprise is intentionally excluded from the comp grant API, so
    // store.compTier is guaranteed to be 'core' or 'pro' here. If a legacy
    // Enterprise comp exists from before that restriction landed, we fall
    // back to /account rather than crashing.
    const targetTier = store.compTier as 'core' | 'pro'
    if ((targetTier as string) === 'enterprise') {
      return reply.redirect(`${APP_URL}/account?upgrade=unsupported_tier`, 302)
    }
    const targetPriceId = TIER_TO_PRICE[targetTier]
    if (!targetPriceId) {
      return reply.redirect(`${APP_URL}/account?upgrade=price_misconfigured`, 302)
    }

    try {
      // Case A: existing subscription → price swap.
      if (store.subscription) {
        const stripeSub = await stripe.subscriptions.retrieve(store.subscription.stripeSubscriptionId)
        const item = stripeSub.items.data[0]
        if (!item) {
          req.log.error({ storeId, subId: stripeSub.id }, 'upgrade_from_comp_sub_has_no_items')
          return reply.redirect(`${APP_URL}/account?upgrade=stripe_error`, 302)
        }
        await stripe.subscriptions.update(stripeSub.id, {
          items: [{ id: item.id, price: targetPriceId }],
          proration_behavior: 'create_prorations',
        })
        // The customer.subscription.updated webhook will pick up the price
        // change, sync Store.tier, and clear the comp via syncStoreTierFromSubscription.
        return reply.redirect(`${APP_URL}/account?upgrade=success&tier=${targetTier}`, 302)
      }

      // Case B: no subscription yet → fresh Checkout. The webhook on
      // completion will absorb the orphan free Store + auto-clear the comp.
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: targetPriceId, quantity: 1 }],
        success_url: `${APP_URL}/account?upgrade=success&tier=${targetTier}`,
        cancel_url: `${APP_URL}/account?upgrade=canceled`,
        client_reference_id: clientId,
        customer_email: req.user.email,
        metadata: { tier: targetTier, clientId, source: 'upgrade_from_comp' },
        subscription_data: {
          metadata: { tier: targetTier, clientId, source: 'upgrade_from_comp' },
        },
      })
      return reply.redirect(session.url ?? `${APP_URL}/account?upgrade=checkout_error`, 303)
    } catch (err: any) {
      req.log.error({ err, storeId }, 'upgrade_from_comp_failed')
      return reply.redirect(`${APP_URL}/account?upgrade=stripe_error`, 302)
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
    // Comped accounts have no Stripe subscription — skip the billing step.
    const isComped = !existing.subscription && !!existing.compTier
    if (!existing.subscription && !isComped) {
      return reply.code(400).send({ error: 'no_subscription_on_existing_store' })
    }

    try {
      if (!isComped) {
        // 1) Bump the existing subscription's quantity by one.
        const stripeSub = await stripe.subscriptions.retrieve(existing.subscription!.stripeSubscriptionId)
        const item = stripeSub.items.data[0]
        if (!item) return reply.code(500).send({ error: 'stripe_subscription_has_no_items' })
        await stripe.subscriptions.update(stripeSub.id, {
          items: [{ id: item.id, quantity: (item.quantity ?? 1) + 1 }],
          proration_behavior: 'create_prorations',
        })
      }

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
          // Propagate comp so the new location has the same entitlement.
          ...(isComped && {
            compTier: existing.compTier,
            compExpiresAt: existing.compExpiresAt,
            compReason: existing.compReason,
            compGrantedById: existing.compGrantedById,
            compGrantedAt: existing.compGrantedAt,
          }),
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
      const fromEffective = effectiveTier(store)
      // Pause drops paid tier to 'free' AND clears any active comp — pausing
      // a comped Pro Store should not leave the comp covering for the pause.
      // Operator must re-grant on resume if desired.
      await applyTierChange({
        storeId: store.id,
        fromTier: fromEffective,
        data: {
          pausedUntil,
          tier: 'free',
          compTier: null,
          compExpiresAt: null,
          compReason: null,
          compGrantedById: null,
          compGrantedAt: null,
        },
        source: 'pause',
        actorId: null,
        reason: store.compTier ? `pause cleared active comp (${store.compTier})` : null,
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
      const fromEffective = effectiveTier(store)
      await applyTierChange({
        storeId: store.id,
        fromTier: fromEffective,
        data: { pausedUntil: null, tier: restoredTier },
        source: 'resume',
        actorId: null,
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

  // 2) Store. If this Client has an auto-provisioned free Store with no Subscription
  //    (the one created at first sign-in), transmute it into the paid Store rather
  //    than creating a sibling. Keeps one Client = N paid Stores per billing decision
  //    #6 and preserves any music.entuned.co/<slug> URL the customer already shared.
  //    Falls through to a fresh Store if there's no orphan to absorb (e.g. user already
  //    has a paid Store and is re-checking-out for some reason).
  const orphanFreeStore = await prisma.store.findFirst({
    where: {
      clientId: client.id,
      tier: 'free',
      archivedAt: null,
      subscription: { is: null },
    },
    orderBy: { createdAt: 'asc' },
  })

  let store: { id: string; slug: string }
  if (orphanFreeStore) {
    // Look up the orphan's full state so we can compute fromEffective and
    // run the comp-clear check (paid tier ≥ comp tier auto-clears comp).
    const orphan = await prisma.store.findUnique({
      where: { id: orphanFreeStore.id },
      select: { id: true, slug: true, tier: true, compTier: true, compExpiresAt: true },
    })
    if (!orphan) throw new Error(`orphan store vanished mid-checkout (id=${orphanFreeStore.id})`)
    const fromEffective = effectiveTier(orphan)
    const willClearComp =
      !!orphan.compTier && tierRank(tier as Tier) >= tierRank(orphan.compTier as Tier)

    await applyTierChange({
      storeId: orphan.id,
      fromTier: fromEffective,
      data: {
        tier,
        ...(willClearComp
          ? {
              compTier: null,
              compExpiresAt: null,
              compReason: null,
              compGrantedById: null,
              compGrantedAt: null,
            }
          : {}),
      },
      source: willClearComp ? 'auto_cleared' : 'stripe_webhook',
      actorId: null,
      reason: willClearComp
        ? `paid tier ${tier} via checkout; comp ${orphan.compTier} auto-cleared`
        : null,
    })
    store = { id: orphan.id, slug: orphan.slug }
  } else {
    const baseName = client.name ?? (email ? email.split('@')[0] : 'Store')
    const newSlug = await uniqueStoreSlug(baseName)
    store = await prisma.store.create({
      data: {
        clientId: client.id,
        name: `${baseName} — Main`,
        slug: newSlug,
        tier,
        timezone: 'America/Denver',
      },
      select: { id: true, slug: true },
    })
    // Fresh paid Store — log a 'free → paid' transition (from is implicitly
    // 'free' since the row was just created at the paid tier; we still want
    // an entry in tier_change_logs for completeness).
    await prisma.tierChangeLog.create({
      data: {
        storeId: store.id,
        fromTier: 'free',
        toTier: tier,
        source: 'stripe_webhook',
        reason: `initial paid checkout (${tier})`,
      },
    })
  }
  const slug = store.slug

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

/**
 * Map a Stripe price id to one of our tier strings. Returns null if the
 * price id doesn't match a tier we recognize (in which case we leave the
 * Store tier alone — better than wiping it on a misconfigured price).
 */
function tierFromPriceId(priceId: string | undefined | null): Tier | null {
  if (!priceId) return null
  if (priceId === STRIPE_PRICE_ID_PRO) return 'pro'
  if (priceId === STRIPE_PRICE_ID_CORE) return 'core'
  return null
}

/**
 * Reconcile a Store's `tier` with the price id on its Stripe subscription.
 * Called from `customer.subscription.updated` so plan changes via Customer
 * Portal are reflected locally. Also invokes the comp-clear rule: if the
 * new paid tier ranks ≥ active comp, comp is cleared with source=auto_cleared.
 *
 * No-op if the local Subscription/Store can't be resolved or the price id
 * doesn't map to a known tier.
 */
async function syncStoreTierFromSubscription(sub: Stripe.Subscription): Promise<void> {
  const newPriceId = sub.items.data[0]?.price.id
  const newPaidTier = tierFromPriceId(newPriceId)
  if (!newPaidTier) return

  const subRow = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: sub.id },
    include: { store: { select: { id: true, tier: true, compTier: true, compExpiresAt: true } } },
  })
  if (!subRow?.store) return

  const store = subRow.store
  const fromEffective = effectiveTier(store)
  const willClearComp =
    !!store.compTier && tierRank(newPaidTier) >= tierRank(store.compTier as Tier)

  // Update Subscription.stripePriceId regardless (cheap, keeps cache fresh).
  await prisma.subscription.update({
    where: { id: subRow.id },
    data: { stripePriceId: newPriceId ?? subRow.stripePriceId },
  })

  if (store.tier === newPaidTier && !willClearComp) return

  // Two logical operations: (1) update paid tier, (2) maybe clear comp.
  // applyTierChange writes one log row using fromEffective → final effective
  // post-update. If both happen we want a single transition row, not two.
  await applyTierChange({
    storeId: store.id,
    fromTier: fromEffective,
    data: {
      tier: newPaidTier,
      ...(willClearComp
        ? {
            compTier: null,
            compExpiresAt: null,
            compReason: null,
            compGrantedById: null,
            compGrantedAt: null,
          }
        : {}),
    },
    source: willClearComp ? 'auto_cleared' : 'stripe_webhook',
    actorId: null,
    reason: willClearComp
      ? `paid tier upgraded to ${newPaidTier}; comp ${store.compTier} auto-cleared`
      : null,
  })
}
