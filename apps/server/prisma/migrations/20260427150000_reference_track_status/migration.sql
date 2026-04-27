-- CreateEnum
CREATE TYPE "ReferenceTrackStatus" AS ENUM ('pending', 'approved');

-- AlterTable
ALTER TABLE "reference_tracks" ADD COLUMN     "approved_at" TIMESTAMPTZ(6),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "status" "ReferenceTrackStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "suggested_at" TIMESTAMPTZ(6),
ADD COLUMN     "suggested_prompt_version" INTEGER,
ADD COLUMN     "suggested_rationale" TEXT;

-- CreateIndex
CREATE INDEX "reference_tracks_icp_id_status_idx" ON "reference_tracks"("icp_id", "status");
