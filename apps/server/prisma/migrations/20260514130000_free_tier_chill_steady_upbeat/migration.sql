-- Replace free-tier outcome allowlist: Linger + Lift Energy → Chill + Steady + Upbeat.
--
-- Product spec 2026-05-14: free tier delivers sonic-envelope only (no lyrical
-- priming). The three modes are Chill, Steady, Upbeat. Linger moves to Boost tier.
--
-- Steps:
--   1. Clear the existing allowlist (Linger, Lift Energy).
--   2. Insert Chill, Steady, Upbeat (by display label — robust against key changes).
--   3. Fix free-tier stores whose default_outcome_id now falls outside the allowlist.
--   4. Purge stale schedule slots and outcome-selection overrides.

-- 1. Clear existing allowlist.
DELETE FROM "free_tier_outcomes";

-- 2. Insert Chill, Steady, Upbeat.
INSERT INTO "free_tier_outcomes" ("outcome_key")
SELECT DISTINCT outcome_key
FROM outcomes
WHERE COALESCE(display_title, title) IN ('Chill', 'Steady', 'Upbeat')
ON CONFLICT ("outcome_key") DO NOTHING;

-- 3. Re-anchor free-tier stores whose default outcome is now outside the allowlist.
UPDATE "stores" st
SET "default_outcome_id" = (
  SELECT o."id"
  FROM "outcomes" o
  WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    AND o."superseded_at" IS NULL
  ORDER BY COALESCE(o."display_title", o."title") ASC
  LIMIT 1
)
WHERE st."tier" = 'free'
  AND (
    st."default_outcome_id" IS NULL
    OR st."default_outcome_id" NOT IN (
      SELECT o."id" FROM "outcomes" o
      WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    )
  );

-- 4a. Drop schedule slots on free-tier stores pointing at non-allowlisted outcomes.
DELETE FROM "schedule_slots" s
USING "stores" st, "outcomes" o
WHERE s."store_id"   = st."id"
  AND s."outcome_id" = o."id"
  AND st."tier"      = 'free'
  AND o."outcome_key" NOT IN (SELECT "outcome_key" FROM "free_tier_outcomes");

-- 4b. Clear stale outcome-selection overrides on free-tier stores.
UPDATE "stores" st
SET "outcome_selection_id"         = NULL,
    "outcome_selection_expires_at" = NULL
WHERE st."tier" = 'free'
  AND st."outcome_selection_id" IS NOT NULL
  AND st."outcome_selection_id" NOT IN (
    SELECT o."id" FROM "outcomes" o
    WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
  );
