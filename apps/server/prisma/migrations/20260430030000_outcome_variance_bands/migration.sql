-- Variance bands on Outcome + resolved-value provenance on SongSeed.
-- Both nullable / additive so existing rows are unaffected.

-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN "tempo_bpm_radius" INTEGER;
ALTER TABLE "outcomes" ADD COLUMN "mode_weights" JSONB;
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_tempo_bpm_radius_check" CHECK ("tempo_bpm_radius" IS NULL OR "tempo_bpm_radius" >= 0);

-- AlterTable
ALTER TABLE "song_seeds" ADD COLUMN "resolved_tempo_bpm" INTEGER;
ALTER TABLE "song_seeds" ADD COLUMN "resolved_mode" TEXT;
