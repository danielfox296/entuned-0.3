-- CreateTable
CREATE TABLE "style_templates" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "template_text" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "style_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failure_rules" (
    "id" UUID NOT NULL,
    "trigger_field" TEXT NOT NULL,
    "trigger_value" TEXT NOT NULL,
    "exclude" TEXT NOT NULL,
    "override_field" TEXT,
    "override_pattern" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failure_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "style_templates_version_key" ON "style_templates"("version");

-- CreateIndex
CREATE INDEX "failure_rules_trigger_field_idx" ON "failure_rules"("trigger_field");
