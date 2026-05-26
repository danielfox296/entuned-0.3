-- Vocal descriptors — third steering direction on GenreGravityRule.
--
-- positivePalettes pushes the song's HARMONY toward genre-authentic vocabulary.
-- vocalDescriptors pushes the song's VOCAL PERFORMANCE toward genre-authentic
-- delivery. Same shape, same Mars-layer deterministic injection: pick one
-- randomly from the matched rule's array, append to positive style.
--
-- Replaces Music Professor module 4's role (LLM-mediated performance descriptor
-- enrichment, which fired ~3 of 8 seeds in testing). Deterministic now;
-- module 4 stays for belt-and-suspenders.
--
-- SongSeed.vocal_descriptor captures the picked token for audit.

ALTER TABLE "genre_gravity_rules"
  ADD COLUMN "vocal_descriptors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "song_seeds"
  ADD COLUMN "vocal_descriptor" TEXT;
