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
  // Boost / Pro outcomes
  "Stay & Browse": "linger longer on the floor",
  "Help Them Decide": "nudge browsers toward the till",
  "Trade Them Up": "lift the average ticket",
  "Fill the Basket": "more items per visit",
  "Grab It Now": "drive impulse pickups",
  "Keep It Moving": "speed turnover when it's busy",
  "Our Sound": "pure brand vibe",
  "Swagger Spend": "confidence to upgrade",
  // Free-tier modes
  "Chill": "slow the room down",
  "Steady": "hold an even pace",
  "Upbeat": "lift the energy",
  // Legacy outcome names — pre-rename equivalents still in use by older
  // stores (e.g. Untuckit). Mapped to the same effect as their successor.
  // See: prisma/seed/rename-outcomes-2026-05-14.ts.
  "Linger": "linger longer on the floor",            // → Stay & Browse
  "Convert Browsers": "nudge browsers toward the till", // → Help Them Decide
  "Increase Order Value": "lift the average ticket", // → Trade Them Up
  "Add More Items": "more items per visit",          // → Fill the Basket
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
