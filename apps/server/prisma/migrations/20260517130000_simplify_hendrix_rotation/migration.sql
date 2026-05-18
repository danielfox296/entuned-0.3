-- Simplify Hendrix rotation:
--   1. Drop daily_cap (no longer enforced; sibling spacing + no-repeat are enough).
--   2. Sever Free Tier ICP from paid stores that also have their own ICP linked.
--      Free-tier comp grants on free stores keep the link (they have no other pool).
--      A manual admin toggle can re-add the link for paid stores that request it.

ALTER TABLE "playback_rules" DROP COLUMN IF EXISTS "daily_cap";

DELETE FROM "store_icps" si
WHERE si.icp_id = '00000000-0000-0000-0000-000000000002'
  AND EXISTS (
    SELECT 1 FROM "stores" s
    WHERE s.id = si.store_id
      AND s.tier IN ('core', 'pro', 'enterprise', 'mvp_pilot')
  )
  AND EXISTS (
    SELECT 1 FROM "store_icps" si2
    WHERE si2.store_id = si.store_id
      AND si2.icp_id <> '00000000-0000-0000-0000-000000000002'
  );
