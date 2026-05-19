-- Morning Command Center — unified action queue + content bank (2026-05-19).
--
-- Adds four tables backing the agentic growth subsystems (signal scanner,
-- outreach queue, content multiplier, SEO pipeline, trigger monitor,
-- nurture drip, community log, social proof factory). All consumed by
-- the Command Center panel in Dash (apps/admin).
--
-- SSOT: ../../../../entune v0.3/schema/command-center.md
-- Spec: ../../../../morning-command-center-spec.md

CREATE TABLE "queue_items" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "type"          TEXT         NOT NULL,
    "subtype"       TEXT,
    "status"        TEXT         NOT NULL DEFAULT 'pending',
    "priority"      INTEGER      NOT NULL DEFAULT 0,
    "title"         TEXT         NOT NULL,
    "draft_content" TEXT,
    "source_url"    TEXT,
    "payload"       JSONB,
    "external_id"   TEXT,
    "snoozed_until" TIMESTAMPTZ(6),
    "acted_at"      TIMESTAMPTZ(6),
    "acted_action"  TEXT,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"    TIMESTAMPTZ(6),

    CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "queue_items_external_id_key" ON "queue_items"("external_id");
CREATE INDEX "queue_items_status_type_created_at_idx" ON "queue_items"("status", "type", "created_at" DESC);
CREATE INDEX "queue_items_type_status_idx" ON "queue_items"("type", "status");
CREATE INDEX "queue_items_status_snoozed_until_idx" ON "queue_items"("status", "snoozed_until");

CREATE TABLE "daily_digests" (
    "id"             UUID    NOT NULL DEFAULT gen_random_uuid(),
    "date"           DATE    NOT NULL,
    "signal_count"   INTEGER NOT NULL DEFAULT 0,
    "outreach_count" INTEGER NOT NULL DEFAULT 0,
    "content_count"  INTEGER NOT NULL DEFAULT 0,
    "trigger_count"  INTEGER NOT NULL DEFAULT 0,
    "free_signups"   INTEGER NOT NULL DEFAULT 0,
    "paid_users"     INTEGER NOT NULL DEFAULT 0,
    "mrr"            INTEGER NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_digests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_digests_date_key" ON "daily_digests"("date");

CREATE TABLE "proof_points" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "label"       TEXT NOT NULL,
    "quote_text"  TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "context"     TEXT,
    "category"    TEXT NOT NULL,
    "event_date"  DATE,
    "tags"        TEXT[] NOT NULL DEFAULT '{}',
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proof_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_pieces" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "proof_point_id" UUID,
    "narrative"      TEXT NOT NULL,
    "format"         TEXT NOT NULL,
    "title"          TEXT,
    "body"           TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'draft',
    "published_at"   TIMESTAMPTZ(6),
    "published_url"  TEXT,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_pieces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "content_pieces_proof_point_id_fkey" FOREIGN KEY ("proof_point_id") REFERENCES "proof_points"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "content_pieces_narrative_format_status_idx" ON "content_pieces"("narrative", "format", "status");
CREATE INDEX "content_pieces_status_idx" ON "content_pieces"("status");
