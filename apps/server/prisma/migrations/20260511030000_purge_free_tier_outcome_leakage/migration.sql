-- Purge free-tier outcome leakage.
--
-- The rule: free-tier stores may only use outcomes in FreeTierOutcome.
-- Daniel found "Calm" still playing on a free-tier store even after the
-- default-outcome fix shipped — leakage was happening through:
--   1. ScheduleSlot rows pointing at non-allowlisted outcomes
--   2. Stale Store.outcome_selection_id from before the player UI locked
--      the outcome picker
--
-- This migration cleans up both. New writes are blocked by route guards
-- (apps/server/src/routes/admin.ts + hendrix.ts) and the runtime resolver
-- (apps/server/src/lib/outcomeSchedule.ts) skips any that slip past.

-- 1. Delete schedule slots for free-tier stores whose outcome isn't in the
-- FreeTierOutcome allowlist. The owning store can re-create the slot with
-- an allowlisted outcome.
DELETE FROM "schedule_slots" s
USING "stores" st, "outcomes" o
WHERE s."store_id"   = st."id"
  AND s."outcome_id" = o."id"
  AND st."tier"      = 'free'
  AND o."outcome_key" NOT IN (SELECT "outcome_key" FROM "free_tier_outcomes");

-- 2. Clear stale outcome-selection overrides on free-tier stores when the
-- selected outcome isn't in the allowlist. Falls back to the schedule /
-- default outcome on the next /hendrix/next call.
UPDATE "stores" st
SET "outcome_selection_id"         = NULL,
    "outcome_selection_expires_at" = NULL
WHERE st."tier" = 'free'
  AND st."outcome_selection_id" IS NOT NULL
  AND st."outcome_selection_id" NOT IN (
    SELECT o."id" FROM "outcomes" o
    WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
  );
