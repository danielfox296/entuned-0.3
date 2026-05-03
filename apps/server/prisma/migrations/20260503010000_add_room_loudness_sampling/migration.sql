-- Room loudness sampling: per-store opt-in flag + new audio event type.
-- Default OFF. Toggled from Dash. Player only requests mic when true.

ALTER TYPE "PlaybackEventType" ADD VALUE 'room_loudness_sample';

ALTER TABLE "stores"
  ADD COLUMN "room_loudness_sampling_enabled" BOOLEAN NOT NULL DEFAULT false;
