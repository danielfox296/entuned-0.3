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
const BOOST_TRIAL_WARNING_DAYS = 5
const BOOST_TRIAL_GRACE_DAYS = 3

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
  const boostWarnCutoff = new Date(now.getTime() + BOOST_TRIAL_WARNING_DAYS * DAY_MS)

  // ── Pass 1: comps expiring within the warning window ──────────────────
  // Boost Trial stores use a tighter 5-day window and a different email template.
  // Standard admin comps use the 7-day window and the existing compEnding template.
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
      compReason: true,
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

  for (const s of ending) {
    stats.endingConsidered++
    const user = s.client.memberships[0]?.account
    if (!user) { stats.endingSkipped++; continue }

    const isBoostTrial = s.compReason === 'boost_trial_icp'

    // Boost Trial warning fires at 5 days; standard comp warning at 7 days.
    // Skip Boost Trial stores that are outside their tighter window.
    if (isBoostTrial && s.compExpiresAt!.getTime() - now.getTime() > boostWarnCutoff.getTime() - now.getTime()) {
      stats.endingSkipped++; continue
    }

    const templateName = isBoostTrial ? 'boostTrialEnding' : 'compEnding'
    // contextKey = storeId so the same Store doesn't get two warnings if
    // the operator extends the comp and we re-enter the window.
    const contextKey = s.id
    const already = await prisma.lifecycleEmailLog.findUnique({
      where: { accountId_templateName_contextKey: { accountId: user.id, templateName, contextKey } },
    })
    if (already) { stats.endingSkipped++; continue }

    const daysRemaining = Math.max(1, Math.ceil((s.compExpiresAt!.getTime() - now.getTime()) / DAY_MS))
    const endsOn = s.compExpiresAt!.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    const upgradeUrl = `${API_URL}/billing/upgrade-from-comp?store=${s.id}`

    try {
      const res = isBoostTrial
        ? await sendLifecycle('boostTrialEnding', { accountId: user.id, email: user.email }, {
            daysRemaining,
            upgradeUrl,
            dashboardUrl: APP_URL,
          })
        : await sendLifecycle('compEnding', { accountId: user.id, email: user.email }, {
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
        data: { accountId: user.id, templateName, contextKey },
      })
      stats.endingSent++
    } catch {
      stats.endingErrors++
    }
  }

  // ── Pass 2: comps that have expired (past grace period) ────────────────
  // Boost Trial gets a 3-day grace period before the comp is cleared.
  // Standard admin comps are cleared immediately on expiry (no grace).
  const graceCutoff = new Date(now.getTime() - BOOST_TRIAL_GRACE_DAYS * DAY_MS)

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
      compReason: true,
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

  for (const s of ended) {
    stats.endedConsidered++
    const user = s.client.memberships[0]?.account
    const formerCompTier = s.compTier!
    const fromTier = effectiveTier(s, now)
    const auditFromTier = formerCompTier
    const isBoostTrial = s.compReason === 'boost_trial_icp'

    // Boost Trial: apply 3-day grace — don't clear until compExpiresAt + 3d <= now.
    if (isBoostTrial && s.compExpiresAt! > graceCutoff) {
      stats.endedClearedOnly++ // counted but skipped
      continue
    }

    try {
      if (user) {
        const upgradeUrl = `${API_URL}/billing/upgrade-from-comp?store=${s.id}`
        if (isBoostTrial) {
          await sendLifecycle('boostTrialExpired', { accountId: user.id, email: user.email }, {
            upgradeUrl,
            dashboardUrl: APP_URL,
          }).catch(() => undefined)
        } else {
          await sendLifecycle('compEnded', { accountId: user.id, email: user.email }, {
            formerCompTier,
            paidTier: s.tier,
            upgradeUrl,
            dashboardUrl: APP_URL,
          }).catch(() => undefined)
        }
      }

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
            toTier: fromTier,
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
