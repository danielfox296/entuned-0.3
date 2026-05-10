-- Operator-curated allowlist of outcomes available to free-tier stores.
-- Keyed by outcomeKey (durable across Outcome version bumps). Toggle in Dash
-- to gate or temporarily unlock outcomes for free users (PLG friction + promos).

CREATE TABLE "free_tier_outcomes" (
  "outcome_key" uuid           NOT NULL,
  "enabled_at"  timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT "free_tier_outcomes_pkey" PRIMARY KEY ("outcome_key")
);

-- Seed: Linger + Lift Energy. Resolve by display label (robust against future
-- key changes in dev DBs); INSERT ... SELECT picks the canonical key per name.
INSERT INTO "free_tier_outcomes" ("outcome_key")
SELECT DISTINCT outcome_key
FROM outcomes
WHERE COALESCE(display_title, title) IN ('Linger', 'Lift Energy')
ON CONFLICT ("outcome_key") DO NOTHING;
