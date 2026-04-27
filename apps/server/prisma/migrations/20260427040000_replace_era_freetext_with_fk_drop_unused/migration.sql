-- Drop unused generation-signal columns that have no translation path to Suno prompts.
ALTER TABLE "outcomes" DROP COLUMN IF EXISTS "pleasure_target";
ALTER TABLE "outcomes" DROP COLUMN IF EXISTS "cultural_category_prime";

-- Replace freetext production_era with a proper FK to the production_eras table.
ALTER TABLE "outcomes" DROP COLUMN IF EXISTS "production_era";
ALTER TABLE "outcomes" ADD COLUMN "production_era_id" UUID REFERENCES "production_eras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
