-- AlterTable: Eno-2 pipeline provenance
ALTER TABLE "song_seed_batches" ADD COLUMN "pipeline" TEXT;

-- AlterTable
ALTER TABLE "song_seeds" ADD COLUMN "pipeline" TEXT;
ALTER TABLE "song_seeds" ADD COLUMN "genre_brief" TEXT;
