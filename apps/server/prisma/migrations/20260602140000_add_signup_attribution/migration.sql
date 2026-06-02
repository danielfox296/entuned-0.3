-- First-touch signup attribution.
--
-- We persist where a free-tier signup came from (external referrer, UTM tags,
-- and the first landing path within the Entuned property). The data is captured
-- client-side on first page view as a `.entuned.co` `entuned_attr` cookie, read
-- by /start, sent in the magic-link request body, parked on the MagicLinkToken
-- across the two-request round-trip, and copied onto the new Client at /verify.
--
-- All columns are additive and nullable — existing rows read as null (= no
-- attribution captured / direct), so there is no backfill. Client.attr_* are
-- write-once at first sign-in; returning sign-ins never overwrite them.

ALTER TABLE "magic_link_tokens"
  ADD COLUMN "attr_referrer"     TEXT,
  ADD COLUMN "attr_landing_path" TEXT,
  ADD COLUMN "attr_utm_source"   TEXT,
  ADD COLUMN "attr_utm_medium"   TEXT,
  ADD COLUMN "attr_utm_campaign" TEXT,
  ADD COLUMN "attr_utm_term"     TEXT,
  ADD COLUMN "attr_utm_content"  TEXT;

ALTER TABLE "clients"
  ADD COLUMN "attr_referrer"     TEXT,
  ADD COLUMN "attr_landing_path" TEXT,
  ADD COLUMN "attr_utm_source"   TEXT,
  ADD COLUMN "attr_utm_medium"   TEXT,
  ADD COLUMN "attr_utm_campaign" TEXT,
  ADD COLUMN "attr_utm_term"     TEXT,
  ADD COLUMN "attr_utm_content"  TEXT;
