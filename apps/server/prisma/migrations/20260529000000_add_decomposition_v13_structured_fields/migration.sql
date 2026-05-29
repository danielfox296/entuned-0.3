-- Decomposition v13 — structured fields.
--
-- The v13 decomposer emits discrete, machine-consumable columns instead of having
-- Mars/Bernie mine prose at read time. An audit (2026-05-28) found ~5 tokens of a
-- ~250-word decomposition actually reached Suno; the rest was generated, stored, fed
-- to Mars as context, and discarded. v13 commits to a clean genre anchor, splits the
-- fused harmonic_and_groove into two axes, and lifts vocal register/gender out of the
-- vocal_character prose.
--
-- Legacy prose columns (vibe_pitch, era_production_signature, vocal_arrangement,
-- harmonic_and_groove) are RETAINED for pre-v13 rows. No data backfill is run: old rows
-- keep their prose columns and null these; v13 rows populate these and null the prose.
-- Consumers read through normalizeStyleAnalysis() (apps/server/src/lib/eno/eno.ts), which
-- fills the legacy field names from these columns when the legacy fields are null. Tracks
-- gain these columns on next decompose ("lazy backfill on re-decompose").
--
-- All additive + nullable: safe online migration, no locks of consequence, no data loss.

ALTER TABLE "style_analyses"
  ADD COLUMN "genre_anchor" TEXT,
  ADD COLUMN "harmonic_character" TEXT,
  ADD COLUMN "groove_character" TEXT,
  ADD COLUMN "vocal_register" TEXT,
  ADD COLUMN "vocal_gender" TEXT;
