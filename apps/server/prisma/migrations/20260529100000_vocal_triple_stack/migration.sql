-- Vocal triple-stack — expand GenreGravityRule from a single flat vocalDescriptors
-- array to three component arrays (character + delivery + effect). At assembly time,
-- Mars picks one from each and composes them into a vocal identity string placed
-- BEFORE the genre anchor in the style portion, where Suno reads it hardest.
--
-- The existing vocalDescriptors column is preserved for backward compatibility.
-- If new arrays are populated, the triple-stack is used; otherwise falls back to
-- the flat vocalDescriptors pool.
--
-- SongSeed.vocal_identity captures the composed triple-stack for audit.

ALTER TABLE "genre_gravity_rules"
  ADD COLUMN "vocal_characters" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "vocal_deliveries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "vocal_effects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "song_seeds"
  ADD COLUMN "vocal_identity" TEXT;
