-- CreateTable
CREATE TABLE "reference_tracks" (
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "bucket" "Bucket" NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "verified_by" UUID,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "musicological_rules" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "musicological_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "era_references" (
    "id" UUID NOT NULL,
    "decade" TEXT NOT NULL,
    "genre_slug" TEXT NOT NULL,
    "genre_display_name" TEXT,
    "is_era_overview" BOOLEAN NOT NULL DEFAULT false,
    "prompt_block" TEXT,
    "texture_language" TEXT,
    "exclude_list" TEXT,
    "bpm_range_low" INTEGER,
    "bpm_range_high" INTEGER,
    "bpm_compensation" INTEGER,
    "extension_techniques" TEXT,
    "instruments" TEXT,
    "recording_chain" TEXT,
    "vocals_description" TEXT,
    "suno_drift_notes" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "era_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decompositions" (
    "id" UUID NOT NULL,
    "reference_track_id" UUID NOT NULL,
    "musicological_rules_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,
    "confidence" TEXT,
    "vibe_pitch" TEXT,
    "era_production_signature" TEXT,
    "instrumentation_palette" TEXT,
    "standout_element" TEXT,
    "arrangement_shape" TEXT,
    "dynamic_curve" TEXT,
    "vocal_character" TEXT,
    "vocal_arrangement" TEXT,
    "harmonic_and_groove" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decompositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reference_tracks_icp_id_bucket_idx" ON "reference_tracks"("icp_id", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "musicological_rules_version_key" ON "musicological_rules"("version");

-- CreateIndex
CREATE INDEX "era_references_decade_idx" ON "era_references"("decade");

-- CreateIndex
CREATE UNIQUE INDEX "era_references_decade_genre_slug_key" ON "era_references"("decade", "genre_slug");

-- CreateIndex
CREATE UNIQUE INDEX "decompositions_reference_track_id_key" ON "decompositions"("reference_track_id");

-- CreateIndex
CREATE INDEX "decompositions_status_idx" ON "decompositions"("status");

-- AddForeignKey
ALTER TABLE "reference_tracks" ADD CONSTRAINT "reference_tracks_icp_id_fkey" FOREIGN KEY ("icp_id") REFERENCES "icps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decompositions" ADD CONSTRAINT "decompositions_reference_track_id_fkey" FOREIGN KEY ("reference_track_id") REFERENCES "reference_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decompositions" ADD CONSTRAINT "decompositions_musicological_rules_version_fkey" FOREIGN KEY ("musicological_rules_version") REFERENCES "musicological_rules"("version") ON DELETE RESTRICT ON UPDATE CASCADE;
