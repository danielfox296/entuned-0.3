-- Store ↔ ICP becomes many-to-many, and the canonical Free Tier ICP/Client
-- replaces the icp_id=NULL "general pool" convention on lineage_rows.
--
-- Atomic transaction: any failure rolls everything back. Idempotent on the
-- Free Tier rows (ON CONFLICT DO NOTHING) so a re-run after partial rollback
-- still works.
--
-- Stable UUIDs for the singletons (matches src/lib/freeTier.ts):
--   Free Tier Client:  00000000-0000-0000-0000-000000000001
--   Free Tier ICP:     00000000-0000-0000-0000-000000000002

BEGIN;

-- 1. New join table.
CREATE TABLE "store_icps" (
    "store_id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_icps_pkey" PRIMARY KEY ("store_id", "icp_id")
);
CREATE INDEX "store_icps_icp_id_idx" ON "store_icps"("icp_id");
ALTER TABLE "store_icps"
  ADD CONSTRAINT "store_icps_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_icps"
  ADD CONSTRAINT "store_icps_icp_id_fkey"
  FOREIGN KEY ("icp_id") REFERENCES "icps"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill the join from the legacy icps.store_id 1:N. Cardinality preserved.
INSERT INTO "store_icps" ("store_id", "icp_id", "created_at")
SELECT store_id, id, created_at FROM "icps";

-- 3. Drop the old single FK + its index.
DROP INDEX IF EXISTS "icps_store_id_idx";
ALTER TABLE "icps" DROP COLUMN "store_id";

-- 4. Create the canonical Free Tier Client + ICP. Stable UUIDs so the
-- application layer can reference them without env config.
INSERT INTO "clients" ("id", "company_name", "plan", "created_at", "updated_at")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Free Tier',
  'production',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "icps" ("id", "client_id", "name", "created_at", "updated_at")
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'Free Tier',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- 5. Link every existing Store that has no ICPs to the Free Tier ICP. Today
-- this is exactly the free-tier Stores (signup never assigned them an ICP),
-- but the WHERE clause is by membership-absence so it's correct regardless of tier.
INSERT INTO "store_icps" ("store_id", "icp_id")
SELECT s.id, '00000000-0000-0000-0000-000000000002'
FROM "stores" s
WHERE NOT EXISTS (SELECT 1 FROM "store_icps" WHERE store_id = s.id)
ON CONFLICT DO NOTHING;

-- 6. Repoint the icp_id=NULL "general pool" LineageRows to the Free Tier ICP,
-- then enforce NOT NULL. hook_id stays nullable — hand-curated free-tier
-- songs legitimately have no Hook (no SongSeed → no generation provenance).
UPDATE "lineage_rows"
SET icp_id = '00000000-0000-0000-0000-000000000002'
WHERE icp_id IS NULL;

ALTER TABLE "lineage_rows" ALTER COLUMN "icp_id" SET NOT NULL;

-- 7. Add the FK from lineage_rows.icp_id → icps.id (was previously absent
-- because the column was nullable for the general-pool case).
ALTER TABLE "lineage_rows"
  ADD CONSTRAINT "lineage_rows_icp_id_fkey"
  FOREIGN KEY ("icp_id") REFERENCES "icps"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
