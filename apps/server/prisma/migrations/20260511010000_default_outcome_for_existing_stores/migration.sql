-- Backfill default_outcome_id on every Store that doesn't have one.
-- Daniel's rule (2026-05-11): a missing default outcome should not be a
-- launch blocker; every Store should get one at creation. New-Store paths
-- are patched in code; this migration cleans up existing rows so the
-- Launch Checklist stops complaining about historical Stores.
--
-- Strategy: pick the alphabetically-first non-superseded Outcome (same
-- rule as pickSystemDefaultOutcomeId in lib/outcomes.ts) and assign it to
-- every Store with a NULL default. If no active outcomes exist, the
-- subquery returns NULL and the UPDATE is a no-op for those rows — same
-- as the prior state, but no rows in production should hit that case.

UPDATE "stores"
SET "default_outcome_id" = (
  SELECT "id" FROM "outcomes"
  WHERE "superseded_at" IS NULL
  ORDER BY "title" ASC, "version" DESC
  LIMIT 1
)
WHERE "default_outcome_id" IS NULL;
