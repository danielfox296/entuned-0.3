-- GenreCraftRule, MarsContaminationTerm, MarsAxisRule: DB-backed rule storage
-- for what used to be hardcoded constants in src/lib/bernie/genre-craft-rules.ts
-- and src/lib/mars/negative-style-axes.ts. Migration was driven by the
-- no-prompt-content-in-code rule (see entuned-0.3/apps/server/CLAUDE.md
-- Load-bearing rules). Operators edit via Dash → Prompts & Rules.
--
-- Cold-start: a seed script (prisma/seed/seed-genre-craft-and-mars-axes.ts)
-- populates the tables from the cleaned former-hardcoded values. Once rows
-- exist, the TS consts are no longer consulted at runtime.

CREATE TABLE "genre_craft_rules" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "family_name"              TEXT NOT NULL,
  "tags"                     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "density_guidance"         TEXT NOT NULL,
  "rhyme_guidance"           TEXT NOT NULL,
  "line_structure_guidance"  TEXT NOT NULL,
  "voice_guidance"           TEXT NOT NULL,
  "typography_guidance"      TEXT NOT NULL,
  "sort_order"               INTEGER NOT NULL DEFAULT 0,
  "is_active"                BOOLEAN NOT NULL DEFAULT true,
  "notes"                    TEXT,
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_by"               UUID
);

CREATE UNIQUE INDEX "genre_craft_rules_family_name_key" ON "genre_craft_rules" ("family_name");
CREATE INDEX "genre_craft_rules_is_active_idx" ON "genre_craft_rules" ("is_active");

CREATE TABLE "mars_contamination_terms" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "category"   TEXT NOT NULL,
  "term"       TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active"  BOOLEAN NOT NULL DEFAULT true,
  "notes"      TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "mars_contamination_terms_category_term_key" ON "mars_contamination_terms" ("category", "term");
CREATE INDEX "mars_contamination_terms_category_is_active_idx" ON "mars_contamination_terms" ("category", "is_active");

CREATE TABLE "mars_axis_rules" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "axis_type"           TEXT NOT NULL,
  "label"               TEXT NOT NULL,
  "match_terms"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "opposites"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "secondary_opposites" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sort_order"          INTEGER NOT NULL DEFAULT 0,
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "notes"               TEXT,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "mars_axis_rules_axis_type_label_key" ON "mars_axis_rules" ("axis_type", "label");
CREATE INDEX "mars_axis_rules_axis_type_is_active_idx" ON "mars_axis_rules" ("axis_type", "is_active");
