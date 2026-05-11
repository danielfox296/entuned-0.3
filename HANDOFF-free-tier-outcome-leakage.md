# HANDOFF — Free-tier outcome leakage (2026-05-11)

Daniel flagged two related issues. The first was partially fixed in commits today; the second is still broken and is the main reason this handoff exists.

## The rule (single source of truth)

**Free-tier locations may only use outcomes that are in the `FreeTierOutcome` allowlist.** That allowlist is keyed by `outcomeKey` and lives in the `free_tier_outcomes` table. Anywhere an outcome is picked for a free-tier store — default-outcome assignment, schedule slots, generation/playback selection — must filter against this allowlist.

Today only the default-outcome picker enforces the rule. Other paths leak.

## What landed today (already shipped, verify but don't redo)

Commits on `main`: `f72f7eb`, `14b3ac3`.

- `pickSystemDefaultOutcomeId(tier?)` in [apps/server/src/lib/outcomes.ts](apps/server/src/lib/outcomes.ts) picks tier-aware defaults. Free tier: `All Outcomes` → `Add Energy` → `Lift Energy` → first allowlisted alphabetically.
- All four Store-creation paths pass tier: `lib/account.ts ensureFreeClientForUser`, `routes/me.ts` free-Store backstop, `routes/admin.ts` admin create, `routes/billing.ts` (duplicate + fresh checkout).
- Backfill migrations: `20260511010000_default_outcome_for_existing_stores` (global, alphabetical), `20260511020000_default_outcome_free_tier_preference` (free-tier re-point using the preference chain).
- `GET /admin/stores/:id` now returns `tier`. Admin `StoreEditor` (Location settings) filters the default-outcome dropdown to the free-tier allowlist when `tier === 'free'`.
- `PUT /admin/stores/:id` rejects `defaultOutcomeId` outside the allowlist for free-tier stores with `409 outcome_not_in_free_tier_allowlist`.

Migration runs on Railway boot via `prisma migrate deploy` in `railway.json` startCommand.

## What's still broken (the work)

### 1. Free-tier playback selects outside the allowlist
Daniel: "i have 'calm' outcome selected on the free tier and it's playing music. this shouldn't be selectable."

Even after today's fix removes Calm from the default-outcome picker, **somehow Calm is still being chosen for playback on a free-tier store**. The default for the affected store should have been re-pointed by the backfill migration — confirm it actually ran and the store no longer has `default_outcome_id` pointing at Calm. Then trace where the runtime playback actually picks its outcome.

Likely starting points:
- `apps/server/src/lib/hendrix.ts` — the playback selector. Search for outcome resolution.
- `apps/player/` — what does the player send up when asking for a track? Does it know about tier?
- Pool/queue routes that the player calls — `/player/next-queue` or similar; grep for `nextQueue`.

The fix shape: filter the outcome candidate set by the FreeTierOutcome allowlist when the store is free tier. Same allowlist, same join, applied at the selection point.

### 2. Free-tier schedule slots use outside-the-allowlist outcomes
Daniel: "users are also getting scheduling artifacts on the free tier. that shouldn't be."

The Outcome Schedule UI (per-day-of-week outcome slots) lets you assign any outcome to a slot — there's no free-tier filter. Schedule routes:
- `app.get('/admin/stores/:id/schedule'` (~line 2398 in `apps/server/src/routes/admin.ts`)
- `app.post('/admin/stores/:id/schedule'` (~line 2426)

Two layers to fix:
1. **Server**: when the target store is free tier, reject schedule slots whose outcome isn't allowlisted (same 409 pattern as the StoreUpdate fix).
2. **Client**: the schedule editor UI should filter its outcome dropdown by the same allowlist when editing a free-tier store. Find it under `apps/admin/src/panels/schedule/`.
3. **Backfill**: if existing free-tier stores have schedule slots referencing non-allowlisted outcomes, those should be deleted or re-pointed. A migration like `20260511030000_purge_free_tier_schedule_leakage` that DELETEs schedule_slot rows where the store is free-tier and the outcome isn't in the allowlist is the simplest move. Worth flagging to Daniel before running.

## Verification checklist

After fixing, confirm against the live `*Free Tier Song Builder* · Mid` location:

1. SQL on Railway: `SELECT id, name, default_outcome_id FROM stores WHERE tier='free';` — every row's `default_outcome_id` should be in `free_tier_outcomes` by `outcome_key`.
2. `dash.entuned.co` → that location → Location settings → default-outcome picker — Calm should not appear.
3. Pipeline tab → manually queue and accept a take → play it via `music.entuned.co/<slug>` — the playing outcome should be in the allowlist.
4. Outcome Schedule tab → try to save a slot pointing at Calm — should be rejected by the server with `409`.
5. SQL on Railway: `SELECT s.id, s.outcome_id FROM schedule_slots s JOIN stores st ON st.id = s.store_id WHERE st.tier='free' AND s.outcome_id NOT IN (SELECT o.id FROM outcomes o WHERE o.outcome_key IN (SELECT outcome_key FROM free_tier_outcomes));` — should return zero rows after the cleanup migration.

## Notes for the next session

- Daniel runs everything live (memory: `feedback_always_push.md`). Commit and push after edits. Server changes need `cd entuned-0.3 && railway up` from monorepo root (memory: `feedback_railway_monorepo_deploy.md`).
- The previous chat made the user mad several times by over-eager full-row UIs and lazy chip layouts. When proposing UI changes, lead with "what is this surface FOR" — see `project_suno_style_steering.md` and the recent Pipeline/Launch Checklist commits for examples of the redesign style he wants.
- The `FreeTierOutcome` table is operator-toggleable from the Free Tier Outcomes panel in Dash. The allowlist is small (currently seeds `Linger` + `Lift Energy`). Don't expand it without asking.
- When writing migrations, follow the existing pattern: a directory named `YYYYMMDDHHMMSS_snake_case_name/` with a single `migration.sql` inside. Railway applies them automatically on `prisma migrate deploy` at startup.

## Files of interest

- Allowlist: [apps/server/src/lib/outcomes.ts](apps/server/src/lib/outcomes.ts), [apps/server/prisma/migrations/20260510120000_free_tier_outcomes/migration.sql](apps/server/prisma/migrations/20260510120000_free_tier_outcomes/migration.sql)
- Playback: [apps/server/src/lib/hendrix.ts](apps/server/src/lib/hendrix.ts) (start here for #1)
- Schedule routes: [apps/server/src/routes/admin.ts](apps/server/src/routes/admin.ts) around line 2398–2530
- Schedule UI: search `apps/admin/src/panels/schedule/`
- Store update guard pattern to copy: [apps/server/src/routes/admin.ts](apps/server/src/routes/admin.ts) around line 700 (the `outcome_not_in_free_tier_allowlist` block in `PUT /stores/:id`)
