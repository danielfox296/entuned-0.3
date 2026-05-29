-- Stager (arranger) policy: operator-tunable chorus-escalation cues + end-of-song
-- outro behavior. Versioned singleton (latest version wins). Seeded at runtime by
-- getOrSeedArrangementPolicy() with the values that were previously hardcoded in
-- arranger.ts, so behavior is unchanged until an operator edits it in Dash.
CREATE TABLE "arrangement_policies" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "arrangement_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "arrangement_policies_version_key" ON "arrangement_policies"("version");
