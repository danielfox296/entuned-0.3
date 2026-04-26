-- CreateTable
CREATE TABLE "hook_drafter_prompts" (
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "hook_drafter_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hook_drafter_prompts_icp_id_key" ON "hook_drafter_prompts"("icp_id");

-- AddForeignKey
ALTER TABLE "hook_drafter_prompts" ADD CONSTRAINT "hook_drafter_prompts_icp_id_fkey" FOREIGN KEY ("icp_id") REFERENCES "icps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
