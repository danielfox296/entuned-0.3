-- Move arrangement from per-ICP template onto StyleAnalysis (per-ReferenceTrack).
-- The arrangement_templates table from the previous migration had no rows.

-- DropForeignKey
ALTER TABLE "arrangement_templates" DROP CONSTRAINT "arrangement_templates_icp_id_fkey";

-- DropTable
DROP TABLE "arrangement_templates";

-- AlterTable
ALTER TABLE "style_analyses" ADD COLUMN "arrangement_sections" JSONB;
ALTER TABLE "style_analyses" ADD COLUMN "arrangement_version" INTEGER;
