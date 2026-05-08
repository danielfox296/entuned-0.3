-- Operator password recovery + revocation, User soft-disable + revocation.

-- AlterTable
ALTER TABLE "operators" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "disabled_at" TIMESTAMPTZ(6),
  ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "operator_password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operator_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operator_password_reset_tokens_token_hash_key" ON "operator_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "operator_password_reset_tokens_operator_id_idx" ON "operator_password_reset_tokens"("operator_id");

-- CreateIndex
CREATE INDEX "operator_password_reset_tokens_expires_at_idx" ON "operator_password_reset_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "operator_password_reset_tokens" ADD CONSTRAINT "operator_password_reset_tokens_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
