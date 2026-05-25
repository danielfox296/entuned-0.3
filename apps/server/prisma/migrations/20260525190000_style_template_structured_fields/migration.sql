-- StyleTemplate gets structured fields + cap columns to drive Mars's legacy
-- style assembly from DB instead of the hardcoded 6-field list in
-- src/lib/mars/style-template-v1.ts. Existing rows kept; new columns default
-- to empty array + 950 cap. The next POST will seed the first "live" version
-- with the cleaned cold-start values from STYLE_TEMPLATE_SEED.

ALTER TABLE "style_templates"
  ADD COLUMN "fields"   TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "char_cap" INTEGER NOT NULL DEFAULT 950;
