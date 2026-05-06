// Tier helpers — single source of truth for "what tier does this Store
// effectively have right now." `Store.tier` reflects what the customer is
// paying for via Stripe; `Store.compTier` is an admin-granted free upgrade
// that overrides upward (never downward).
//
// Schema SSOT: ../../../entune v0.3/schema/03-duke.md "Comp tier" section.

export type Tier = 'free' | 'core' | 'pro' | 'enterprise' | 'mvp_pilot'

// `mvp_pilot` is a legacy seed-tier; ranked equal to `core` so seeded stores
// behave like Core for entitlement purposes. `free` is the floor.
const RANK: Record<Tier, number> = {
  free: 0,
  mvp_pilot: 1,
  core: 1,
  pro: 2,
  enterprise: 3,
}

export function tierRank(t: string | null | undefined): number {
  if (!t) return 0
  return RANK[t as Tier] ?? 0
}

/** Subset of Store needed to compute effective tier. Lets callers pass either
 * a full Prisma Store or a hand-shaped object (e.g. from a select projection). */
export interface StoreTierFields {
  tier: string
  compTier: string | null
  compExpiresAt: Date | null
}

/**
 * Effective tier = max(paid tier, comp tier) while the comp is unexpired.
 * Comp can only upgrade. If `compTier` ranks ≤ `tier`, paid tier wins.
 *
 * USE THIS EVERYWHERE the application makes an entitlement decision (UI gates,
 * lifecycle email skips, feature flags). Direct reads of `Store.tier` are
 * acceptable only when the question is literally "what is Stripe charging
 * them for" — e.g. billing reports, checkout flows, restore-after-pause.
 */
export function effectiveTier(store: StoreTierFields, now: Date = new Date()): Tier {
  const paid = (store.tier as Tier) ?? 'free'
  if (!store.compTier) return paid
  if (store.compExpiresAt && store.compExpiresAt <= now) return paid
  const comp = store.compTier as Tier
  return tierRank(comp) > tierRank(paid) ? comp : paid
}

/** True iff the comp on this store is currently active (set + unexpired). */
export function compIsActive(store: StoreTierFields, now: Date = new Date()): boolean {
  if (!store.compTier) return false
  if (store.compExpiresAt && store.compExpiresAt <= now) return false
  return true
}
