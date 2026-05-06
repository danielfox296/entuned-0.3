-- Customer-dashboard "Retire" for audiences. Soft-delete: ICP rows + their
-- LineageRows are preserved (with active=false on the LineageRows) so the
-- audience and its song library can be restored later.
-- Schema SSOT: ../../../../entune v0.3/schema/04-gains.md

-- AlterTable
ALTER TABLE "icps"
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);
