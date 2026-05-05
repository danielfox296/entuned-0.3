-- AlterTable: User opt-out flag
ALTER TABLE "users" ADD COLUMN "lifecycle_emails_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: editable email templates
CREATE TABLE "email_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "props_example" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lifecycle send idempotency log
CREATE TABLE "lifecycle_email_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "template_name" TEXT NOT NULL,
    "context_key" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lifecycle_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_name_key" ON "email_templates"("name");
CREATE INDEX "lifecycle_email_logs_user_id_idx" ON "lifecycle_email_logs"("user_id");
CREATE UNIQUE INDEX "lifecycle_email_logs_user_id_template_name_context_key_key" ON "lifecycle_email_logs"("user_id", "template_name", "context_key");

-- AddForeignKey
ALTER TABLE "lifecycle_email_logs" ADD CONSTRAINT "lifecycle_email_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
