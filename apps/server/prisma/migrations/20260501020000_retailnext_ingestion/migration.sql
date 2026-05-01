-- CreateTable retailnext_ingest_runs
CREATE TABLE "retailnext_ingest_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "filename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "rows_ingested" INTEGER,
    "error_text" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "triggered_by_id" UUID,

    CONSTRAINT "retailnext_ingest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retailnext_ingest_runs_store_id_started_at_idx" ON "retailnext_ingest_runs"("store_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "retailnext_ingest_runs" ADD CONSTRAINT "retailnext_ingest_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable retailnext_daily_snapshots
CREATE TABLE "retailnext_daily_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "retailnext_store_id" TEXT,
    "traffic" INTEGER,
    "sales_cents" BIGINT,
    "sale_trx_count" INTEGER,
    "return_trx_count" INTEGER,
    "conv_rate" DOUBLE PRECISION,
    "atv" DOUBLE PRECISION,
    "shopper_yield" DOUBLE PRECISION,
    "capture_rate" DOUBLE PRECISION,
    "new_shopper_pct" DOUBLE PRECISION,
    "visit_duration_secs" INTEGER,
    "weather" TEXT,
    "ingest_run_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retailnext_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retailnext_daily_snapshots_store_id_date_key" ON "retailnext_daily_snapshots"("store_id", "date");

-- CreateIndex
CREATE INDEX "retailnext_daily_snapshots_store_id_date_idx" ON "retailnext_daily_snapshots"("store_id", "date" DESC);

-- AddForeignKey
ALTER TABLE "retailnext_daily_snapshots" ADD CONSTRAINT "retailnext_daily_snapshots_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retailnext_daily_snapshots" ADD CONSTRAINT "retailnext_daily_snapshots_ingest_run_id_fkey" FOREIGN KEY ("ingest_run_id") REFERENCES "retailnext_ingest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable retailnext_hourly_snapshots
CREATE TABLE "retailnext_hourly_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "hour_start" INTEGER NOT NULL,
    "traffic" INTEGER,
    "sales_cents" BIGINT,
    "sale_trx_count" INTEGER,
    "return_trx_count" INTEGER,
    "conv_rate" DOUBLE PRECISION,
    "atv" DOUBLE PRECISION,
    "shopper_yield" DOUBLE PRECISION,
    "capture_rate" DOUBLE PRECISION,
    "visit_duration_secs" INTEGER,
    "ingest_run_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retailnext_hourly_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retailnext_hourly_snapshots_store_id_date_hour_start_key" ON "retailnext_hourly_snapshots"("store_id", "date", "hour_start");

-- CreateIndex
CREATE INDEX "retailnext_hourly_snapshots_store_id_date_idx" ON "retailnext_hourly_snapshots"("store_id", "date" DESC);

-- AddForeignKey
ALTER TABLE "retailnext_hourly_snapshots" ADD CONSTRAINT "retailnext_hourly_snapshots_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retailnext_hourly_snapshots" ADD CONSTRAINT "retailnext_hourly_snapshots_ingest_run_id_fkey" FOREIGN KEY ("ingest_run_id") REFERENCES "retailnext_ingest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
