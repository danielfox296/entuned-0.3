-- CreateTable
CREATE TABLE "reference_track_prompts" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "template_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "reference_track_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reference_track_prompts_version_key" ON "reference_track_prompts"("version");
