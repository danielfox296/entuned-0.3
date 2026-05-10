-- FormArchetype: operator-editable catalogue of song-form archetypes.
-- Eno picks one per generation and passes its section_list + shape_note into
-- Bernie so the lyric writer knows the form. Replaces a hardcoded V/C/V/C/Bridge/FC
-- shape that was baked into Bernie's draft prompt and was making every song
-- arrangement-similar.
--
-- Schema SSOT: ../../../entune v0.3/schema/light-cards.md (FormArchetype section).
-- Seed (6 archetypes) lives at prisma/seed/seed-form-archetypes.ts and runs once
-- via `railway ssh` after this migration deploys.

CREATE TABLE "form_archetypes" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"               TEXT NOT NULL,
  "display_name"       TEXT NOT NULL,
  "section_list"       TEXT NOT NULL,
  "shape_note"         TEXT NOT NULL,
  "requires_sections"  TEXT[] NOT NULL DEFAULT '{}',
  "outcome_weights"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "era_weights"        JSONB,
  "is_active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "form_archetypes_slug_key" ON "form_archetypes" ("slug");
CREATE INDEX "form_archetypes_is_active_idx" ON "form_archetypes" ("is_active");
