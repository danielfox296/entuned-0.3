// System-default outcome picker.
//
// Every Store needs a `defaultOutcomeId` — it's what plays when no schedule
// slot applies, and the Launch Checklist treats a missing default as a hard
// launch blocker. Daniel's rule (2026-05-11): the default should be set
// automatically at Store creation.
//
// Tier-aware preference (Daniel 2026-05-11):
//   - free tier: walk FREE_TIER_PREFERENCE in order, then fall back to the
//     first allowlisted outcome alphabetically. Free-tier stores must never
//     get a default outside the FreeTierOutcome allowlist.
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
//   - 20260806140000_free_tier_dwell_only

import { prisma } from '../db.js'

// Preference chain for a free-tier Store's default outcome, matched against
// `displayTitle ?? title` (case-insensitive). Dwell Launch Spec v1
// (2026-08-06): the free tier is a single outcome, so the chain is one entry.
// Matched by NAME, not key — `Outcome.outcomeKey` is a UUID.
const FREE_TIER_PREFERENCE = ['dwell']

// Outcomes retired from the CUSTOMER-facing pickers (player modal, dashboard
// schedule picker) by the Dwell launch. The rows stay live: their songs keep
// playing, they remain assignable from Dash, and nothing is superseded. This
// list only controls what a customer is offered.
//
// Operator surfaces (`/admin/*`) deliberately do NOT filter — an operator has
// to be able to see and manage the whole catalogue.
const PICKER_HIDDEN_TITLES = new Set(['chill', 'steady', 'upbeat'])

/**
 * True iff this outcome should be hidden from customer-facing outcome pickers.
 * Takes the raw row fields so callers can filter a findMany result without a
 * second round-trip.
 */
export function isPickerHiddenOutcome(o: { title: string; displayTitle?: string | null }): boolean {
  return PICKER_HIDDEN_TITLES.has((o.displayTitle ?? o.title).trim().toLowerCase())
}

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

    // Hard invariant: free-tier Stores never get an outcome outside the
    // FreeTierOutcome allowlist. If the allowlist is empty (admin deleted
    // all rows, fresh DB without seed, etc.), return null rather than
    // falling through to the global default — which would silently leak
    // paid-only outcomes into free Stores. Caller (account.ts) handles
    // null by leaving Store.defaultOutcomeId blank.
    if (allowed.size === 0) return null

    for (const pref of FREE_TIER_PREFERENCE) {
      const hit = candidates.find((o) => {
        const t = (o.displayTitle ?? o.title).toLowerCase()
        return t === pref && allowed.has(o.outcomeKey)
      })
      if (hit) return hit.id
    }

    // Final fallback: first allowed outcome alphabetically.
    const fallback = await prisma.outcome.findFirst({
      where: { supersededAt: null, outcomeKey: { in: Array.from(allowed) } },
      orderBy: [{ title: 'asc' }, { version: 'desc' }],
      select: { id: true },
    })
    if (fallback) return fallback.id
    return null
  }

  // Default path: alphabetically-first non-superseded Outcome.
  const row = await prisma.outcome.findFirst({
    where: { supersededAt: null },
    orderBy: [{ title: 'asc' }, { version: 'desc' }],
    select: { id: true },
  })
  return row?.id ?? null
}
