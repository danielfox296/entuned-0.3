-- icp_location_fk: invert the ICP-Store relationship so ICP is the child (owns storeId FK).
-- Before: stores.icp_id → icps.id  (store is child, ICP is parent; many stores per ICP)
-- After:  icps.store_id → stores.id (ICP is child, store is parent; 1:1)

-- 1. Add store_id as nullable first (required for backfill before NOT NULL)
ALTER TABLE "icps" ADD COLUMN "store_id" UUID;

-- 2. Backfill: for each ICP set store_id from the store that points to it.
--    If multiple stores share an ICP, pick the earliest-created store.
UPDATE "icps" i
SET store_id = s.id
FROM (
  SELECT DISTINCT ON (icp_id) id, icp_id
  FROM "stores"
  ORDER BY icp_id, created_at ASC
) s
WHERE s.icp_id = i.id;

-- 3. Enforce NOT NULL (fails intentionally if any ICP has no associated store)
ALTER TABLE "icps" ALTER COLUMN "store_id" SET NOT NULL;

-- 4. Add UNIQUE constraint (enforces 1:1 ICP→Store)
ALTER TABLE "icps" ADD CONSTRAINT "icps_store_id_key" UNIQUE ("store_id");

-- 5. Add FK from icps.store_id → stores.id
ALTER TABLE "icps" ADD CONSTRAINT "icps_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Drop FK from stores.icp_id → icps.id
ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_icp_id_fkey";

-- 7. Drop the icp_id column from stores
ALTER TABLE "stores" DROP COLUMN IF EXISTS "icp_id";
