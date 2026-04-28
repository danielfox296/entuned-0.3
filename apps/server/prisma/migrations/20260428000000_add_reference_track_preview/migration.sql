-- Lazy-resolved 30s preview URL for in-admin playback. Filled on first
-- play-button click. preview_source records which provider (`spotify`,
-- `itunes`, or `none` if neither had it) so we don't keep retrying.
ALTER TABLE "reference_tracks"
  ADD COLUMN "preview_url" TEXT,
  ADD COLUMN "preview_source" TEXT;
