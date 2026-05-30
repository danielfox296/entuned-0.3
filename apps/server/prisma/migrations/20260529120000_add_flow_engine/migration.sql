-- Multi-engine generation: add the Google Flow (Lyria) pathway alongside Suno.
--
-- An `engine` discriminator routes a seed/batch/song through either the Suno
-- rendering tail (Mars compression + bracket-tag lyrics) or the Flow tail (full-
-- decomposition prose + a timestamped timeline). All columns are additive and
-- default to 'suno', so every existing row reads as a Suno seed — no backfill.
--
-- Two DB-backed, Dash-editable tables hold the Flow rule/prompt TEXT (per the
-- "no prompt content in code" doctrine): the renderer persona and the timeline
-- policy. Both are versioned, latest-wins, cold-seeded at runtime.

ALTER TABLE "song_seeds"
  ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'suno',
  ADD COLUMN "flow_renderer_persona_version" INTEGER,
  ADD COLUMN "flow_timeline_policy_version" INTEGER;

ALTER TABLE "song_seed_batches"
  ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'suno';

ALTER TABLE "songs"
  ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'suno';

CREATE TABLE "flow_renderer_personas" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "flow_renderer_personas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "flow_renderer_personas_version_key" ON "flow_renderer_personas"("version");

CREATE TABLE "flow_timeline_policies" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "flow_timeline_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "flow_timeline_policies_version_key" ON "flow_timeline_policies"("version");
