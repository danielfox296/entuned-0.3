-- Idempotency ledger for the Stripe webhook (audit fix SRV-1).
--
-- Stripe delivers each event at-least-once and retries any non-2xx delivery.
-- The webhook inserts one row here keyed on the Stripe `event.id` BEFORE
-- dispatching the handler (insert-first-or-skip): a duplicate insert trips the
-- primary key and is treated as "already processed → ack 200". If the handler
-- then fails, the row is deleted so Stripe's retry re-processes instead of
-- being skipped as a duplicate.
--
-- The primary key IS the guard — the natural key is the Stripe event id, so no
-- surrogate id and no separate unique index are needed.

CREATE TABLE "processed_stripe_events" (
    "id"           TEXT NOT NULL,
    "type"         TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_stripe_events_pkey" PRIMARY KEY ("id")
);
