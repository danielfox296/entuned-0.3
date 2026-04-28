-- Album art URL captured at preview-resolve time. Same lazy-fill cadence
-- as preview_url; populated from the matching provider response.
ALTER TABLE "reference_tracks" ADD COLUMN "cover_url" TEXT;
