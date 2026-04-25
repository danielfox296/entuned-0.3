-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "Bucket" AS ENUM ('FormationEra', 'Subculture', 'Aspirational');

-- CreateEnum
CREATE TYPE "AudioEventType" AS ENUM ('song_start', 'song_complete', 'song_skip', 'song_report', 'song_love', 'outcome_override', 'outcome_override_cleared', 'playback_starved', 'operator_login', 'operator_logout');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('Not our Vibe', 'Boring', 'Awkward Lyrics', 'Too Slow', 'Too Intense', 'Song Audio Issues');

-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "password_set_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_store_assignments" (
    "operator_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID NOT NULL,

    CONSTRAINT "operator_store_assignments_pkey" PRIMARY KEY ("operator_id","store_id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" CITEXT,
    "contact_phone" TEXT,
    "plan" TEXT NOT NULL,
    "pos_provider" TEXT,
    "pos_credentials" JSONB,
    "brand_lyric_guidelines" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "go_live_date" DATE,
    "pos_location_id" TEXT,
    "default_outcome_id" UUID,
    "manual_override_outcome_id" UUID,
    "manual_override_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icps" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "age_range" TEXT,
    "location" TEXT,
    "political_spectrum" TEXT,
    "openness" TEXT,
    "fears" TEXT,
    "values" TEXT,
    "desires" TEXT,
    "unexpressed_desires" TEXT,
    "turn_offs" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "icps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcomes" (
    "id" UUID NOT NULL,
    "outcome_key" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "tempo_bpm" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "dynamics" TEXT,
    "instrumentation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "superseded_at" TIMESTAMPTZ(6),

    CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_rows" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "outcome_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schedule_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hooks" (
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "songs" (
    "id" UUID NOT NULL,
    "r2_url" TEXT NOT NULL,
    "r2_object_key" TEXT NOT NULL,
    "byte_size" BIGINT,
    "content_type" TEXT,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineage_rows" (
    "id" UUID NOT NULL,
    "song_id" UUID NOT NULL,
    "r2_url" TEXT NOT NULL,
    "icp_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "hook_id" UUID NOT NULL,
    "submission_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lineage_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_rules" (
    "id" UUID NOT NULL,
    "sibling_spacing_minutes" INTEGER NOT NULL DEFAULT 240,
    "no_repeat_window_minutes" INTEGER NOT NULL DEFAULT 45,
    "daily_cap" INTEGER NOT NULL DEFAULT 3,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "rotation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_events" (
    "id" UUID NOT NULL,
    "event_type" "AudioEventType" NOT NULL,
    "store_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator_id" UUID,
    "song_id" UUID,
    "hook_id" UUID,
    "report_reason" "ReportReason",
    "outcome_id" UUID,
    "extra" JSONB,

    CONSTRAINT "audio_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");

-- CreateIndex
CREATE INDEX "operator_store_assignments_store_id_idx" ON "operator_store_assignments"("store_id");

-- CreateIndex
CREATE INDEX "clients_company_name_idx" ON "clients"("company_name");

-- CreateIndex
CREATE INDEX "stores_client_id_idx" ON "stores"("client_id");

-- CreateIndex
CREATE INDEX "stores_icp_id_idx" ON "stores"("icp_id");

-- CreateIndex
CREATE INDEX "icps_client_id_idx" ON "icps"("client_id");

-- CreateIndex
CREATE INDEX "outcomes_outcome_key_version_idx" ON "outcomes"("outcome_key", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "outcomes_outcome_key_version_key" ON "outcomes"("outcome_key", "version");

-- CreateIndex
CREATE INDEX "schedule_rows_store_id_day_of_week_idx" ON "schedule_rows"("store_id", "day_of_week");

-- CreateIndex
CREATE INDEX "hooks_icp_id_status_idx" ON "hooks"("icp_id", "status");

-- CreateIndex
CREATE INDEX "hooks_outcome_id_idx" ON "hooks"("outcome_id");

-- CreateIndex
CREATE UNIQUE INDEX "songs_r2_url_key" ON "songs"("r2_url");

-- CreateIndex
CREATE UNIQUE INDEX "songs_r2_object_key_key" ON "songs"("r2_object_key");

-- CreateIndex
CREATE INDEX "lineage_rows_icp_id_outcome_id_active_idx" ON "lineage_rows"("icp_id", "outcome_id", "active");

-- CreateIndex
CREATE INDEX "lineage_rows_hook_id_idx" ON "lineage_rows"("hook_id");

-- CreateIndex
CREATE INDEX "lineage_rows_song_id_idx" ON "lineage_rows"("song_id");

-- CreateIndex
CREATE INDEX "audio_events_store_id_song_id_occurred_at_idx" ON "audio_events"("store_id", "song_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audio_events_store_id_hook_id_occurred_at_idx" ON "audio_events"("store_id", "hook_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audio_events_store_id_occurred_at_idx" ON "audio_events"("store_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audio_events_store_id_event_type_occurred_at_idx" ON "audio_events"("store_id", "event_type", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "operators" ADD CONSTRAINT "operators_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_store_assignments" ADD CONSTRAINT "operator_store_assignments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_store_assignments" ADD CONSTRAINT "operator_store_assignments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_store_assignments" ADD CONSTRAINT "operator_store_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_icp_id_fkey" FOREIGN KEY ("icp_id") REFERENCES "icps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_default_outcome_id_fkey" FOREIGN KEY ("default_outcome_id") REFERENCES "outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_manual_override_outcome_id_fkey" FOREIGN KEY ("manual_override_outcome_id") REFERENCES "outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icps" ADD CONSTRAINT "icps_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_rows" ADD CONSTRAINT "schedule_rows_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_rows" ADD CONSTRAINT "schedule_rows_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_icp_id_fkey" FOREIGN KEY ("icp_id") REFERENCES "icps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_rows" ADD CONSTRAINT "lineage_rows_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_rows" ADD CONSTRAINT "lineage_rows_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_rows" ADD CONSTRAINT "lineage_rows_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "hooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_events" ADD CONSTRAINT "audio_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_events" ADD CONSTRAINT "audio_events_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_events" ADD CONSTRAINT "audio_events_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
