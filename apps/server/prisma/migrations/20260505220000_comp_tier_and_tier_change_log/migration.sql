-- Comp tier (admin-granted free upgrade) + audit log.
-- Schema SSOT: ../../../../entune v0.3/schema/03-duke.md

-- AlterTable
ALTER TABLE "stores"
  ADD COLUMN "comp_tier"        TEXT,
  ADD COLUMN "comp_expires_at"  TIMESTAMPTZ(6),
  ADD COLUMN "comp_reason"      TEXT,
  ADD COLUMN "comp_granted_by"  UUID,
  ADD COLUMN "comp_granted_at"  TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "tier_change_logs" (
    "id"         UUID NOT NULL,
    "store_id"   UUID NOT NULL,
    "from_tier"  TEXT NOT NULL,
    "to_tier"    TEXT NOT NULL,
    "source"     TEXT NOT NULL,
    "actor_id"   UUID,
    "reason"     TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tier_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tier_change_logs_store_id_created_at_idx"
  ON "tier_change_logs" ("store_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "tier_change_logs"
  ADD CONSTRAINT "tier_change_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
