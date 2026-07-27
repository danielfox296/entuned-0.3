-- Hook Editor prompt: system prompt for the post-drafter finishing pass.
-- Mirrors hook_drafter_prompts (global, append-only per version).
CREATE TABLE "hook_editor_prompts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_by" UUID,

    CONSTRAINT "hook_editor_prompts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hook_editor_prompts_version_key" ON "hook_editor_prompts"("version");
