-- CreateTable
CREATE TABLE "lyric_ban_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lyric_ban_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lyric_ban_entries_category_idx" ON "lyric_ban_entries"("category");

-- CreateIndex
CREATE UNIQUE INDEX "lyric_ban_entries_category_text_key" ON "lyric_ban_entries"("category", "text");
