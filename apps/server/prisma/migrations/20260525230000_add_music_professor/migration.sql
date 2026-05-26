-- The Music Professor — finishing editor for Mars's style + negativeStyle.
-- Runs between Mars's assemble and eno's applyOutcomeFactorPrompt wrap.
--
-- `music_professor_personas`: versioned system prompt (mirrors professor_personas).
-- `music_professor_modules`:  curriculum list, CRUD'd in Dash. `tier` adds an
--                             operator-facing severity dial.
-- `genre_gravity_rules`:      per-tag counter-exclusion table used by the
--                             genre-gravity curriculum module.
-- `song_seeds`: four new provenance columns capturing what the Music Professor
-- received and what it did.

CREATE TABLE "music_professor_personas" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "version"     INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"  UUID
);

CREATE UNIQUE INDEX "music_professor_personas_version_key" ON "music_professor_personas" ("version");

CREATE TABLE "music_professor_modules" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "tier"       TEXT NOT NULL DEFAULT 'optional',
  "active"     BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "music_professor_modules_active_sort_order_idx" ON "music_professor_modules" ("active", "sort_order");

CREATE TABLE "genre_gravity_rules" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tag"                TEXT NOT NULL,
  "gravity"            INTEGER NOT NULL DEFAULT 5,
  "counter_exclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"              TEXT,
  "active"             BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "genre_gravity_rules_tag_key" ON "genre_gravity_rules" ("tag");
CREATE INDEX "genre_gravity_rules_active_idx" ON "genre_gravity_rules" ("active");

ALTER TABLE "song_seeds"
  ADD COLUMN "music_professor_persona_version"     INTEGER,
  ADD COLUMN "style_pre_music_professor"           TEXT,
  ADD COLUMN "negative_style_pre_music_professor"  TEXT,
  ADD COLUMN "music_professor_change_log"          TEXT;
