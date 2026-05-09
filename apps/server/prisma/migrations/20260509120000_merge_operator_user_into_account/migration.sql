-- Merge Operator + User into a single Account table. The same row now
-- authenticates either surface — admin/Dash (Bearer JWT, /auth/*) or the
-- customer dashboard (cookie session, /login/*). Junction tables and
-- PlaybackEvent.operator_id repointed to account_id.
--
-- One transaction, atomic. UUIDs preserved on the operator side and on
-- non-collision user rows; the email-collision case (1 row in current
-- prod — Daniel) merges into the operator-derived row and remaps the
-- old user_id everywhere it was referenced.
--
-- All currently-issued tokens (Bearer JWTs, session cookies) become
-- invalid because we bump every Account.token_version to 1 in the
-- backfill — accounts with passwords (operators) need to log in again
-- via /auth/login, and accounts with sessions (dashboard users) need to
-- request a new magic link. Acceptable at current user scale (3 + 6).

BEGIN;

-- 1. Create the unified accounts table.
CREATE TABLE "accounts" (
    "id"                       UUID         PRIMARY KEY,
    "email"                    CITEXT       NOT NULL UNIQUE,
    "name"                     TEXT,
    "password_hash"            TEXT,
    "google_sub"               TEXT         UNIQUE,
    "is_admin"                 BOOLEAN      NOT NULL DEFAULT false,
    "lifecycle_emails_opt_out" BOOLEAN      NOT NULL DEFAULT false,
    "disabled_at"              TIMESTAMPTZ(6),
    "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"               UUID,
    "password_set_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at"            TIMESTAMPTZ(6),
    "token_version"            INT          NOT NULL DEFAULT 0
);
CREATE INDEX "accounts_disabled_at_idx" ON "accounts"("disabled_at") WHERE "disabled_at" IS NULL;

-- 2. Backfill from operators (preserve UUIDs). Bump token_version so any
-- currently-issued JWTs fail validation under the new code.
INSERT INTO "accounts" (
    id, email, name, password_hash, is_admin, disabled_at, created_at,
    created_by, password_set_at, token_version
)
SELECT
    id, email, display_name, password_hash, is_admin, disabled_at, created_at,
    created_by, password_set_at, token_version + 1
FROM operators;

-- 3. Backfill from users.
-- 3a. Non-collision users: insert as new accounts with their own UUID.
INSERT INTO "accounts" (
    id, email, name, google_sub, lifecycle_emails_opt_out,
    disabled_at, created_at, last_login_at, token_version
)
SELECT
    u.id, u.email, u.name, u.google_sub, u.lifecycle_emails_opt_out,
    u.disabled_at, u.created_at, u.last_login_at, u.token_version + 1
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM operators o WHERE LOWER(o.email::text) = LOWER(u.email::text)
);

-- 3b. Collision users: UPDATE the existing operator-derived account with
-- user-side fields. Field precedence: keep operator's (name|isAdmin|password*),
-- take user's (googleSub|lifecycleEmailsOptOut|lastLoginAt); pick max
-- token_version + 1 (so both prior tokens fail); pick the more-recent
-- disabled_at if either is set.
UPDATE "accounts" a
SET
    name                      = COALESCE(a.name, u.name),
    google_sub                = u.google_sub,
    lifecycle_emails_opt_out  = u.lifecycle_emails_opt_out,
    last_login_at             = u.last_login_at,
    token_version             = GREATEST(a.token_version, u.token_version + 1),
    disabled_at               = COALESCE(GREATEST(a.disabled_at, u.disabled_at), a.disabled_at, u.disabled_at)
FROM users u
WHERE LOWER(a.email::text) = LOWER(u.email::text);

-- 4. Build a mapping from old user_id → new account_id for FK rewrites.
-- For non-collision users this is identity; for collision users it points to
-- the operator-derived account UUID.
CREATE TEMP TABLE user_id_map (
    user_id    UUID PRIMARY KEY,
    account_id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO user_id_map (user_id, account_id)
SELECT u.id, a.id
FROM users u
JOIN accounts a ON LOWER(a.email::text) = LOWER(u.email::text);

-- 5. Now wire up the self-ref FK on accounts.
ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. client_memberships: rename user_id → account_id and rewire FK.
ALTER TABLE "client_memberships" ADD COLUMN "account_id" UUID;
UPDATE "client_memberships" cm
SET account_id = m.account_id
FROM user_id_map m
WHERE cm.user_id = m.user_id;
ALTER TABLE "client_memberships" ALTER COLUMN "account_id" SET NOT NULL;

ALTER TABLE "client_memberships" DROP CONSTRAINT IF EXISTS "client_memberships_user_id_fkey";
ALTER TABLE "client_memberships" DROP CONSTRAINT IF EXISTS "client_memberships_client_id_user_id_key";
DROP INDEX IF EXISTS "client_memberships_user_id_idx";
ALTER TABLE "client_memberships" DROP COLUMN "user_id";

ALTER TABLE "client_memberships"
    ADD CONSTRAINT "client_memberships_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_memberships"
    ADD CONSTRAINT "client_memberships_client_id_account_id_key"
    UNIQUE ("client_id", "account_id");
CREATE INDEX "client_memberships_account_id_idx" ON "client_memberships"("account_id");

-- 7. lifecycle_email_logs: rename user_id → account_id and rewire FK.
ALTER TABLE "lifecycle_email_logs" ADD COLUMN "account_id" UUID;
UPDATE "lifecycle_email_logs" lel
SET account_id = m.account_id
FROM user_id_map m
WHERE lel.user_id = m.user_id;
ALTER TABLE "lifecycle_email_logs" ALTER COLUMN "account_id" SET NOT NULL;

ALTER TABLE "lifecycle_email_logs" DROP CONSTRAINT IF EXISTS "lifecycle_email_logs_user_id_fkey";
ALTER TABLE "lifecycle_email_logs" DROP CONSTRAINT IF EXISTS "lifecycle_email_logs_user_id_template_name_context_key_key";
DROP INDEX IF EXISTS "lifecycle_email_logs_user_id_idx";
ALTER TABLE "lifecycle_email_logs" DROP COLUMN "user_id";

ALTER TABLE "lifecycle_email_logs"
    ADD CONSTRAINT "lifecycle_email_logs_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lifecycle_email_logs"
    ADD CONSTRAINT "lifecycle_email_logs_account_id_template_name_context_key_key"
    UNIQUE ("account_id", "template_name", "context_key");
CREATE INDEX "lifecycle_email_logs_account_id_idx" ON "lifecycle_email_logs"("account_id");

-- 8. playback_events.operator_id → account_id. Operator UUIDs are preserved
-- in accounts so a straight RENAME suffices (no remap needed).
ALTER TABLE "playback_events" DROP CONSTRAINT IF EXISTS "playback_events_operator_id_fkey";
ALTER TABLE "playback_events" RENAME COLUMN "operator_id" TO "account_id";
ALTER TABLE "playback_events"
    ADD CONSTRAINT "playback_events_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

-- 9. operator_store_assignments → store_assignments. Operator UUIDs preserved.
ALTER TABLE "operator_store_assignments" DROP CONSTRAINT IF EXISTS "operator_store_assignments_operator_id_fkey";
ALTER TABLE "operator_store_assignments" DROP CONSTRAINT IF EXISTS "operator_store_assignments_assigned_by_fkey";
ALTER TABLE "operator_store_assignments" DROP CONSTRAINT IF EXISTS "operator_store_assignments_store_id_fkey";

ALTER TABLE "operator_store_assignments" RENAME COLUMN "operator_id" TO "account_id";
ALTER TABLE "operator_store_assignments" RENAME TO "store_assignments";

-- The old composite PK was (operator_id, store_id); rename it.
ALTER TABLE "store_assignments" DROP CONSTRAINT IF EXISTS "operator_store_assignments_pkey";
ALTER TABLE "store_assignments"
    ADD CONSTRAINT "store_assignments_pkey" PRIMARY KEY ("account_id", "store_id");

-- Rebuild the per-store lookup index under the new table name.
DROP INDEX IF EXISTS "operator_store_assignments_store_id_idx";
CREATE INDEX "store_assignments_store_id_idx" ON "store_assignments"("store_id");

ALTER TABLE "store_assignments"
    ADD CONSTRAINT "store_assignments_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_assignments"
    ADD CONSTRAINT "store_assignments_assigned_by_fkey"
    FOREIGN KEY ("assigned_by") REFERENCES "accounts"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "store_assignments"
    ADD CONSTRAINT "store_assignments_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 10. operator_password_reset_tokens → password_reset_tokens.
ALTER TABLE "operator_password_reset_tokens" DROP CONSTRAINT IF EXISTS "operator_password_reset_tokens_operator_id_fkey";
ALTER TABLE "operator_password_reset_tokens" RENAME COLUMN "operator_id" TO "account_id";
ALTER TABLE "operator_password_reset_tokens" RENAME TO "password_reset_tokens";

ALTER TABLE "password_reset_tokens" DROP CONSTRAINT IF EXISTS "operator_password_reset_tokens_pkey";
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id");

ALTER TABLE "password_reset_tokens" DROP CONSTRAINT IF EXISTS "operator_password_reset_tokens_token_hash_key";
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_token_hash_key" UNIQUE ("token_hash");

DROP INDEX IF EXISTS "operator_password_reset_tokens_operator_id_idx";
DROP INDEX IF EXISTS "operator_password_reset_tokens_expires_at_idx";
CREATE INDEX "password_reset_tokens_account_id_idx" ON "password_reset_tokens"("account_id");
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 11. Drop the now-empty source tables. Operator self-ref FK was already
-- replaced by accounts.created_by → accounts.id in step 5.
DROP TABLE "operators";
DROP TABLE "users";

COMMIT;
