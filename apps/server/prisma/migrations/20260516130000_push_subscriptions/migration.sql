-- Web Push subscriptions. iOS 16.4+ requires installed PWA; Android works in
-- either mode. Endpoint is device-specific and globally unique.

CREATE TABLE "push_subscriptions" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"       UUID NOT NULL,
  "account_id"     UUID,
  "endpoint"       TEXT NOT NULL,
  "p256dh_key"     TEXT NOT NULL,
  "auth_key"       TEXT NOT NULL,
  "user_agent"     TEXT,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_nudged_at" TIMESTAMPTZ(6),

  CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint"),
  CONSTRAINT "push_subscriptions_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
  CONSTRAINT "push_subscriptions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL
);

CREATE INDEX "push_subscriptions_store_id_idx" ON "push_subscriptions"("store_id");
