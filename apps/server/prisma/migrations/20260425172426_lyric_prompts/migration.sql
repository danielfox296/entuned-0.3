-- CreateTable
CREATE TABLE "lyric_draft_prompts" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "lyric_draft_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lyric_edit_prompts" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "lyric_edit_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lyric_draft_prompts_version_key" ON "lyric_draft_prompts"("version");

-- CreateIndex
CREATE UNIQUE INDEX "lyric_edit_prompts_version_key" ON "lyric_edit_prompts"("version");
