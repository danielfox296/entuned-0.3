// Comp tier expiry cron — sends warning + ended emails and clears expired
// comps from the Store row. Runs alongside lifecycle drips and pause
// auto-resume on the daily 9am Mountain tick (see index.ts).
//
// Two passes:
//
//   1. compEnding   — Stores with active comp expiring within COMP_WARNING_DAYS.
//                     Idempotent via LifecycleEmailLog (contextKey = compId-as-storeId).
//
//   2. compEnded    — Stores with comp_expires_at <= now AND compTier still set.
//                     We send the email FIRST, then run applyTierChange to
//                     clear the comp + write a `comp_expired` audit row. If the
//                     email fails, we still clear the comp (the customer's
//                     dashboard would otherwise lie about effective tier).
//
// Open-ended comps (compExpiresAt = null) are intentionally untouched —
// they require an explicit admin revoke to end.

import { prisma } from '../db.js'
import { sendLifecycle } from './email.js'
import { applyTierChange, effectiveTier } from './tier.js'

const APP_URL = process.env.APP_URL ?? 'https://app.entuned.co'
const API_URL = process.env.API_URL ?? 'https://api.entuned.co'

const DAY_MS = 24 * 60 * 60 * 1000
const COMP_WARNING_DAYS = 7

interface CompCronStats {
  endingConsidered: number
  endingSent: number
  endingSkipped: number
  endingErrors: number
  endedConsidered: number
  endedSent: number
  endedClearedOnly: number
  endedErrors: number
}

export async function runCompExpiryCron(): Promise<CompCronStats> {
  const stats: CompCronStats = {
    endingConsidered: 0, endingSent: 0, endingSkipped: 0, endingErrors: 0,
    endedConsidered: 0, endedSent: 0, endedClearedOnly: 0, endedErrors: 0,
  }
  const now = new Date()
  const warnCutoff = new Date(now.getTime() + COMP_WARNING_DAYS * DAY_MS)

  // ── Pass 1: comps expiring within the warning window ──────────────────
  const ending = await prisma.store.findMany({
    where: {
      archivedAt: null,
      compTier: { not: null },
      compExpiresAt: { not: null, gt: now, lte: warnCutoff },
    },
    select: {
      id: true,
      tier: true,
      compTier: true,
      compExpiresAt: true,
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

  for (const s of ending) {
    stats.endingConsidered++
    const user = s.client.memberships[0]?.user
    if (!user) { stats.endingSkipped++; continue }

    // contextKey = storeId so the same Store doesn't get two warnings if
    // the operator extends the comp and we re-enter the window.
    const contextKey = s.id
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { userId_templateName_contextKey: {
        userId: user.id, templateName: 'compEnding', contextKey,
      } },
    })
    if (already) { stats.endingSkipped++; continue }

    const daysRemaining = Math.max(1, Math.ceil((s.compExpiresAt!.getTime() - now.getTime()) / DAY_MS))
    const endsOn = s.compExpiresAt!.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    const upgradeUrl = `${API_URL}/billing/upgrade-from-comp?store=${s.id}`

    try {
      const res = await sendLifecycle('compEnding', { userId: user.id, email: user.email }, {
        effectiveTier: s.compTier!,
        paidTier: s.tier,
        daysRemaining,
        endsOn,
        upgradeUrl,
        dashboardUrl: APP_URL,
      })
      if (res.skipped) { stats.endingSkipped++; continue }
      if (!res.ok) { stats.endingErrors++; continue }
      await prisma.lifecycleEmailLog.create({
        data: { userId: user.id, templateName: 'compEnding', contextKey },
      })
      stats.endingSent++
    } catch {
      stats.endingErrors++
    }
  }

  // ── Pass 2: comps that have already expired ─────────────────────────────
  const ended = await prisma.store.findMany({
    where: {
      archivedAt: null,
      compTier: { not: null },
      compExpiresAt: { not: null, lte: now },
    },
    select: {
      id: true,
      tier: true,
      compTier: true,
      compExpiresAt: true,
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

  for (const s of ended) {
    stats.endedConsidered++
    const user = s.client.memberships[0]?.user
    const formerCompTier = s.compTier!
    const fromTier = effectiveTier(s, now) // computes pre-clear effective; comp is expired so this == paid tier already
    // Actually: effectiveTier respects expiry, so fromTier here is paid tier.
    // We want the "from" in the audit row to reflect what the user *thought*
    // they had — i.e. the comp tier — so they can read the log as a real
    // entitlement transition. Override it explicitly.
    const auditFromTier = formerCompTier

    try {
      // Send the email first. Don't gate on idempotency here — every expiry
      // is a one-shot transition, and once the comp is cleared below the
      // store will never re-match this query.
      if (user) {
        const upgradeUrl = `${API_URL}/billing/upgrade-from-comp?store=${s.id}`
        await sendLifecycle('compEnded', { userId: user.id, email: user.email }, {
          formerCompTier,
          paidTier: s.tier,
          upgradeUrl,
          dashboardUrl: APP_URL,
        }).catch(() => undefined)
      }

      // Clear the comp + write `comp_expired` row. Done *outside* applyTierChange's
      // diff-skip (the effective tier comparison would treat this as a no-op
      // since the comp had already expired, so the standard helper would skip
      // the log row). Write the comp-cleared mutation manually plus an explicit
      // log row so the timeline shows the transition.
      await prisma.$transaction([
        prisma.store.update({
          where: { id: s.id },
          data: {
            compTier: null,
            compExpiresAt: null,
            compReason: null,
            compGrantedById: null,
            compGrantedAt: null,
          },
        }),
        prisma.tierChangeLog.create({
          data: {
            storeId: s.id,
            fromTier: auditFromTier,
            toTier: fromTier, // paid tier
            source: 'comp_expired',
            reason: `comp ${formerCompTier} expired on ${s.compExpiresAt!.toISOString()}`,
          },
        }),
      ])

      if (user) stats.endedSent++
      else stats.endedClearedOnly++
    } catch {
      stats.endedErrors++
    }
  }

  return stats
}
