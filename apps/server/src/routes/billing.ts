// Billing routes — Stripe Checkout + Customer Portal + webhook handler.
//
// This module assumes:
//   - `stripe` npm package is installed (listed in summary as a dep to add).
//   - The proposed billing schema (`prisma/schema.proposed-billing.prisma`)
//     has been merged into `schema.prisma` so that `prisma.location`,
//     `prisma.subscription`, and `prisma.account` are available on the
//     PrismaClient. Until merge, `(prisma as any).<model>` calls will
//     throw at runtime — this is intentional (proposal review gate).
//   - `Account` model from agent 2's auth proposal exists with at least
//     `{ id, email, name, stripeCustomerId? }` on it.
//   - `lib/email.ts` exports `sendWelcome` and `sendDunning`.
//   - The auth middleware from agent 2 (`lib/session.ts`) attaches
//     `req.user` / `req.account` via the `entuned_session` cookie. Routes
//     that need an authenticated customer use `requireAuth` as a
//     preHandler.
//
// Webhook signature verification requires the *raw* request body. The route
// is registered with a custom application/json content-type parser inside
// this plugin (scoped via fastify-plugin's encapsulation) so that ONLY the
// `/webhooks/stripe` route receives the raw string; every other JSON route
// in the app continues to use Fastify's default JSON parser.

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID, randomBytes } from 'node:crypto'
import { z } from 'zod'
import Stripe from 'stripe'
import { prisma } from '../db.js'
import { requireAuth } from '../lib/session.js'
import { sendWelcome, sendDunning } from '../lib/email.js'

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
const PLAYER_URL = process.env.PLAYER_URL ?? 'https://play.entuned.co'

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion })

// ---------- types ----------

type Tier = 'core' | 'pro'

const TIER_TO_PRICE: Record<Tier, string> = {
  core: STRIPE_PRICE_ID_CORE,
  pro: STRIPE_PRICE_ID_PRO,
}

// ---------- helpers ----------

function slugify(name: string): string {
  const first = (name.trim().split(/\s+/)[0] ?? 'store').toLowerCase().replace(/[^a-z0-9]/g, '')
  const suffix = randomBytes(2).toString('hex') // 4 hex chars
  return `${first || 'store'}-${suffix}`
}

async function uniqueSlug(name: string): Promise<string> {
  // Retry up to 5 times in the (extremely unlikely) event of collision.
  for (let i = 0; i < 5; i++) {
    const slug = slugify(name)
    const existing = await (prisma as any).location.findUnique({ where: { slug } })
    if (!existing) return slug
  }
  // Last-ditch fallback.
  return `${slugify(name)}-${randomBytes(3).toString('hex')}`
}

interface AuthedAccount {
  accountId: string
  email: string
}

/**
 * Resolve the authenticated account from the session middleware
 * (`req.account` / `req.user`). Returns null after sending a 401/403 response
 * if the request is not authenticated.
 */
function getAccount(req: FastifyRequest, reply: FastifyReply): AuthedAccount | null {
  if (!req.user || !req.account) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  return { accountId: req.account.id, email: req.user.email }
}

async function findOrCreateAccountByEmail(email: string, name?: string): Promise<{ id: string; email: string; name: string | null; stripeCustomerId?: string | null }> {
  const normalized = email.trim().toLowerCase()
  // Find user → first membership account, mirroring the session plugin's
  // resolution path. If no user exists, create User + Account + Membership.
  const user = await (prisma as any).user.findUnique({
    where: { email: normalized },
    include: { memberships: { include: { account: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  })
  if (user?.memberships?.[0]?.account) {
    const a = user.memberships[0].account
    return { id: a.id, email: normalized, name: a.name ?? null }
  }

  // Create a fresh User + Account pair. The exact field set depends on agent
  // 2's User/Account/AccountMembership shape — we use a conservative subset
  // and fall back to direct Account creation if Membership creation fails.
  const accountName = name ?? normalized.split('@')[0] ?? 'Account'
  const account = await (prisma as any).account.create({
    data: {
      name: accountName,
      ...(user
        ? {}
        : { memberships: { create: { user: { create: { email: normalized, name: accountName } }, role: 'owner' } } }),
      ...(user
        ? { memberships: { create: { userId: user.id, role: 'owner' } } }
        : {}),
    },
  })
  return { id: account.id, email: normalized, name: account.name ?? null }
}

// ---------- schemas ----------

const CheckoutBody = z.object({
  tier: z.enum(['core', 'pro']),
  email: z.string().email().optional(),
  accountId: z.string().optional(),
})

const NewLocationBody = z.object({ name: z.string().min(1) })
const PauseBody = z.object({ locationId: z.string().min(1) })

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
    const { tier, email, accountId } = parsed.data

    const priceId = TIER_TO_PRICE[tier]
    if (!priceId) {
      return reply.code(500).send({ error: 'price_not_configured', tier })
    }

    // For guest checkouts we mint a UUID up front so the webhook can correlate
    // back to the originating request (and so the response can return
    // something a thank-you page could persist locally).
    const clientReferenceId = accountId ?? randomUUID()

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}/welcome?session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${WEBSITE_URL}/pricing.html`,
        client_reference_id: clientReferenceId,
        ...(email ? { customer_email: email } : {}),
        metadata: { tier, accountId: accountId ?? '', guestRef: accountId ? '' : clientReferenceId },
        subscription_data: {
          metadata: { tier, accountId: accountId ?? '', guestRef: accountId ? '' : clientReferenceId },
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
        metadata: { tier, accountId: '', guestRef: clientReferenceId },
        subscription_data: { metadata: { tier, accountId: '', guestRef: clientReferenceId } },
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
          await (prisma as any).subscription.updateMany({
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
          await (prisma as any).subscription.updateMany({
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
            await (prisma as any).subscription.updateMany({
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

  // ----- GET /billing/portal — Stripe Customer Portal session -----
  app.get('/billing/portal', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getAccount(req, reply)
    if (!ctx) return

    // Find any subscription on this account to derive the customer id.
    const sub = await (prisma as any).subscription.findFirst({
      where: { location: { accountId: ctx.accountId } },
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

  // ----- POST /billing/locations — add a new Location at the same tier -----
  // ASSUMPTION: per-unit pricing. We add 1 to the existing subscription line's
  // quantity rather than creating a new subscription. Flag this in summary
  // for confirmation — if Stripe pricing is per-subscription instead, this
  // route needs to spin up a second subscription.
  app.post('/billing/locations', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getAccount(req, reply)
    if (!ctx) return
    const parsed = NewLocationBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })

    const existing = await (prisma as any).location.findFirst({
      where: { accountId: ctx.accountId, archivedAt: null },
      include: { subscription: true },
    })
    if (!existing) {
      return reply.code(400).send({ error: 'no_existing_location' })
    }
    if (!existing.subscription) {
      return reply.code(400).send({ error: 'no_subscription_on_existing_location' })
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

      // 2) Create the new Location record locally. Note: this Location does
      // NOT get its own Subscription row — it shares the existing one via
      // accountId. If you need per-Location subscription lookups, extend the
      // schema with a join model rather than splitting the Stripe sub.
      const slug = await uniqueSlug(parsed.data.name)
      const loc = await (prisma as any).location.create({
        data: {
          accountId: ctx.accountId,
          name: parsed.data.name,
          slug,
          tier: existing.tier,
        },
      })

      return reply.send({ location: loc })
    } catch (err: any) {
      req.log.error({ err }, 'add_location_failed')
      return reply.code(502).send({ error: 'stripe_error', message: err?.message ?? 'unknown' })
    }
  })

  // ----- POST /billing/pause — pause a Location for 60 days -----
  // We use Stripe's `pause_collection` (behavior=void) so the customer is not
  // charged during the pause window but the subscription stays open. The
  // local Location is marked with `pausedUntil = now + 60d` and tier is
  // dropped to 'essentials' so the player still works on the free tier
  // during the pause. Stripe will not auto-resume on a date — the operator
  // must hit /billing/resume, OR a scheduled job (out of scope here) can
  // call resume on `pausedUntil`.
  app.post('/billing/pause', { preHandler: requireAuth }, async (req, reply) => {
    const ctx = getAccount(req, reply)
    if (!ctx) return
    const parsed = PauseBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })

    const loc = await (prisma as any).location.findFirst({
      where: { id: parsed.data.locationId, accountId: ctx.accountId },
      include: { subscription: true },
    })
    if (!loc) return reply.code(404).send({ error: 'location_not_found' })
    if (!loc.subscription) return reply.code(400).send({ error: 'no_subscription' })

    try {
      await stripe.subscriptions.update(loc.subscription.stripeSubscriptionId, {
        pause_collection: { behavior: 'void' },
      })
      const pausedUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      await (prisma as any).location.update({
        where: { id: loc.id },
        data: { pausedUntil, tier: 'essentials' },
      })
      await (prisma as any).subscription.update({
        where: { id: loc.subscription.id },
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
    const ctx = getAccount(req, reply)
    if (!ctx) return
    const parsed = PauseBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'bad_body' })

    const loc = await (prisma as any).location.findFirst({
      where: { id: parsed.data.locationId, accountId: ctx.accountId },
      include: { subscription: true },
    })
    if (!loc) return reply.code(404).send({ error: 'location_not_found' })
    if (!loc.subscription) return reply.code(400).send({ error: 'no_subscription' })

    try {
      // Restore the original tier from the Stripe price → tier map. We can't
      // reliably know the old tier post-pause without storing it; for now we
      // re-derive from the stored stripePriceId.
      const restoredTier: Tier =
        loc.subscription.stripePriceId === STRIPE_PRICE_ID_PRO ? 'pro' : 'core'

      await stripe.subscriptions.update(loc.subscription.stripeSubscriptionId, {
        pause_collection: '' as unknown as Stripe.SubscriptionUpdateParams['pause_collection'],
      })
      await (prisma as any).location.update({
        where: { id: loc.id },
        data: { pausedUntil: null, tier: restoredTier },
      })
      await (prisma as any).subscription.update({
        where: { id: loc.subscription.id },
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
  const accountIdMeta = session.metadata?.accountId || undefined
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

  // 1) Account: existing-by-id, else find-or-create-by-email.
  let account: { id: string; email: string; name: string | null } | null = null
  if (accountIdMeta) {
    account = await (prisma as any).account.findUnique({ where: { id: accountIdMeta } })
  }
  if (!account) {
    if (!email) throw new Error('no email on checkout.session and no accountId in metadata')
    account = await findOrCreateAccountByEmail(email)
  }

  // Persist the Stripe customer id on the account if not already set. We
  // best-effort skip if the column doesn't exist on the merged Account model.
  try {
    await (prisma as any).account.update({
      where: { id: account!.id },
      data: { stripeCustomerId: customerId },
    })
  } catch {
    /* column may not exist yet — non-fatal */
  }

  // 2) Location with auto slug.
  const baseName = account!.name ?? (email ? email.split('@')[0] : 'Store')
  const slug = await uniqueSlug(baseName)
  const location = await (prisma as any).location.create({
    data: {
      accountId: account!.id,
      name: `${baseName} — Main`,
      slug,
      tier,
    },
  })

  // 3) Subscription row.
  await (prisma as any).subscription.create({
    data: {
      locationId: location.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      stripePriceId,
      status: stripeSub.status,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    },
  })

  // 4) Welcome email.
  const dest = email ?? account!.email
  if (dest) {
    const playerUrl = `${PLAYER_URL}/${slug}`
    const dashboardUrl = APP_URL
    await sendWelcome(dest, tier, playerUrl, dashboardUrl).catch(() => undefined)
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.subscription) return
  const stripeSubId = String(invoice.subscription)

  const sub = await (prisma as any).subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubId },
    include: { location: { include: { /* account: true */ } } },
  })
  if (!sub) return

  const nextAttempt = (sub.dunningAttempt ?? 0) + 1
  await (prisma as any).subscription.update({
    where: { id: sub.id },
    data: {
      dunningAttempt: nextAttempt,
      status: nextAttempt >= 3 ? 'past_due' : sub.status,
    },
  })

  // Look up account email separately to avoid forcing the account include
  // shape (which depends on agent 2's schema) at this layer.
  const account = await (prisma as any).account.findUnique({
    where: { id: sub.location.accountId },
  })
  if (account?.email) {
    // Customer Portal URL for self-serve update of the payment method.
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
    // sendDunning expects DunningAttempt — we coerce; the email lib is
    // expected to gate on attempt range itself.
    await sendDunning(account.email, nextAttempt as any, portalUrl).catch(() => undefined)
  }
}
