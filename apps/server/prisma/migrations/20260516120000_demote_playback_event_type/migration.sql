-- Demote PlaybackEventType enum to plain TEXT.
--
-- Phase-1 player reliability (2026-05-16) adds 10 new event types for
-- lockscreen / wake-lock / visibility / stall / PWA-install telemetry.
-- Demoting the column means future event types ship as code-only deploys —
-- the allow-list lives at the Zod boundary in apps/server/src/routes/events.ts.
-- Same pattern as Store.tier.

ALTER TABLE "playback_events"
  ALTER COLUMN "event_type" TYPE TEXT
  USING "event_type"::text;

DROP TYPE "PlaybackEventType";
