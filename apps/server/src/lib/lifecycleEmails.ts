// Lifecycle email dispatcher.
//
// Drives behavioral / lifecycle drips on a daily cron. Triggers:
//
//   Time-based:
//     1. icpUnfilled         — paid Store created ≥48h ago, no ICP saved
//     2. pauseEnding         — Subscription paused, day 53 of the 60-day window
//     3. freeToCoreNudge     — free signup ≥72h ago, no paid Store
//
//   Behavior-based:
//     4. engagedFreeToCore     — Free Client with ≥100 song_starts in last 14d
//     5. scalingCoreToPro      — Client with ≥2 paid Stores, no Pro yet
//     6. establishedCoreToPro  — Core ≥30 days, ICP saved, no Pro yet
//
// Each send is idempotent via `LifecycleEmailLog` (unique on userId, template,
// contextKey). Lifecycle templates are gated on User.lifecycleEmailsOptOut by
// `sendLifecycle` in lib/email.ts. Pause-ending is treated as transactional
// (operationally relevant — billing is about to resume) so it ignores opt-out
// and is sent via `sendPauseEnding`.

import { prisma } from '../db.js'
import { sendLifecycle, sendPauseEnding } from './email.js'

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

/** Run every drip the cron knows about. */
export async function runLifecycleEmails(): Promise<Record<LifecycleDripName, DripStats>> {
  const [
    icpUnfilled, pauseEnding, freeToCoreNudge,
    engagedFreeToCore, scalingCoreToPro, establishedCoreToPro,
  ] = await Promise.all([
    runIcpUnfilled(),
    runPauseEnding(),
    runFreeToCoreNudge(),
    runEngagedFreeToCore(),
    runScalingCoreToPro(),
    runEstablishedCoreToPro(),
  ])
  return {
    icpUnfilled, pauseEnding, freeToCoreNudge,
    engagedFreeToCore, scalingCoreToPro, establishedCoreToPro,
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
      icps: { none: {} },
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
            select: { user: { select: { id: true, email: true } } },
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
    const user = s.client.memberships[0]?.user
    if (!user) continue
    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'icpUnfilled', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('icpUnfilled', { userId: user.id, email: user.email }, {
        intakeUrl: `${APP_URL}/intake`,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'icpUnfilled' },
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
            select: { user: { select: { id: true, email: true } } },
          },
        },
      },
    },
  })

  for (const s of stores) {
    const user = s.client.memberships[0]?.user
    if (!user || !s.pausedUntil) continue
    stats.considered++
    const contextKey = s.pausedUntil.toISOString().slice(0, 10) // YYYY-MM-DD
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'pauseEnding', contextKey,
      } },
    })
    if (already) { stats.skipped++; continue }
    const daysRemaining = Math.max(0, Math.ceil((s.pausedUntil.getTime() - now) / (24 * HOUR_MS)))
    try {
      const res = await sendPauseEnding(user.email, daysRemaining, APP_URL)
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'pauseEnding', contextKey },
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

  // Eligible Clients: at least one Store, none with a Subscription.
  const clients = await prisma.client.findMany({
    where: {
      createdAt: { lte: cutoff },
      stores: {
        some: { archivedAt: null },
        none: { subscription: { isNot: null }, archivedAt: null },
      },
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
        select: { user: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.user
    const slug = c.stores[0]?.slug
    if (!user || !slug) continue
    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'freeToCoreNudge', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('freeToCoreNudge', { userId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=core`,
        playerUrl: `${PLAYER_URL}/${slug}`,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'freeToCoreNudge' },
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

  // Eligible Clients: at least one active Store, none with a Subscription.
  const clients = await prisma.client.findMany({
    where: {
      stores: {
        some: { archivedAt: null },
        none: { subscription: { isNot: null }, archivedAt: null },
      },
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
        select: { user: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.user
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
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'engagedFreeToCore', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('engagedFreeToCore', { userId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=core`,
        songsPlayed: songStarts,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'engagedFreeToCore' },
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
// the natural Pro audience — day-parting + POS integrations matter once you
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
        select: { id: true, tier: true, subscription: { select: { id: true } } },
      },
      memberships: {
        where: { role: { in: ['owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { user: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.user
    if (!user) continue
    const paid = c.stores.filter((s) => s.subscription !== null)
    if (paid.length < 2) continue
    if (paid.some((s) => s.tier === 'pro' || s.tier === 'enterprise')) continue

    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'scalingCoreToPro', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('scalingCoreToPro', { userId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=pro`,
        storeCount: paid.length,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'scalingCoreToPro' },
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
        select: { tier: true },
      },
      memberships: {
        where: { role: { in: ['owner', 'manager'] } },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { user: { select: { id: true, email: true } } },
      },
    },
  })

  for (const c of clients) {
    const user = c.memberships[0]?.user
    if (!user) continue
    if (c.stores.some((s) => s.tier === 'pro' || s.tier === 'enterprise')) continue

    stats.considered++
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'establishedCoreToPro', contextKey: '',
      } },
    })
    if (already) { stats.skipped++; continue }
    try {
      const res = await sendLifecycle('establishedCoreToPro', { userId: user.id, email: user.email }, {
        upgradeUrl: `${API_URL}/billing/checkout?tier=pro`,
      })
      if (res.skipped) { stats.skipped++; continue }
      if (!res.ok) { stats.errors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'establishedCoreToPro' },
      })
      stats.sent++
    } catch {
      stats.errors++
    }
  }
  return stats
}
