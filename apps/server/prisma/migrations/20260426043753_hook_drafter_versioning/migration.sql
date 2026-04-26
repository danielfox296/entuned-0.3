-- AlterTable
ALTER TABLE "hook_drafter_prompts" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "hook_drafter_prompt_versions" (
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "hook_drafter_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hook_drafter_prompt_versions_icp_id_version_idx" ON "hook_drafter_prompt_versions"("icp_id", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "hook_drafter_prompt_versions_icp_id_version_key" ON "hook_drafter_prompt_versions"("icp_id", "version");
