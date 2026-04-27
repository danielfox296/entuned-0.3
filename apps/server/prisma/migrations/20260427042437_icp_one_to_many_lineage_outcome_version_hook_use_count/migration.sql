-- DropConstraint (unique constraint; the index is owned by the constraint, so drop the constraint not the index directly)
ALTER TABLE "icps" DROP CONSTRAINT "icps_store_id_key";

-- AlterTable
ALTER TABLE "hooks" ADD COLUMN     "use_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "lineage_rows" ADD COLUMN     "outcome_version" INTEGER;

-- CreateIndex
CREATE INDEX "icps_store_id_idx" ON "icps"("store_id");
