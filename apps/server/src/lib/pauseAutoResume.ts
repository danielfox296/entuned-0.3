// Pause auto-resume cron.
//
// Counterpart to the day-53 `pauseEnding` warning. The warning email tells
// the customer "your pause ends in N days" so they can extend or cancel; if
// they don't, this cron flips Stripe back on at day 60 (technically: any time
// `Store.pausedUntil <= now`). Runs alongside the lifecycle drips on the
// daily 9am Mountain tick.
//
// The actual resume logic mirrors `POST /billing/resume`: clear Stripe's
// `pause_collection`, restore the Store tier from the price id, set
// pausedUntil = null on the Store, set Subscription.status = 'active'. We
// duplicate that here rather than depending on the billing route handler so
// the cron has no Fastify context.

import Stripe from 'stripe'
import { prisma } from '../db.js'
import { effectiveTier, applyTierChange } from './tier.js'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO ?? ''

// Lazy: only construct the client when there's actually work to do, so the
// cron is a no-op in dev (no STRIPE_SECRET_KEY → empty result, no errors).
function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null
  return new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as Stripe.LatestApiVersion })
}

interface AutoResumeStats {
  considered: number
  resumed: number
  skipped: number
  errors: number
}

/** Find every Store whose pause window is in the past and resume it. */
export async function runPauseAutoResume(): Promise<AutoResumeStats> {
  const stats: AutoResumeStats = { considered: 0, resumed: 0, skipped: 0, errors: 0 }
  const now = new Date()

  const stores = await prisma.store.findMany({
    where: {
      archivedAt: null,
      pausedUntil: { not: null, lte: now },
      subscription: { isNot: null },
    },
    include: { subscription: true },
  })

  if (stores.length === 0) return stats

  const stripe = getStripe()
  if (!stripe) {
    // Dev / unconfigured — flip the local rows so the dashboard reflects
    // the resume even without Stripe access. Real prod always has the key.
    for (const s of stores) {
      stats.considered++
      if (!s.subscription) { stats.skipped++; continue }
      const restoredTier: 'core' | 'pro' =
        s.subscription.stripePriceId === STRIPE_PRICE_ID_PRO ? 'pro' : 'core'
      try {
        await applyTierChange({
          storeId: s.id,
          fromTier: effectiveTier(s),
          data: { pausedUntil: null, tier: restoredTier },
          source: 'resume',
          actorId: null,
          reason: 'auto-resume cron (pause window expired)',
        })
        await prisma.subscription.update({
          where: { id: s.subscription.id },
          data: { status: 'active' },
        })
        stats.resumed++
      } catch {
        stats.errors++
      }
    }
    return stats
  }

  for (const s of stores) {
    stats.considered++
    if (!s.subscription) { stats.skipped++; continue }
    const restoredTier: 'core' | 'pro' =
      s.subscription.stripePriceId === STRIPE_PRICE_ID_PRO ? 'pro' : 'core'

    try {
      await stripe.subscriptions.update(s.subscription.stripeSubscriptionId, {
        // Clearing pause_collection requires sending an empty string — the
        // Stripe TS types don't model that case, so we cast through unknown.
        pause_collection: '' as unknown as Stripe.SubscriptionUpdateParams['pause_collection'],
      })
      await applyTierChange({
        storeId: s.id,
        fromTier: effectiveTier(s),
        data: { pausedUntil: null, tier: restoredTier },
        source: 'resume',
        actorId: null,
        reason: 'auto-resume cron (pause window expired)',
      })
      await prisma.subscription.update({
        where: { id: s.subscription.id },
        data: { status: 'active' },
      })
      stats.resumed++
    } catch {
      stats.errors++
    }
  }
  return stats
}
