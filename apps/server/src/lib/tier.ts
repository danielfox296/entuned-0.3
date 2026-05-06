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

// ── Mutation helpers ──────────────────────────────────────────────────
//
// Every effective-tier transition is wrapped through one of these so the
// `tier_change_logs` audit row is written atomically with the Store update.
// Direct `prisma.store.update({ data: { compTier... } })` calls bypass the
// log — never do that from application code outside this file.

import { prisma } from '../db.js'
import type { Prisma } from '@prisma/client'

export type TierLogSource =
  | 'admin_comp'
  | 'admin_revoke'
  | 'stripe_webhook'
  | 'pause'
  | 'resume'
  | 'comp_expired'
  | 'auto_cleared'

interface ApplyChangeArgs {
  storeId: string
  /** Effective tier *before* the mutation, computed by the caller pre-update. */
  fromTier: Tier
  /** What the Store update should write. Pass exactly the fields you want
   * to change — anything omitted is left alone. */
  data: Prisma.StoreUpdateInput
  source: TierLogSource
  actorId?: string | null
  reason?: string | null
  /** For `admin_comp`: snapshot of `comp_expires_at` granted. */
  expiresAt?: Date | null
  tx?: Prisma.TransactionClient
}

/**
 * Apply a Store mutation that may change the effective tier, and write the
 * audit log row in the same transaction. Returns the updated Store row
 * (with comp fields) so callers can re-derive `effectiveTier()` post-write.
 *
 * No-op log when `to` ranks equal to `from` (e.g. revoking a comp that was
 * already shadowed by a higher paid tier). Caller decides whether to skip.
 */
export async function applyTierChange(args: ApplyChangeArgs) {
  const exec = async (db: Prisma.TransactionClient) => {
    const updated = await db.store.update({
      where: { id: args.storeId },
      data: args.data,
      select: {
        id: true,
        tier: true,
        compTier: true,
        compExpiresAt: true,
        compReason: true,
        compGrantedById: true,
        compGrantedAt: true,
      },
    })
    const toTier = effectiveTier(updated)
    if (toTier !== args.fromTier) {
      await db.tierChangeLog.create({
        data: {
          storeId: args.storeId,
          fromTier: args.fromTier,
          toTier,
          source: args.source,
          actorId: args.actorId ?? null,
          reason: args.reason ?? null,
          expiresAt: args.expiresAt ?? null,
        },
      })
    }
    return updated
  }
  if (args.tx) return exec(args.tx)
  return prisma.$transaction(exec)
}
