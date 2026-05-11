// System-default outcome picker.
//
// Every Store needs a `defaultOutcomeId` — it's what plays when no schedule
// slot applies, and the Launch Checklist treats a missing default as a hard
// launch blocker. Daniel's rule (2026-05-11): the default should be set
// automatically at Store creation.
//
// Tier-aware preference (Daniel 2026-05-11):
//   - free tier: prefer "All Outcomes" → "Add Energy" → "Lift Energy"
//     → first allowlisted outcome alphabetically. Free-tier stores must
//     never get a default outside the FreeTierOutcome allowlist.
//   - other tiers: alphabetically-first non-superseded Outcome.
//
// If no outcomes match the preference chain, returns null and the caller
// leaves the field blank — same defensive posture as before.
//
// Used by:
//   - lib/account.ts ensureFreeClientForUser
//   - routes/me.ts inline free-Store backstop
//   - routes/admin.ts admin Store create
//   - routes/billing.ts paid Store create (x2)
//
// Backfill of existing rows handled by migrations:
//   - 20260511010000_default_outcome_for_existing_stores
//   - 20260511020000_default_outcome_free_tier_preference

import { prisma } from '../db.js'

const FREE_TIER_PREFERENCE = ['all outcomes', 'add energy', 'lift energy']

/**
 * Resolve the set of Outcome IDs currently allowed for free-tier stores by
 * joining FreeTierOutcome (keyed by outcomeKey) against the live Outcome table.
 * Used everywhere a free-tier store could otherwise pick an outcome outside
 * the allowlist — selection override, schedule slots, default fallback.
 *
 * Cheap to call (one indexed join). Don't cache across requests — operators
 * toggle this set live from the Free Tier Outcomes panel.
 */
export async function getFreeTierAllowedOutcomeIds(): Promise<Set<string>> {
  const allowedKeys = await prisma.freeTierOutcome.findMany({ select: { outcomeKey: true } })
  if (allowedKeys.length === 0) return new Set()
  const outcomes = await prisma.outcome.findMany({
    where: { outcomeKey: { in: allowedKeys.map((r) => r.outcomeKey) } },
    select: { id: true },
  })
  return new Set(outcomes.map((o) => o.id))
}

/** True iff the given outcome is in the FreeTierOutcome allowlist. */
export async function isFreeTierAllowedOutcome(outcomeId: string): Promise<boolean> {
  const outcome = await prisma.outcome.findUnique({
    where: { id: outcomeId },
    select: { outcomeKey: true },
  })
  if (!outcome) return false
  const row = await prisma.freeTierOutcome.findUnique({ where: { outcomeKey: outcome.outcomeKey } })
  return !!row
}

export async function pickSystemDefaultOutcomeId(tier?: string): Promise<string | null> {
  if (tier === 'free') {
    // Find the canonical outcomeKey for each preferred name and check whether
    // it's in the FreeTierOutcome allowlist. First hit wins.
    const candidates = await prisma.outcome.findMany({
      where: {
        supersededAt: null,
        OR: FREE_TIER_PREFERENCE.flatMap((name) => [
          { title: { equals: name, mode: 'insensitive' as const } },
          { displayTitle: { equals: name, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true, outcomeKey: true, title: true, displayTitle: true, version: true },
      orderBy: { version: 'desc' },
    })

    const allowed = new Set(
      (await prisma.freeTierOutcome.findMany({ select: { outcomeKey: true } }))
        .map((r) => r.outcomeKey),
    )

    for (const pref of FREE_TIER_PREFERENCE) {
      const hit = candidates.find((o) => {
        const t = (o.displayTitle ?? o.title).toLowerCase()
        return t === pref && (allowed.size === 0 || allowed.has(o.outcomeKey))
      })
      if (hit) return hit.id
    }

    // Final fallback: first allowed outcome alphabetically. If the allowlist
    // is empty, fall through to the global default below.
    if (allowed.size > 0) {
      const fallback = await prisma.outcome.findFirst({
        where: { supersededAt: null, outcomeKey: { in: Array.from(allowed) } },
        orderBy: [{ title: 'asc' }, { version: 'desc' }],
        select: { id: true },
      })
      if (fallback) return fallback.id
    }
  }

  // Default path: alphabetically-first non-superseded Outcome.
  const row = await prisma.outcome.findFirst({
    where: { supersededAt: null },
    orderBy: [{ title: 'asc' }, { version: 'desc' }],
    select: { id: true },
  })
  return row?.id ?? null
}
