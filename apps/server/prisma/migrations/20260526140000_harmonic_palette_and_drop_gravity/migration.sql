-- Harmonic palette + drop dead gravity column.
--
-- GenreGravityRule gains `positive_palettes` — array of injection-ready style
-- tokens. Mars's new injectHarmonicPalette step picks one at random and
-- appends to positive style when the rule's tag substring-matches the song's
-- anchor / style. Reuses the existing rule infrastructure; same row now
-- carries both negative carving (counter_exclusions) and positive steering
-- (positive_palettes), either independent.
--
-- The `gravity` column is dropped: it was only used to sort the rules in the
-- Music Professor system prompt. It never gated firing, never weighted
-- aggressiveness, and never appeared in the prompt text itself. Dead knob.
--
-- SongSeed gains `harmonic_palette` audit field capturing which palette token
-- (if any) was injected for this seed.

ALTER TABLE "genre_gravity_rules"
  ADD COLUMN "positive_palettes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  DROP COLUMN "gravity";

ALTER TABLE "song_seeds"
  ADD COLUMN "harmonic_palette" TEXT;
