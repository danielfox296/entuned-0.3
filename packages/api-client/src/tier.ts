// Canonical tier branding for every Entuned frontend.
//
// The tier->label map has been redefined independently in apps/dashboard,
// apps/admin, and apps/player, and the public renames (Essentials -> Entuned
// Free, Core -> Boost) have bitten more than once when one copy drifted. This
// module is the single source of truth.
//
// IMPORTANT: DB values and API params are 'free' | 'core' | 'pro' | 'enterprise'
// | 'mvp_pilot' and never change. Only the user-facing LABELS change. Never
// reintroduce "Essentials" or "Core" as labels.

/**
 * All tier value keys used across the system. `mvp_pilot` is a legacy
 * operator-only tier surfaced in Dash's tier history; customer-facing apps
 * only ever see 'free' | 'core' | 'pro' | 'enterprise'.
 */
export type Tier = 'free' | 'core' | 'pro' | 'enterprise' | 'mvp_pilot'

/**
 * Ordering for feature gating ("is this store at or above tier X?").
 * mvp_pilot sits between free and core: it predates the paid tiers and was a
 * comped pilot slot, so it must rank as paid-ish but below Boost. Customer
 * apps never compare against it.
 */
export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  mvp_pilot: 0.5,
  core: 1,
  pro: 2,
  enterprise: 3,
}

/** Public-facing display label for each tier. The branding SSOT. */
export const TIER_LABEL: Record<Tier, string> = {
  free: 'Entuned Free',
  mvp_pilot: 'MVP Pilot',
  core: 'Boost',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

/** Price line shown on upgrade / lock surfaces. */
export const TIER_PRICE: Record<Tier, string> = {
  free: 'Free',
  mvp_pilot: 'Custom',
  core: '$99 / location / month',
  pro: '$399 / location / month',
  enterprise: 'Custom',
}

/**
 * Label for a possibly-unknown tier string. Returns the canonical label when
 * the value is a known tier, otherwise echoes the raw input — mirroring the
 * `TIER_LABEL[x] ?? x` fallback pattern call-sites relied on when indexing the
 * map with a loosely-typed `string`.
 */
export function labelForTier(tier: string): string {
  return (TIER_LABEL as Record<string, string>)[tier] ?? tier
}

/** Highest-rank tier across a set of stores. Returns 'free' for empty input. */
export function highestTier(stores: { tier: Tier }[]): Tier {
  if (stores.length === 0) return 'free'
  return stores.reduce<Tier>((best, s) => (TIER_RANK[s.tier] > TIER_RANK[best] ? s.tier : best), 'free')
}
