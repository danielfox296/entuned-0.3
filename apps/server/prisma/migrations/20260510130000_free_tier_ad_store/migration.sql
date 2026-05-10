-- Sentinel "Entuned House Ads" Store under FREE_TIER_CLIENT_ID. Holds the
-- Entuned-controlled interstitial-ad campaigns played to free-tier users.
-- Free-tier stores resolve their ad source to this row in injectAdIfDue
-- (see apps/server/src/lib/hendrix.ts). Schema SSOT: ../entune v0.3/schema/22-campaigns.md.
--
-- Stable UUID (matches src/lib/freeTier.ts):
--   Free Tier Ad Store: 00000000-0000-0000-0000-000000000003
--
-- Tier deliberately set to 'enterprise' so the row is clearly internal and
-- never resolves back to itself in the free-tier branch (no recursion risk
-- since the lookup is by stable UUID, but the explicit non-free tier makes
-- the intent obvious to anyone reading the row).

BEGIN;

INSERT INTO "stores" (
  "id",
  "client_id",
  "name",
  "timezone",
  "slug",
  "tier",
  "room_loudness_sampling_enabled",
  "created_at",
  "updated_at"
)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Entuned House Ads',
  'UTC',
  'entuned-house-ads',
  'enterprise',
  false,
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
