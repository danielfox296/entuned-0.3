-- Re-point station subtitles from sound description to store targeting.
--
-- Naming principle (Daniel, 2026-08-06): the NAME says what it sounds like,
-- the SUBTITLE says whose store it is for. Goal is selection in five seconds
-- without a preview — and there is no preview in the picker, by design
-- (see 23-stations.md, "Station artwork").
--
-- The seed in 20260806120000_add_stations described the sound instead, which
-- the name already does. Every one of the six restated its own name
-- ('Jazz Trio' -> 'Piano, bass, brushes') and none of them told an operator
-- whether the station was for their floor.
--
-- Copy approved by Daniel 2026-08-06, verbatim from his brief.
-- /terminology-check clean against the VOICE.md ban list.
--
-- This is DATA, not schema. `stations.subtitle` stays operator-editable; the
-- reason it ships as a migration rather than a hand-run UPDATE is that the
-- 20260806120000 seed is still the source of truth for a fresh DB. Editing
-- prod alone would leave every new environment on the old strings.
--
-- Guarded on display_name so a station an operator has since renamed or
-- reseeded is left alone rather than silently overwritten. Ids are the fixed
-- sentinels from the seed (mirrored in apps/server/src/lib/stations.ts).

UPDATE "stations" SET "subtitle" = 'furniture, home goods, jewelry, craft', "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000201' AND "display_name" = 'Solo Piano';

UPDATE "stations" SET "subtitle" = 'thrift, resale, younger floors', "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000202' AND "display_name" = 'Lofi Beats';

UPDATE "stations" SET "subtitle" = 'thrift, resale, mixed-age floors', "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000203' AND "display_name" = 'Classic Soul Instrumental';

UPDATE "stations" SET "subtitle" = 'home goods, gift, wine', "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000204' AND "display_name" = 'Bossa Nova';

UPDATE "stations" SET "subtitle" = 'farm & ranch, western wear, rural antique', "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000205' AND "display_name" = 'Western Instrumental';

UPDATE "stations" SET "subtitle" = 'bookstores, wine, consignment, galleries', "updated_at" = now()
WHERE "id" = '00000000-0000-0000-0000-000000000206' AND "display_name" = 'Jazz Trio';
