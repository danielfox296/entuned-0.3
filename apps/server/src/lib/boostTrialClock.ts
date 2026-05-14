// Boost Trial clock activation sweep — runs on the daily 9am Mountain tick.
//
// When POST /me/boost-trial fires, we set compTier='core' + compExpiresAt=null
// + compReason='boost_trial_icp'. The trial clock (30 days) doesn't start until
// the first piece of music is actually generated for the onboarding ICP — that
// moment is recorded as the first LineageRow linked to that ICP.
//
// This sweep finds Stores in the "waiting to generate" state and flips them to
// "active" once generation has happened. It runs after runPauseAutoResume() and
// before runLifecycleEmails() so same-day activations reach the correct drip
// bucket on the same tick.

import { prisma } from '../db.js'
import { effectiveTier } from './tier.js'

const TRIAL_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

interface ClockActivationStats {
  considered: number
  activated: number
  skipped: number
  errors: number
}

export async function runBoostTrialClockActivation(): Promise<ClockActivationStats> {
  const stats: ClockActivationStats = {
    considered: 0,
    activated: 0,
    skipped: 0,
    errors: 0,
  }
  const now = new Date()

  // Stores waiting for their trial clock to start: comp granted, no expiry set yet.
  const pending = await prisma.store.findMany({
    where: {
      archivedAt: null,
      compTier: 'core',
      compReason: 'boost_trial_icp',
      compExpiresAt: null,
    },
    select: {
      id: true,
      tier: true,
      compTier: true,
      compExpiresAt: true,
      icpLinks: {
        select: {
          icp: {
            select: {
              id: true,
              source: true,
              lineageRows: {
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      },
    },
  })

  for (const s of pending) {
    stats.considered++

    // Find the onboarding ICP linked to this store that has at least one LineageRow.
    const onboardingIcp = s.icpLinks
      .map(l => l.icp)
      .find(icp => icp.source === 'onboarding' && icp.lineageRows.length > 0)

    if (!onboardingIcp) {
      stats.skipped++
      continue
    }

    // Generation has happened — start the 30-day clock.
    const expiresAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS)
    const fromTier = effectiveTier(s, now) // 'core' (comp active, no expiry)

    try {
      await prisma.$transaction([
        prisma.store.update({
          where: { id: s.id },
          data: { compExpiresAt: expiresAt },
        }),
        prisma.tierChangeLog.create({
          data: {
            storeId: s.id,
            fromTier,
            toTier: 'core',
            source: 'boost_trial_activated',
            expiresAt,
            reason: `Boost Trial clock started — first generation detected for ICP ${onboardingIcp.id}`,
          },
        }),
      ])
      stats.activated++
    } catch {
      stats.errors++
    }
  }

  return stats
}
