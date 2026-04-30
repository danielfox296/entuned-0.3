-- CreateTable
CREATE TABLE "pos_pull_runs" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "pos_provider" TEXT NOT NULL,
    "pull_window_start" TIMESTAMPTZ(6) NOT NULL,
    "pull_window_end" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'running',
    "events_ingested" INTEGER,
    "unmapped_count" INTEGER,
    "error_text" TEXT,
    "triggered_by" TEXT NOT NULL DEFAULT 'manual',
    "triggered_by_id" UUID,

    CONSTRAINT "pos_pull_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_events" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "pos_provider" TEXT NOT NULL,
    "pos_external_id" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "transaction_value_cents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "item_count" INTEGER NOT NULL,
    "pos_pull_run_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_pull_runs_client_id_started_at_idx" ON "pos_pull_runs"("client_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "pos_pull_runs_client_id_status_idx" ON "pos_pull_runs"("client_id", "status");

-- CreateIndex
CREATE INDEX "pos_pull_runs_store_id_started_at_idx" ON "pos_pull_runs"("store_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "pos_events_store_id_occurred_at_idx" ON "pos_events"("store_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "pos_events_client_id_occurred_at_idx" ON "pos_events"("client_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pos_events_pos_provider_pos_external_id_key" ON "pos_events"("pos_provider", "pos_external_id");

-- AddForeignKey
ALTER TABLE "pos_pull_runs" ADD CONSTRAINT "pos_pull_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_pull_runs" ADD CONSTRAINT "pos_pull_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_events" ADD CONSTRAINT "pos_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_events" ADD CONSTRAINT "pos_events_pos_pull_run_id_fkey" FOREIGN KEY ("pos_pull_run_id") REFERENCES "pos_pull_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
