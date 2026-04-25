-- CreateTable
CREATE TABLE "outcome_prepend_templates" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "template_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "outcome_prepend_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eno_runs" (
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "requested_n" INTEGER NOT NULL,
    "produced_n" INTEGER,
    "reason" TEXT,
    "triggered_by" TEXT NOT NULL,
    "triggered_by_user" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "eno_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "eno_run_id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "hook_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "reference_track_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'assembling',
    "style" TEXT,
    "style_portion_raw" TEXT,
    "negative_style" TEXT,
    "vocal_gender" TEXT,
    "lyrics" TEXT,
    "title" TEXT,
    "outcome_prepend_template_version" INTEGER,
    "mars_prompt_version" INTEGER,
    "bernie_draft_prompt_version" INTEGER,
    "bernie_edit_prompt_version" INTEGER,
    "fired_failure_rule_ids" UUID[],
    "error_text" TEXT,
    "claimed_by" UUID,
    "claimed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "terminal_at" TIMESTAMPTZ(6),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outcome_prepend_templates_version_key" ON "outcome_prepend_templates"("version");

-- CreateIndex
CREATE INDEX "eno_runs_icp_id_started_at_idx" ON "eno_runs"("icp_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "submissions_eno_run_id_idx" ON "submissions"("eno_run_id");

-- CreateIndex
CREATE INDEX "submissions_status_idx" ON "submissions"("status");

-- CreateIndex
CREATE INDEX "submissions_icp_id_status_idx" ON "submissions"("icp_id", "status");

-- CreateIndex
CREATE INDEX "submissions_hook_id_idx" ON "submissions"("hook_id");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_eno_run_id_fkey" FOREIGN KEY ("eno_run_id") REFERENCES "eno_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "hooks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reference_track_id_fkey" FOREIGN KEY ("reference_track_id") REFERENCES "reference_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_rows" ADD CONSTRAINT "lineage_rows_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique: enforce "each hook produces at most one accepted Submission" (Card 14).
CREATE UNIQUE INDEX "uniq_submission_hook_accepted" ON "submissions"("hook_id") WHERE "status" = 'accepted';
