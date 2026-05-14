-- Add onboarding profile, benchmarking, and referral fields to Client
ALTER TABLE "clients"
  ADD COLUMN "industry"             TEXT,
  ADD COLUMN "zip"                  TEXT,
  ADD COLUMN "annual_revenue_range" TEXT,
  ADD COLUMN "employee_count_range" TEXT,
  ADD COLUMN "store_location_count" INTEGER,
  ADD COLUMN "referral_code"        TEXT,
  ADD COLUMN "referred_by_code"     TEXT;

CREATE UNIQUE INDEX "clients_referral_code_key" ON "clients"("referral_code");

-- Add onboarding ICP forced-choice fields and source flag to ICP
ALTER TABLE "icps"
  ADD COLUMN "source"                TEXT NOT NULL DEFAULT 'operator',
  ADD COLUMN "icp_age_center"        TEXT,
  ADD COLUMN "icp_age_range_wide"    BOOLEAN,
  ADD COLUMN "icp_gender_skew"       TEXT,
  ADD COLUMN "icp_shopping_mode"     TEXT,
  ADD COLUMN "icp_store_personality" TEXT,
  ADD COLUMN "icp_current_music"     TEXT,
  ADD COLUMN "icp_current_music_other" TEXT,
  ADD COLUMN "icp_playlist_ref"      TEXT,
  ADD COLUMN "icp_price_point"       TEXT;
