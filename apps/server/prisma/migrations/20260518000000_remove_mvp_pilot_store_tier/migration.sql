-- Remove mvp_pilot from Store.tier (PLG-default cleanup, 2026-05-17).
--
-- Production-audited 2026-05-17: zero rows have `stores.tier = 'mvp_pilot'`
-- (active or archived). The value was a legacy seed-tier from before the
-- v1 PLG launch; admin-created Stores now start on the same `free` default
-- as customer-created Stores and are manually upgraded as needed.
--
-- Two concerns intentionally NOT touched:
--   1. `ClientPlan.mvp_pilot` enum value — a different concept (operator
--      lifecycle: mvp_pilot → trial → paid_pilot → production → paused →
--      inactive). 15 active Clients still on it as of 2026-05-17.
--   2. Historical migration SQL files that mention `'mvp_pilot'` —
--      immutable history; never edit.

ALTER TABLE "stores" ALTER COLUMN "tier" SET DEFAULT 'free';
