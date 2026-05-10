-- Per-store song suppression for free-tier flagged-review.
-- LineageRow.active is global per ICP; free-tier stores share one ICP, so a
-- global retire is too blunt. This table lets an operator retire a single song
-- for one location without affecting other locations on the same shared pool.

CREATE TABLE "store_retired_songs" (
  "store_id"   uuid NOT NULL,
  "song_id"    uuid NOT NULL,
  "reason"     text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT "store_retired_songs_pkey" PRIMARY KEY ("store_id", "song_id"),
  CONSTRAINT "store_retired_songs_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "store_retired_songs_song_id_fkey"
    FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);

CREATE INDEX "store_retired_songs_song_id_idx" ON "store_retired_songs"("song_id");
