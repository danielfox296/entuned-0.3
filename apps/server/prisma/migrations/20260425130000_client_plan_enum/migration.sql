-- Convert clients.plan from free-form text to a Postgres enum with placeholder values.
-- Locked 2026-04-25 (Q3): mvp_pilot, trial, paid_pilot, production, paused, inactive.

CREATE TYPE "ClientPlan" AS ENUM (
  'mvp_pilot',
  'trial',
  'paid_pilot',
  'production',
  'paused',
  'inactive'
);

-- Migrate any pre-existing free-text values forward. The seeded value was 'mvp'.
UPDATE "clients" SET "plan" = 'mvp_pilot' WHERE "plan" = 'mvp';

-- For any other unrecognised legacy values, fall back to 'mvp_pilot' (safest default).
UPDATE "clients" SET "plan" = 'mvp_pilot'
  WHERE "plan" NOT IN ('mvp_pilot','trial','paid_pilot','production','paused','inactive');

ALTER TABLE "clients"
  ALTER COLUMN "plan" TYPE "ClientPlan" USING "plan"::"ClientPlan",
  ALTER COLUMN "plan" SET DEFAULT 'mvp_pilot';
