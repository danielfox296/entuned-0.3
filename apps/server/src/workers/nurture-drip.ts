// Nurture Drip — Free-tier educational sequence.
//
// Walks every free-tier Store by age-since-signup and sends the appropriate
// drip email if the recipient hasn't received it yet. Reuses the existing
// `LifecycleEmailLog` table for idempotency and `sendLifecycle` for the
// opt-out gate (User.lifecycleEmailsOptOut → skipped silently).
//
// Day 0 is covered by the existing transactional `welcomeFree` template
// (sent on signup). This worker handles days 2/4/7/10/12/14.
//
// Spec: ../../../morning-command-center-spec.md §SYSTEM 2
// Schedule: daily at 9am MT (cron — local-cron is fine for now; consider
// Railway when reliability becomes load-bearing because this one IS
// customer-facing).

import { prisma } from '../db.js'
import { sendLifecycle } from '../lib/email.js'
import { NURTURE_DRIP } from '../lib/command-center-config.js'
import { FREE_TIER_CLIENT_ID } from '../lib/freeTier.js'
import type { TemplateName } from '../email-templates/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

const APP_URL = process.env.APP_URL ?? 'https://app.entuned.co'
const PLAYER_URL = process.env.PLAYER_URL ?? 'https://music.entuned.co'
const PRICING_URL = process.env.PRICING_URL ?? 'https://entuned.co/pricing.html'

interface DripStats {
  considered: number
  sent: number
  skipped: number
  errors: number
}

function propsFor(template: TemplateName, playerSlug: string | null): Record<string, unknown> {
  const playerUrl = playerSlug ? `${PLAYER_URL}/${playerSlug}` : PLAYER_URL
  switch (template) {
    case 'free_drip_invisible_channel':
    case 'free_drip_proof':
    case 'free_drip_whats_missing':
      return { upgradeUrl: PRICING_URL, playerUrl }
    case 'free_drip_case_study':
    case 'free_drip_last_nudge':
      return { upgradeUrl: PRICING_URL }
    case 'free_drip_trial_offer':
      return { trialUrl: PRICING_URL }
    default:
      return { upgradeUrl: PRICING_URL, playerUrl }
  }
}

/**
 * For each free-tier Store whose signup-age has crossed a drip day,
 * dispatch the matching template. Idempotent via LifecycleEmailLog.
 *
 * Run once per day. If the worker misses a day (machine off), the next run
 * catches up: a Store on day 5 with no day-2 send yet gets the day-2 email
 * the next morning.
 */
export async function runNurtureDrip(now: Date = new Date()): Promise<DripStats> {
  const stats: DripStats = { considered: 0, sent: 0, skipped: 0, errors: 0 }

  // Active free-tier Stores attached to a real (non-system-sentinel) Client.
  // Free tier Stores under FREE_TIER_CLIENT_ID are the operator-shared seed
  // pool, not real customers — exclude.
  const stores = await prisma.store.findMany({
    where: {
      archivedAt: null,
      tier: 'free',
      clientId: { not: FREE_TIER_CLIENT_ID },
    },
    select: {
      id: true,
      slug: true,
      createdAt: true,
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

  // One drip per Client to avoid spamming multi-Store owners.
  const seenForTemplate = new Map<string, Set<string>>()

  for (const s of stores) {
    const account = s.client.memberships[0]?.account
    if (!account) continue
    const ageDays = (now.getTime() - s.createdAt.getTime()) / DAY_MS

    // Walk the sequence in order, find the highest day they qualify for that
    // hasn't been sent yet. Send only ONE drip per Store per run — don't
    // backflood a Client who's been on free for 14 days with all 6 emails
    // at once.
    let dispatched = false
    for (const step of NURTURE_DRIP) {
      if (step.day === 0) continue // day 0 is welcomeFree, sent on signup
      if (ageDays < step.day) continue
      const tmpl = step.template as TemplateName
      stats.considered++

      const seen = seenForTemplate.get(tmpl) ?? new Set<string>()
      if (seen.has(s.clientId)) { stats.skipped++; continue }

      const already = await prisma.lifecycleEmailLog.findUnique({
        where: {
          accountId_templateName_contextKey: {
            accountId: account.id,
            templateName: tmpl,
            contextKey: '',
          },
        },
      })
      if (already) { stats.skipped++; continue }

      try {
        const res = await sendLifecycle(
          tmpl,
          { accountId: account.id, email: account.email },
          propsFor(tmpl, s.slug),
        )
        if (res.skipped) {
          // Opt-out — log it so we don't keep considering this template for
          // this account every day. Same pattern as the existing dispatcher.
          await prisma.lifecycleEmailLog.create({
            data: { accountId: account.id, templateName: tmpl },
          })
          stats.skipped++
          continue
        }
        if (!res.ok) { stats.errors++; continue }
        await prisma.lifecycleEmailLog.create({
          data: { accountId: account.id, templateName: tmpl },
        })
        seen.add(s.clientId)
        seenForTemplate.set(tmpl, seen)
        stats.sent++
        dispatched = true
      } catch {
        stats.errors++
      }
      if (dispatched) break // one drip per Store per run
    }
  }

  return stats
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runNurtureDrip()
    .then((s) => console.log('[nurture-drip] done', s))
    .catch((err) => {
      console.error('[nurture-drip] failed', err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
