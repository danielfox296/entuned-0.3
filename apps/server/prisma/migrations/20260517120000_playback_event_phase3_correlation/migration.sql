-- Phase-3 playback event schema (2026-05-17).
-- Adds the columns needed to (a) join audio events against POS transactions
-- at a per-session grain, (b) survive offline / lost-packet flushes via
-- idempotency keys, and (c) quarantine unknown event types into a raw table
-- instead of dropping them. See schema/20-audio-event-stream.md for rationale.

ALTER TABLE "playback_events"
  ADD COLUMN "playback_session_id"  UUID,
  ADD COLUMN "device_id"            TEXT,
  ADD COLUMN "play_duration_ms"     INTEGER,
  ADD COLUMN "completion_reason"    TEXT,
  ADD COLUMN "effective_outcome_id" UUID,
  ADD COLUMN "client_sent_at"       TIMESTAMPTZ(6),
  ADD COLUMN "client_build"         TEXT,
  ADD COLUMN "idempotency_key"      TEXT;

ALTER TABLE "playback_events"
  ADD CONSTRAINT "playback_events_effective_outcome_id_fkey"
    FOREIGN KEY ("effective_outcome_id") REFERENCES "outcomes"("id");

-- Session × time index for both the Dash session-grouped view and the
-- POS-correlation time-series join.
CREATE INDEX "playback_events_store_session_occurred_idx"
  ON "playback_events" ("store_id", "playback_session_id", "occurred_at")
  WHERE "playback_session_id" IS NOT NULL;

-- Idempotency dedupe of persistent-buffer retries.
CREATE UNIQUE INDEX "playback_events_idempotency_key_key"
  ON "playback_events" ("idempotency_key");

-- Quarantine table for rejected events.
CREATE TABLE "playback_events_raw" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "raw_json"    JSONB NOT NULL,
  "error_text"  TEXT,
  "store_id"    UUID,
  "event_type"  TEXT
);
CREATE INDEX "playback_events_raw_received_at_idx"
  ON "playback_events_raw" ("received_at" DESC);
CREATE INDEX "playback_events_raw_event_type_received_at_idx"
  ON "playback_events_raw" ("event_type", "received_at" DESC);
