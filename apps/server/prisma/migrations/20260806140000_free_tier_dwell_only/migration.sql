-- Repoint the free-tier outcome allowlist: Chill + Steady + Upbeat → Dwell only.
--
-- Dwell Launch Spec v1 (2026-08-06): the free tier delivers ONE outcome instead
-- of three sonic-envelope modes. Chill / Steady / Upbeat stay live in the
-- catalogue — their songs keep playing and operators can still assign them in
-- Dash — they are simply no longer what Entuned Free hands you.
--
-- ORDER IS LOAD-BEARING. `getFreeTierAllowedOutcomeIds()` returns an EMPTY set
-- when `free_tier_outcomes` has no rows, and an empty set filters the free pool
-- to NOTHING rather than opening it up. So Dwell goes in FIRST and the old rows
-- only come out once Dwell is confirmed present. The allowlist is never empty
-- at any point in this migration.
--
-- Steps:
--   1. Insert Dwell into the allowlist.
--   2. Delete every other row — guarded on Dwell actually being there.
--   3. Re-point free-tier store defaults to Dwell.
--   4. Re-point free-tier schedule slots to Dwell (re-point, never orphan).
--   5. Clear stale free-tier outcome-selection overrides.

-- 1. Insert Dwell. Matched on the display name AND the internal title so this
--    survives either being edited later. `Outcome.title` is 'Dwell Extension';
--    note that 'Dwell Compression' displays as 'Keep It Moving' and must NOT
--    match — hence the exact-equality checks rather than a LIKE.
INSERT INTO "free_tier_outcomes" ("outcome_key")
SELECT DISTINCT o."outcome_key"
FROM "outcomes" o
WHERE o."superseded_at" IS NULL
  AND (COALESCE(o."display_title", o."title") = 'Dwell' OR o."title" = 'Dwell Extension')
ON CONFLICT ("outcome_key") DO NOTHING;

-- 2. Drop everything else — but ONLY if step 1 actually landed a row. On a DB
--    where the Dwell outcome is missing this is a no-op and the allowlist keeps
--    its previous contents, rather than emptying and killing free playback.
DELETE FROM "free_tier_outcomes" f
WHERE EXISTS (
        SELECT 1 FROM "outcomes" o
        WHERE o."superseded_at" IS NULL
          AND (COALESCE(o."display_title", o."title") = 'Dwell' OR o."title" = 'Dwell Extension')
      )
  AND f."outcome_key" NOT IN (
        SELECT o."outcome_key" FROM "outcomes" o
        WHERE o."superseded_at" IS NULL
          AND (COALESCE(o."display_title", o."title") = 'Dwell' OR o."title" = 'Dwell Extension')
      );

-- 3. Re-point free-tier stores whose default outcome now falls outside the
--    allowlist. Prod before this migration: 15 stores default to Upbeat, 9 to
--    Chill — all 24 land on Dwell.
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
  AND EXISTS (SELECT 1 FROM "free_tier_outcomes")
  AND (
    st."default_outcome_id" IS NULL
    OR st."default_outcome_id" NOT IN (
      SELECT o."id" FROM "outcomes" o
      WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    )
  );

-- 4. Re-point (not delete) free-tier schedule slots pointing outside the
--    allowlist. The 2026-05-14 migration DELETEd these; re-pointing preserves
--    the operator's day/time structure instead of silently dropping it.
--    `schedule_slots` has no uniqueness constraint on (store, outcome), so
--    several slots collapsing onto Dwell is safe.
UPDATE "schedule_slots" s
SET "outcome_id" = (
  SELECT o."id"
  FROM "outcomes" o
  WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
    AND o."superseded_at" IS NULL
  ORDER BY COALESCE(o."display_title", o."title") ASC
  LIMIT 1
)
FROM "stores" st
WHERE s."store_id" = st."id"
  AND st."tier" = 'free'
  AND EXISTS (SELECT 1 FROM "free_tier_outcomes")
  AND s."outcome_id" NOT IN (
    SELECT o."id" FROM "outcomes" o
    WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
  );

-- 5. Clear stale outcome-selection overrides on free-tier stores. Nulling the
--    override drops the store back to its (now-Dwell) default rather than
--    leaving it pinned to an outcome it can no longer play. Prod before this
--    migration: 3 free stores hold an active override.
UPDATE "stores" st
SET "outcome_selection_id"         = NULL,
    "outcome_selection_expires_at" = NULL
WHERE st."tier" = 'free'
  AND st."outcome_selection_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "free_tier_outcomes")
  AND st."outcome_selection_id" NOT IN (
    SELECT o."id" FROM "outcomes" o
    WHERE o."outcome_key" IN (SELECT "outcome_key" FROM "free_tier_outcomes")
  );
