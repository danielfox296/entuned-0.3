// Lifecycle email dispatcher.
//
// Drives behavioral / lifecycle drips on a daily cron. Triggers:
//
//   Time-based:
//     1. icpUnfilled              — paid Store created ≥48h ago, no ICP saved
//     2. pauseEnding              — Subscription paused, day 53 of the 60-day window
//     3. freeToCoreNudge          — free signup ≥72h ago, no paid Store
//
//   Behavior-based:
//     4. engagedFreeToCore        — Free Client with ≥100 song_starts in last 14d
//     5. scalingCoreToPro         — Client with ≥2 paid Stores, no Pro yet
//     6. establishedCoreToPro     — Core ≥30 days, ICP saved, no Pro yet
//
//   Boost Trial:
//     7. boostTrialStreamReady    — Day 0-3 of trial (compExpiresAt in [now+27d, now+30d])
//     8. boostTrialEngagement     — Day 12-16 of trial (compExpiresAt in [now+14d, now+18d])
//     9. postConversionBenchmark  — 7-10 days after trial→core conversion via stripe_webhook
//
// Each send is idempotent via `LifecycleEmailLog` (unique on userId, template,
// contextKey). Lifecycle templates are gated on User.lifecycleEmailsOptOut by
// `sendLifecycle` in lib/email.ts. Pause-ending is treated as transactional
// (operationally relevant — billing is about to resume) so it ignores opt-out
// and is sent via `sendPauseEnding`.

import { prisma } from '../db.js'
import { sendLifecycle, sendPauseEnding } from './email.js'
import { effectiveTier } from './tier.js'
import { FREE_TIER_CLIENT_ID } from './freeTier.js'

const APP_URL = process.env.APP_URL ?? 'https://app.entuned.co'
const PLAYER_URL = process.env.PLAYER_URL ?? 'https://music.entuned.co'
const API_URL = process.env.API_URL ?? 'https://api.entuned.co'

const HOUR_MS = 60 * 60 * 1000

interface DripStats {
  considered: number
  sent: number
  skipped: number
  errors: number
}

export type LifecycleDripName =
  | 'icpUnfilled'
  | 'pauseEnding'
  | 'freeToCoreNudge'
  | 'engagedFreeToCore'
  | 'scalingCoreToPro'
  | 'establishedCoreToPro'
  | 'boostTrialStreamReady'
  | 'boostTrialEngagement'
  | 'postConversionBenchmark'

/** Run every drip the cron knows about. */
export async function runLifecycleEmails(): Promise<Record<LifecycleDripName, DripStats>> {
  const [
    icpUnfilled, pauseEnding, freeToCoreNudge,
    engagedFreeToCore, scalingCoreToPro, establishedCoreToPro,
    boostTrialStreamReady, boostTrialEngagement, postConversionBenchmark,
  ] = await Promise.all([
    runIcpUnfilled(),
    runPauseEnding(),
    runFreeToCoreNudge(),
    runEngagedFreeToCore(),
    runScalingCoreToPro(),
    runEstablishedCoreToPro(),
    runBoostTrialStreamReady(),
    runBoostTrialEngagement(),
    runPostConversionBenchmark(),
  ])
  return {
    icpUnfilled, pauseEnding, freeToCoreNudge,
    engagedFreeToCore, scalingCoreToPro, establishedCoreToPro,
    boostTrialStreamReady, boostTrialEngagement, postConversionBenchmark,
  }
}

/** Fire one drip on demand. Used by the admin "fire now" button. Same
 *  idempotency rails as the cron — already-sent recipients are skipped. */
export async function runOneLifecycleDrip(name: LifecycleDripName): Promise<DripStats> {
  switch (name) {
    case 'icpUnfilled': return runIcpUnfilled()
    case 'pauseEnding': return runPauseEnding()
    case 'freeToCoreNudge': return runFreeToCoreNudge()
    case 'engagedFreeToCore': return runEngagedFreeToCore()
    case 'scalingCoreToPro': return runScalingCoreToPro()
    case 'establishedCoreToPro': return runEstablishedCoreToPro()
    case 'boostTrialStreamReady': return runBoostTrialStreamReady()
    case 'boostTrialEngagement': return runBoostTrialEngagement()
    case 'postConversionBenchmark': return runPostConversionBenchmark()
  }
}

// ── ICP-unfilled ────────────────────────────────────────────────────────
//
// Find paid Stores created ≥48h ago with no ICP. For each, send to the
// Client's first owner/manager (one drip per Client, not per Store).

async function runIcpUnfilled(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const cutoff = new Date(Date.now() - 48 * HOUR_MS)

  const stores = await prisma.store.findMany({
    where: {
      archivedAt: null,
      createdAt: { lte: cutoff },
      tier: { in: ['core', 'pro'] },
      subscription: { isNot: null },
      // No customer-curated ICPs (the Free Tier ICP is shared and operator-owned;
      // exclude it explicitly so paid Stores that haven't run intake still trip
      // the drip even though they're auto-linked to Free Tier).
      icpLinks: { none: { icp: { clientId: { not: FREE_TIER_CLIENT_ID } } } },
    },
    select: {
      id: true,
      clientId: true,
      client: {
        select: {
          memberships: {
            where: { role: { in: ['owner', 'manager'] } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { account: { select: { id: true, email: true } } },
          },
        },
      },
    },
  })

  // Dedupe per Client — ICP is conceptually per-Store, but for v1 we send
  // one nudge per Client to avoid spamming a multi-Store owner.
  const seenClient = new Set<string>()

  for (const s of stores) {
    if (seenClient.has(s.clientId)) continue
    seenClient.add(s.clientId)
    const user = s.client.memberships[0]?.account
    if (!user) continue
    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'icpUnfilled', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('icpUnfilled', { accountId: user.id, email: user.email }, {
        intakeUrl: `${APP_URL}/intake`,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'icpUnfilled' },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Pause-ending ────────────────────────────────────────────────────────
//
// Find Subscriptions whose Store has pausedUntil 6-7 days away. Send the
// pause-ending notice once per pause window — `contextKey` is the
// pausedUntil ISO date so re-pauses get their own notice.

async function runPauseEnding(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const now = Date.now()
  const windowStart = new Date(now + 6 * 24 * HOUR_MS)
  const windowEnd = new Date(now + 7 * 24 * HOUR_MS)

  const stores = await prisma.store.findMany({
    where: {
      archivedAt: null,
      pausedUntil: { gte: windowStart, lt: windowEnd },
      subscription: { isNot: null },
    },
    select: {
      id: true,
      pausedUntil: true,
      clientId: true,
      client: {
        select: {
          memberships: {
            where: { role: { in: ['owner', 'manager'] } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { account: { select: { id: true, email: true } } },
          },
        },
      },
    },
  })

  for (const s of stores) {
    const user = s.client.memberships[0]?.account
    if (!user || !s.pausedUntil) continue
    stats.considered++
    const contextKey = s.pausedUntil.toISOString().slice(0, 10) // YYYY-MM-DD
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'pauseEnding', contextKey,
      } },
    })
    if (already) { stats.skipped++; continue }
    const daysRemaining = Math.max(0, Math.ceil((s.pausedUntil.getTime() - now) / (24 * HOUR_MS)))
    try {
      const res = await sendPauseEnding(user.email, daysRemaining, APP_URL)
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'pauseEnding', contextKey },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Free → Core nudge ────────────────────────────────────────────────────
//
// Find Users whose Client has no paid Store and was created ≥72h ago. Sent
// once per User. Skips opted-out users.

async function runFreeToCoreNudge(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const cutoff = new Date(Date.now() - 72 * HOUR_MS)

  // Eligible Clients: at least one Store, none with a Subscription, none with an active comp
  // (comped stores are on a Boost Trial — nudging them to pay would be confusing).
  const now72 = new Date()
  const clients = await prisma.client.findMany({
    where: {
      createdAt: { lte: cutoff },
      AND: [
        { stores: { some: { archivedAt: null } } },
        { stores: { none: { subscription: { isNot: null }, archivedAt: null } } },
        { stores: { none: {
          compTier: { not: null },
          OR: [{ compExpiresAt: null }, { compExpiresAt: { gt: now72 } }],
        } } },
      ],
    },
    select: {
      id: true,
      stores: {
        where: { archivedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { slug: true },
      },
      memberships: {
        where: { role: { in: ['owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { account: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.account
    const slug = c.stores[0]?.slug
    if (!user || !slug) continue
    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'freeToCoreNudge', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('freeToCoreNudge', { accountId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=core`,
        playerUrl: `${PLAYER_URL}/${slug}`,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'freeToCoreNudge' },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Engaged Free → Core ─────────────────────────────────────────────────
//
// Free Client whose Store has racked up real playback (≥100 song_start events
// in the last 14 days). Time-only `freeToCoreNudge` already fires at 72h on
// signup; this one fires later when usage actually shows up. Different
// template, distinct contextKey, so a Client can receive both.

const ENGAGED_THRESHOLD_SONGS = 100
const ENGAGED_WINDOW_DAYS = 14

async function runEngagedFreeToCore(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const since = new Date(Date.now() - ENGAGED_WINDOW_DAYS * 24 * HOUR_MS)

  // Eligible Clients: at least one active Store, none with a Subscription, none with an active comp.
  const nowEngaged = new Date()
  const clients = await prisma.client.findMany({
    where: {
      AND: [
        { stores: { some: { archivedAt: null } } },
        { stores: { none: { subscription: { isNot: null }, archivedAt: null } } },
        { stores: { none: {
          compTier: { not: null },
          OR: [{ compExpiresAt: null }, { compExpiresAt: { gt: nowEngaged } }],
        } } },
      ],
    },
    select: {
      id: true,
      stores: {
        where: { archivedAt: null },
        select: { id: true },
      },
      memberships: {
        where: { role: { in: ['owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { account: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.account
    if (!user || c.stores.length === 0) continue

    const storeIds = c.stores.map((s) => s.id)
    const songStarts = await prisma.playbackEvent.count({
      where: {
        storeId: { in: storeIds },
        eventType: 'song_start',
        occurredAt: { gte: since },
      },
    })
    if (songStarts < ENGAGED_THRESHOLD_SONGS) continue

    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'engagedFreeToCore', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('engagedFreeToCore', { accountId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=core`,
        songsPlayed: songStarts,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'engagedFreeToCore' },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Scaling Core → Pro ──────────────────────────────────────────────────
//
// Client with ≥2 paid Stores, none on Pro yet. Multi-location operators are
// the natural Pro audience — Outcome Scheduling + POS integrations matter once you
// can't eyeball every floor.

async function runScalingCoreToPro(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }

  // Pull every Client with at least 2 active paid Stores. We then check for
  // "no Pro yet" in JS — keeps the SQL straightforward across mixed-tier rows.
  const clients = await prisma.client.findMany({
    where: {
      stores: {
        some: { archivedAt: null, subscription: { isNot: null } },
      },
    },
    select: {
      id: true,
      stores: {
        where: { archivedAt: null },
        select: { id: true, tier: true, compTier: true, compExpiresAt: true, subscription: { select: { id: true } } },
      },
      memberships: {
        where: { role: { in: ['owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { account: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.account
    if (!user) continue
    const paid = c.stores.filter((s) => s.subscription !== null)
    if (paid.length < 2) continue
    // Skip if any paid Store is *effectively* Pro/Enterprise — covers both
    // real Pro subs and Core stores that have been comped to Pro.
    if (paid.some((s) => {
      const eff = effectiveTier(s)
      return eff === 'pro' || eff === 'enterprise'
    })) continue

    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'scalingCoreToPro', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('scalingCoreToPro', { accountId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=pro`,
        storeCount: paid.length,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'scalingCoreToPro' },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Established Core → Pro ──────────────────────────────────────────────
//
// Client whose oldest Core Subscription is ≥30 days old AND whose primary
// Store has a saved ICP. They've engaged + stuck around — Pro's data story
// (Lift Reports, integrations) is the natural next pitch.

const ESTABLISHED_TENURE_DAYS = 30

async function runEstablishedCoreToPro(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const tenureCutoff = new Date(Date.now() - ESTABLISHED_TENURE_DAYS * 24 * HOUR_MS)

  // Eligible Clients: at least one Subscription created ≥30 days ago whose
  // Store is at tier=core; at least one ICP saved on any Store; no Pro Stores.
  const clients = await prisma.client.findMany({
    where: {
      stores: {
        some: {
          archivedAt: null,
          tier: 'core',
          subscription: { is: { createdAt: { lte: tenureCutoff } } },
        },
      },
      icps: { some: {} },
    },
    select: {
      id: true,
      stores: {
        where: { archivedAt: null },
        select: { tier: true, compTier: true, compExpiresAt: true },
      },
      memberships: {
        where: { role: { in: ['owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { account: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.account
    if (!user) continue
    // Skip if any Store is *effectively* Pro/Enterprise (paid or comped).
    if (c.stores.some((s) => {
      const eff = effectiveTier(s)
      return eff === 'pro' || eff === 'enterprise'
    })) continue

    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'establishedCoreToPro', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('establishedCoreToPro', { accountId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=pro`,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'establishedCoreToPro' },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Boost Trial stream ready ─────────────────────────────────────────────
//
// Fires Day 0-3 after the Boost Trial clock activates. The clock starts when
// the first LineageRow is generated (see boostTrialClock.ts), recorded as
// `compExpiresAt = now + 30 days`. We detect "just activated" by checking
// whether compExpiresAt is 27-30 days away (clock start ≤ now ≤ clock start+3d).
// contextKey = storeId; one email per trial activation.

const DAY_MS = 24 * HOUR_MS
const TRIAL_DAYS = 30

async function runBoostTrialStreamReady(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const now = new Date()
  // compExpiresAt in [now+27d, now+30d] ↔ clock started in last 3 days
  const windowLow = new Date(now.getTime() + (TRIAL_DAYS - 3) * DAY_MS)
  const windowHigh = new Date(now.getTime() + TRIAL_DAYS * DAY_MS)

  const stores = await prisma.store.findMany({
    where: {
      archivedAt: null,
      compTier: 'core',
      compReason: 'boost_trial_icp',
      compExpiresAt: { gte: windowLow, lte: windowHigh },
    },
    select: {
      id: true,
      compExpiresAt: true,
      slug: true,
      client: {
        select: {
          memberships: {
            where: { role: { in: ['owner', 'manager'] } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { account: { select: { id: true, email: true } } },
          },
        },
      },
    },
  })

  for (const s of stores) {
    const user = s.client.memberships[0]?.account
    if (!user) continue
    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'boostTrialStreamReady', contextKey: s.id,
      } },
    })
    if (already) { stats.skipped++; continue }
    const daysRemaining = Math.max(1, Math.ceil((s.compExpiresAt!.getTime() - now.getTime()) / DAY_MS))
    try {
      const res = await sendLifecycle('boostTrialStreamReady', { accountId: user.id, email: user.email }, {
        playerUrl: `${PLAYER_URL}/${s.slug}`,
        dashboardUrl: APP_URL,
        daysRemaining,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'boostTrialStreamReady', contextKey: s.id },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Boost Trial mid-trial engagement ────────────────────────────────────
//
// Fires Day 12-16 of the active trial (compExpiresAt in [now+14d, now+18d]).
// Acknowledges two weeks of usage and surfaces the upgrade CTA.
// contextKey = storeId; one email per trial.

async function runBoostTrialEngagement(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const now = new Date()
  // Day 12-16 → compExpiresAt in [now+14d, now+18d] (30-16=14, 30-12=18)
  const windowLow = new Date(now.getTime() + 14 * DAY_MS)
  const windowHigh = new Date(now.getTime() + 18 * DAY_MS)

  const stores = await prisma.store.findMany({
    where: {
      archivedAt: null,
      compTier: 'core',
      compReason: 'boost_trial_icp',
      compExpiresAt: { gte: windowLow, lte: windowHigh },
    },
    select: {
      id: true,
      compExpiresAt: true,
      client: {
        select: {
          memberships: {
            where: { role: { in: ['owner', 'manager'] } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { account: { select: { id: true, email: true } } },
          },
        },
      },
    },
  })

  for (const s of stores) {
    const user = s.client.memberships[0]?.account
    if (!user) continue
    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'boostTrialEngagement', contextKey: s.id,
      } },
    })
    if (already) { stats.skipped++; continue }
    const daysRemaining = Math.max(1, Math.ceil((s.compExpiresAt!.getTime() - now.getTime()) / DAY_MS))
    try {
      const res = await sendLifecycle('boostTrialEngagement', { accountId: user.id, email: user.email }, {
        daysRemaining,
        upgradeUrl: `${API_URL}/billing/upgrade-from-comp?store=${s.id}`,
        dashboardUrl: APP_URL,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'boostTrialEngagement', contextKey: s.id },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}

// ── Post-conversion benchmarking ─────────────────────────────────────────
//
// Fires 7-10 days after a Boost Trial customer converts to a paid Core
// subscription. "Conversion" = a `stripe_webhook` TierChangeLog with
// toTier='core' on a Store that previously had a `boost_trial_activated` log.
// contextKey = the stripe_webhook log ID, making it idempotent per conversion.

async function runPostConversionBenchmark(): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }
  const now = Date.now()
  const windowStart = new Date(now - 10 * DAY_MS)
  const windowEnd = new Date(now - 7 * DAY_MS)

  const recentConversions = await prisma.tierChangeLog.findMany({
    where: {
      source: 'stripe_webhook',
      toTier: 'core',
      createdAt: { gte: windowStart, lte: windowEnd },
    },
    select: {
      id: true,
      store: {
        select: {
          id: true,
          archivedAt: true,
          tier: true,
          subscription: { select: { id: true } },
          // Check if this store ever had a Boost Trial activated
          tierChangeLogs: {
            where: { source: 'boost_trial_activated' },
            take: 1,
            select: { id: true },
          },
          client: {
            select: {
              memberships: {
                where: { role: { in: ['owner', 'manager'] } },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { account: { select: { id: true, email: true } } },
              },
            },
          },
        },
      },
    },
  })

  for (const log of recentConversions) {
    const s = log.store
    if (s.archivedAt || s.tier !== 'core' || !s.subscription) continue
    if (s.tierChangeLogs.length === 0) continue // not a trial conversion
    const user = s.client.memberships[0]?.account
    if (!user) continue

    stats.considered++
    const contextKey = log.id
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: {
        accountId: user.id, templateName: 'postConversionBenchmark', contextKey,
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('postConversionBenchmark', { accountId: user.id, email: user.email }, {
        benchmarkUrl: `${APP_URL}/benchmark`,
        dashboardUrl: APP_URL,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { accountId: user.id, templateName: 'postConversionBenchmark', contextKey },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}
