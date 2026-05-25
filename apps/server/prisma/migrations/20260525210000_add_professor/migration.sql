-- The Professor — finishing editor for song lyrics. Runs between Bernie's
-- edit pass and the arranger's section-marker injection.
--
-- `professor_personas`: versioned system prompt (mirrors lyric_draft_prompts).
-- `professor_modules`:  curriculum list, CRUD'd in Dash (not versioned).
-- `song_seeds`: three new provenance columns capturing what the Professor
-- received and what it did. `lyric_pre_professor` is the post-Bernie lyric
-- (the input the Professor saw); `professor_change_log` is a JSON-serialized
-- list of brief tags emitted by the persona's per-change audit.

CREATE TABLE "professor_personas" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "version"     INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"  UUID
);

CREATE UNIQUE INDEX "professor_personas_version_key" ON "professor_personas" ("version");

CREATE TABLE "professor_modules" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "active"     BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "professor_modules_active_sort_order_idx" ON "professor_modules" ("active", "sort_order");

ALTER TABLE "song_seeds"
  ADD COLUMN "professor_persona_version" INTEGER,
  ADD COLUMN "lyric_pre_professor"       TEXT,
  ADD COLUMN "professor_change_log"      TEXT;
