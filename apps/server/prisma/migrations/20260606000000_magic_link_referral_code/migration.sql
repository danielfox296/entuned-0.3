-- Referral-code attribution write-path.
--
-- /r/:code (dashboard) stamps the referral code into sessionStorage
-- (`entuned_referral_code`); /start sends it in the magic-link request body
-- alongside the attr_* fields; the server sanitizes it strictly (must match
-- the server-generated code charset [A-Za-z0-9_-]{1,64}) and parks it here on
-- the MagicLinkToken across the two-request round-trip, then copies it onto
-- the new Client's existing `referred_by_code` column at /verify — Client
-- creation only, never overwritten on returning sign-ins.
--
-- Additive and nullable — existing rows read as null (= not referred), no
-- backfill. `clients.referred_by_code` already exists (2026-05-14); this only
-- adds the token-side carrier column.

ALTER TABLE "magic_link_tokens"
  ADD COLUMN "referral_code" TEXT;
