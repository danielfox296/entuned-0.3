-- Card 23 Stations — the free tier's music choice.
--
-- A Station is a named shared song pool: it owns exactly one ICP under the
-- Free Tier Client, and its pool IS that ICP's LineageRow set. Playback reuses
-- the existing StoreICP -> ICP -> LineageRow path; there is no new pool
-- mechanism and no LineageRow.station_id.
--
-- SSOT: ../../../../entune v0.3/schema/23-stations.md
--
-- Steps:
--   1. stations table.
--   2. stores.station_id (nullable FK).
--   3. playback_rules station anti-repeat knobs.
--   4. Seed the six launch stations + one ICP each under FREE_TIER_CLIENT_ID.

-- 1. stations -------------------------------------------------------------

CREATE TABLE "stations" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "station_key"    TEXT           NOT NULL,
  "display_name"   TEXT           NOT NULL,
  "subtitle"       TEXT,
  "genre_steering" TEXT           NOT NULL,
  "sort_order"     INTEGER        NOT NULL DEFAULT 0,
  "active"         BOOLEAN        NOT NULL DEFAULT TRUE,
  "icp_id"         UUID           NOT NULL,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "stations_station_key_key" ON "stations" ("station_key");
-- One ICP per station, one station per ICP. Load-bearing: without it two
-- stations could silently share a pool and "switching" would be a no-op.
CREATE UNIQUE INDEX "stations_icp_id_key" ON "stations" ("icp_id");
CREATE INDEX "stations_active_sort_order_idx" ON "stations" ("active", "sort_order");

-- RESTRICT, not CASCADE: retiring a station's audience out from under it
-- should fail loudly rather than orphan the station.
ALTER TABLE "stations"
  ADD CONSTRAINT "stations_icp_id_fkey"
  FOREIGN KEY ("icp_id") REFERENCES "icps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. stores.station_id ----------------------------------------------------

ALTER TABLE "stores" ADD COLUMN "station_id" UUID;

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. playback_rules station anti-repeat -----------------------------------
--
-- window = clamp(pool_size * 3min * coverage, min, max). Applies to
-- station-scoped requests only; the flat no_repeat_window_minutes still
-- governs paid stores and free stores with no station.

ALTER TABLE "playback_rules"
  ADD COLUMN "station_no_repeat_coverage"    DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  ADD COLUMN "station_no_repeat_min_minutes" INTEGER          NOT NULL DEFAULT 45,
  ADD COLUMN "station_no_repeat_max_minutes" INTEGER          NOT NULL DEFAULT 480;

-- 4. Seed the six launch stations -----------------------------------------
--
-- Fixed sentinel ids in the 00000000-0000-0000-0000-... space, same convention
-- as FREE_TIER_ICP_ID. ICPs ...0101-...0106, stations ...0201-...0206.
-- Mirrored in apps/server/src/lib/stations.ts as LAUNCH_STATIONS.

INSERT INTO "icps" ("id", "client_id", "name", "created_at", "updated_at")
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Solo Piano',                now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Lofi Beats',                now(), now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'Classic Soul Instrumental', now(), now()),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'Bossa Nova',                now(), now()),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'Western Instrumental',      now(), now()),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000001', 'Jazz Trio',                 now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "stations" ("id", "station_key", "display_name", "subtitle", "genre_steering", "sort_order", "active", "icp_id")
VALUES
  ('00000000-0000-0000-0000-000000000201', 'solo-piano', 'Solo Piano',
   'Unhurried keys, nothing in the way',
   'solo acoustic piano, close-mic''d upright and grand, unhurried rubato phrasing, sustain-pedal bloom, no drums, no bass',
   1, true, '00000000-0000-0000-0000-000000000101'),

  ('00000000-0000-0000-0000-000000000202', 'lofi-beats', 'Lofi Beats',
   'Warm, dusty, easy to stay in',
   'lofi hip-hop, dusty sampled keys, soft swung drums, filtered upright bass, tape hiss and vinyl crackle, mellow and unhurried',
   2, true, '00000000-0000-0000-0000-000000000102'),

  ('00000000-0000-0000-0000-000000000203', 'classic-soul-instrumental', 'Classic Soul Instrumental',
   'Vintage warmth without the vocal',
   '1960s-70s soul instrumental, Rhodes and Hammond organ, tight pocket rhythm section, muted horn stabs, tape saturation, no lead vocal',
   3, true, '00000000-0000-0000-0000-000000000103'),

  ('00000000-0000-0000-0000-000000000204', 'bossa-nova', 'Bossa Nova',
   'Brazilian ease, gently forward',
   'bossa nova, nylon-string guitar with syncopated comping, brushed drums, light Rhodes, upright bass, relaxed 1960s Rio feel',
   4, true, '00000000-0000-0000-0000-000000000104'),

  ('00000000-0000-0000-0000-000000000205', 'western-instrumental', 'Western Instrumental',
   'Wide-open, dust and reverb',
   'Western instrumental, twangy baritone guitar, spring reverb and tremolo, brushed drums, wide desert space, slow-burn phrasing',
   5, true, '00000000-0000-0000-0000-000000000105'),

  ('00000000-0000-0000-0000-000000000206', 'jazz-trio', 'Jazz Trio',
   'Piano, bass, brushes',
   'acoustic jazz trio, piano with upright bass and brushed drums, mid-century club feel, relaxed swing, understated comping',
   6, true, '00000000-0000-0000-0000-000000000106')
ON CONFLICT ("id") DO NOTHING;
