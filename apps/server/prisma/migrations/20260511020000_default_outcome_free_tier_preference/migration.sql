-- Re-point free-tier Stores at the right default outcome.
--
-- The previous migration (20260511010000_default_outcome_for_existing_stores)
-- picked the alphabetically-first non-superseded Outcome, which landed
-- free-tier stores on "Calm" — an outcome that isn't even in the
-- FreeTierOutcome allowlist. Daniel's rule (2026-05-11):
--
--   free-tier default preference: "All Outcomes" → "Add Energy" → "Lift Energy"
--   → first allowlisted outcome alphabetically.
--
-- Only touches stores where tier = 'free'. Other tiers keep what they have.

UPDATE "stores"
SET "default_outcome_id" = COALESCE(
  -- 1st choice: "All Outcomes" (if it exists and is in the allowlist)
  (
    SELECT o."id"
    FROM "outcomes" o
    WHERE o."superseded_at" IS NULL
      AND (LOWER(o."title") = 'all outcomes' OR LOWER(o."display_title") = 'all outcomes')
      AND o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    ORDER BY o."version" DESC
    LIMIT 1
  ),
  -- 2nd choice: "Add Energy"
  (
    SELECT o."id"
    FROM "outcomes" o
    WHERE o."superseded_at" IS NULL
      AND (LOWER(o."title") = 'add energy' OR LOWER(o."display_title") = 'add energy')
      AND o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    ORDER BY o."version" DESC
    LIMIT 1
  ),
  -- 3rd choice: "Lift Energy"
  (
    SELECT o."id"
    FROM "outcomes" o
    WHERE o."superseded_at" IS NULL
      AND (LOWER(o."title") = 'lift energy' OR LOWER(o."display_title") = 'lift energy')
      AND o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    ORDER BY o."version" DESC
    LIMIT 1
  ),
  -- Fallback: any allowlisted outcome, alphabetically.
  (
    SELECT o."id"
    FROM "outcomes" o
    WHERE o."superseded_at" IS NULL
      AND o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    ORDER BY o."title" ASC, o."version" DESC
    LIMIT 1
  ),
  -- Last resort: leave whatever was there.
  "default_outcome_id"
)
WHERE "tier" = 'free';
