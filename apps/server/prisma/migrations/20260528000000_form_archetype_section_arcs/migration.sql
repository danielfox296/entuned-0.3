-- FormArchetype: replace the flat `section_list` string with a structured,
-- ordered `sections` JSON array carrying a per-section narrative arc.
-- Shape: [{ "label": string, "optional"?: boolean, "arc": string }]
--
-- Existing rows are the 6 seeded forms; they are repopulated immediately after
-- deploy by prisma/seed/seed-form-archetypes.ts (idempotent upsert by slug).
-- The picker skips any archetype with an empty `sections` array, so generation
-- falls back to the legacy default during the brief migrate→seed window.
ALTER TABLE "form_archetypes" DROP COLUMN "section_list";
ALTER TABLE "form_archetypes" ADD COLUMN "sections" JSONB NOT NULL DEFAULT '[]';
