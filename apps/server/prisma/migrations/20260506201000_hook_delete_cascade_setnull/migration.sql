-- DropForeignKey
ALTER TABLE "song_seeds" DROP CONSTRAINT "song_seeds_hook_id_fkey";

-- DropForeignKey
ALTER TABLE "lineage_rows" DROP CONSTRAINT "lineage_rows_hook_id_fkey";

-- AddForeignKey
ALTER TABLE "song_seeds" ADD CONSTRAINT "song_seeds_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "hooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_rows" ADD CONSTRAINT "lineage_rows_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "hooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
