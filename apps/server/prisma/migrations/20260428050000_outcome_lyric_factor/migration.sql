-- CreateTable
CREATE TABLE "outcome_lyric_factors" (
    "outcome_key" UUID NOT NULL,
    "template_text" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "outcome_lyric_factors_pkey" PRIMARY KEY ("outcome_key")
);
