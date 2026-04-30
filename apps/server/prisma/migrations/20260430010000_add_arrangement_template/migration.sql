-- CreateTable
CREATE TABLE "arrangement_templates" (
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sections" JSONB NOT NULL,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "arrangement_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arrangement_templates_icp_id_key" ON "arrangement_templates"("icp_id");

-- AddForeignKey
ALTER TABLE "arrangement_templates" ADD CONSTRAINT "arrangement_templates_icp_id_fkey" FOREIGN KEY ("icp_id") REFERENCES "icps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "song_seeds" ADD COLUMN "arrangement_template_version" INTEGER;
