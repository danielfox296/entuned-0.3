// One-line effect copy for each Outcome / free-tier Mode, keyed by the
// display title returned by the API (`o.title`, which the server resolves
// to `displayTitle ?? rawTitle`).
//
// Why this exists: the outcome names alone don't communicate that the
// product lever is *music*. "Stay & Browse" reads like a merchandising
// tactic; the effect line ("linger longer on the floor") makes the
// behavioral promise legible. Same strings already feed UpgradeRail's
// anchor copy — eventually these should live on Outcome.description in
// the DB so Dash can edit them, but for now this is the player SSOT.
export const OUTCOME_EFFECT: Record<string, string> = {
  // Boost / Pro outcomes (post 2026-07-11 merge: 5 paid outcomes)
  "Stay & Browse": "linger longer on the floor",
  "Keep It Moving": "speed turnover when it's busy",
  "Trade Them Up": "lift the average ticket",
  "Grab It Now": "drive impulse pickups",
  "Our Sound": "pure brand vibe",
  // Free-tier modes
  "Chill": "slow the room down",
  "Steady": "hold an even pace",
  "Upbeat": "lift the energy",
  // Legacy / retired outcome names — pre-rename equivalents and outcomes
  // absorbed by the 2026-07-11 merge migration. Mapped to their successor's
  // effect. See: prisma/seed/rename-outcomes-2026-05-14.ts and
  // prisma/migrations/20260711120000_consolidate_and_merge_outcomes.
  "Linger": "linger longer on the floor",            // → Stay & Browse
  "Help Them Decide": "lift the average ticket",     // merged → Trade Them Up
  "Convert Browsers": "lift the average ticket",     // merged → Trade Them Up
  "Swagger Spend": "lift the average ticket",        // merged → Trade Them Up
  "Increase Order Value": "lift the average ticket", // → Trade Them Up
  "Fill the Basket": "drive impulse pickups",        // merged → Grab It Now
  "Add More Items": "drive impulse pickups",         // merged → Grab It Now
  "Impulse Buy": "drive impulse pickups",            // → Grab It Now
  "Move Through": "speed turnover when it's busy",   // → Keep It Moving
  "Reinforce Brand": "pure brand vibe",              // → Our Sound
  // No rename — distinct legacy outcomes.
  "Lift Energy": "lift the energy",
  "Add Energy": "lift the energy",
  "Calm": "slow the room down",
};

export function effectFor(title: string | null | undefined): string | null {
  if (!title) return null;
  return OUTCOME_EFFECT[title] ?? null;
}
