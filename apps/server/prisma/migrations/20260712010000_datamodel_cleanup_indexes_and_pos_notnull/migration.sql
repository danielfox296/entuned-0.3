-- Data-model cleanup (audit 2026-07-11, DAT-5 + DAT-6).
--
-- DAT-5: the daily crons (comp-expiry, pause-auto-resume) seq-scan `stores`
-- on `comp_expires_at` / `paused_until`, which had no index. Add both.
-- Low cardinality today, so this is preventive — the scan grows with the table.
--
-- DAT-6: `pos_events.pos_external_id` was nullable, but it is the second half
-- of the (pos_provider, pos_external_id) unique index that dedups re-pulled
-- transactions. Postgres treats NULLs as distinct, so null-id events slipped
-- past the constraint. The ingest route now always supplies a value (the
-- provider's id, or a synthetic `<runId>:<index>` key), so tighten the column
-- to NOT NULL to match the schema SSOT (21-pos-ingestion.md). Safe: the table
-- is empty in production (verified 0 rows on 2026-07-12).

-- DAT-5
CREATE INDEX "stores_comp_expires_at_idx" ON "stores"("comp_expires_at");
CREATE INDEX "stores_paused_until_idx" ON "stores"("paused_until");

-- DAT-6
ALTER TABLE "pos_events" ALTER COLUMN "pos_external_id" SET NOT NULL;
