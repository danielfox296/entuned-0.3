-- Re-lock the free tier to the three modes: Chill + Steady + Upbeat.
--
-- Product decision 2026-07-11 (Daniel): the 2026-05-28 bulk-enable of all
-- outcomes on the free tier is no longer relevant — restore the 2026-05-14
-- spec (free tier = sonic-envelope modes only; outcomes are the Boost
-- unlock). Mirrors 20260514130000_free_tier_chill_steady_upbeat.
--
-- Runs after 20260711120000_consolidate_and_merge_outcomes, so the paid
-- catalog this locks against is the merged 5-outcome set.
--
-- Steps:
--   1. Clear the allowlist (currently: every outcome).
--   2. Insert Chill, Steady, Upbeat (by display label).
--   3. Re-anchor free-tier stores whose default outcome is now locked.
--   4. Purge free-tier schedule slots and selection overrides outside the
--      allowlist.

-- 1. Clear existing allowlist.
DELETE FROM "free_tier_outcomes";

-- 2. Insert Chill, Steady, Upbeat.
INSERT INTO "free_tier_outcomes" ("outcome_key")
SELECT DISTINCT outcome_key
FROM outcomes
WHERE COALESCE(display_title, title) IN ('Chill', 'Steady', 'Upbeat')
  AND superseded_at IS NULL
ON CONFLICT ("outcome_key") DO NOTHING;

-- 3. Re-anchor free-tier stores whose default outcome is now outside the
--    allowlist. Preference: Chill first (matches lib/outcomes.ts
--    FREE_TIER_PREFERENCE), which alphabetical ordering happens to give us.
--    Scope: EFFECTIVELY free stores only — a store with an active comp
--    (comp_tier set, unexpired) keeps its paid entitlements per
--    lib/tier.ts effectiveTier, so its default/slots must not be touched
--    (e.g. the untuckit pilot runs on comp=pro). When a comp later
--    expires, the runtime allowlist filter in lib/hendrix.ts covers
--    playback until the operator re-points the config.
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
  AND (st."comp_tier" IS NULL OR (st."comp_expires_at" IS NOT NULL AND st."comp_expires_at" <= now()))
  AND (
    st."default_outcome_id" IS NULL
    OR st."default_outcome_id" NOT IN (
      SELECT o."id" FROM "outcomes" o
      WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    )
  );

-- 4a. Drop schedule slots on effectively-free stores pointing at
--     non-allowlisted outcomes.
DELETE FROM "schedule_slots" s
USING "stores" st, "outcomes" o
WHERE s."store_id"   = st."id"
  AND s."outcome_id" = o."id"
  AND st."tier"      = 'free'
  AND (st."comp_tier" IS NULL OR (st."comp_expires_at" IS NOT NULL AND st."comp_expires_at" <= now()))
  AND o."outcome_key" NOT IN (SELECT "outcome_key" FROM "free_tier_outcomes");

-- 4b. Clear stale outcome-selection overrides on effectively-free stores.
UPDATE "stores" st
SET "outcome_selection_id"         = NULL,
    "outcome_selection_expires_at" = NULL
WHERE st."tier" = 'free'
  AND (st."comp_tier" IS NULL OR (st."comp_expires_at" IS NOT NULL AND st."comp_expires_at" <= now()))
  AND st."outcome_selection_id" IS NOT NULL
  AND st."outcome_selection_id" NOT IN (
    SELECT o."id" FROM "outcomes" o
    WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
  );
