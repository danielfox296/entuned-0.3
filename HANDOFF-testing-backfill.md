# Handoff — Testing Backfill Sweeps A / B / C

> **STATUS: COMPLETED 2026-05-18.** All three sweeps merged to main. Test suite went from 208 → 679 (server 651 + api-client 28, 19 server test files). Net +469 tests. Prod-deploy gate is live across all four surfaces (Railway server + admin/dashboard/player Pages workflows). Kept on disk as institutional history of the multi-agent sweep pattern; the *pattern documentation* below remains useful for any future backfill (e.g. admin.ts batch, email-template snapshots, generation pipeline). The *sweep briefs* (A/B/C) are historical only — do not re-run.

A fresh Claude session can pick up this work without re-discovering anything. Read this top-to-bottom before starting.

Written 2026-05-18 at the end of a long session that established the testing practice + did the first backfill sweep.

---

## TL;DR for the next session

1. **Read first**: `TESTING.md` (the conventions), `FOLLOWUPS.md` (deferred code items), this file.
2. **State**: main is green, 208 tests passing (180 server + 28 api-client), all four prod surfaces deployed and healthy, every prod-deploy path gated by `pnpm test`.
3. **Your job**: run Sweep A (cron / silent-failure), then Sweep B (signup-to-payment), then Sweep C (player traffic path) — each as a parallel multi-agent burst on its own branch. ~3–4 agents per sweep, one test file per agent. Pattern documented below.
4. **Don't use worktree isolation.** It failed before in this codebase. Agents work in the main checkout, each owns one specific test file path. The "one test file per agent, never touch source" rule prevented the prior agent debacle.

---

## State on arrival

- **Branch**: `main` at commit `0b27dd0` ("Merge cleanup/test-backfill-1 into main: 99 new tests across me/admin/outcomeSchedule/outcomes") or later.
- **Tests**: 208 passing (run `pnpm test` from monorepo root to verify).
- **Prod**:
  - Server: `api.entuned.co/health` HTTP 200 (Railway service `entuned-0.3`)
  - Admin: `dash.entuned.co` HTTP 200 (Pages from this repo)
  - Player: `music.entuned.co` HTTP 200 (Pages from `danielfox296/entuned-0.3-player`)
  - Dashboard: `app.entuned.co/start` HTTP 200 (Pages from `danielfox296/entuned-0.3-dashboard`)
- **Gates live**:
  - Railway `buildCommand` is `pnpm prisma generate && pnpm test && pnpm build` → tests run before every server deploy
  - `pages.yml` and `deploy-dashboard.yml` have a `test` job that the build jobs `needs:` → tests run before every frontend deploy
  - Both workflows trigger on `push: branches: [main]` AND `pull_request: branches: [main]`; build/deploy jobs are gated to `github.event_name == 'push' || github.event_name == 'workflow_dispatch'` so PRs run tests but never deploy
- **Existing coverage** (already done — don't redo):
  - `apps/server/src/lib/bernie/_helpers.test.ts` (21 tests)
  - `apps/server/src/lib/scheduleSlots.test.ts` (37 tests)
  - `apps/server/src/lib/tier.test.ts` (18 tests)
  - `apps/server/src/lib/outcomeSchedule.test.ts` (34 tests)
  - `apps/server/src/lib/outcomes.test.ts` (24 tests)
  - `apps/server/src/routes/stores.test.ts` (5 tests — demo)
  - `apps/server/src/routes/me.test.ts` (20 tests — schedule slots only; OTHER me routes still untested)
  - `apps/server/src/routes/admin.test.ts` (21 tests — schedule slots only; OTHER admin routes still untested)
  - `packages/api-client/src/index.test.ts` (28 tests)

---

## The pattern that works

Verified across two sweeps so far. Don't deviate without good reason.

### Sweep structure

1. **Branch off main**: `git checkout -b cleanup/test-backfill-<N>` where `<N>` is the sweep number (next is 2).
2. **Pick 3–4 target files** from the priority order (see Sweep briefs below).
3. **Spawn agents in parallel**, one per target file. Use the `Agent` tool with `subagent_type: "general-purpose"` and `run_in_background: true`. Each agent gets a self-contained brief.
4. **Each agent owns one file** at one specific path. The agent reads source, writes ONE test file, runs the tests, commits to the branch, does NOT push.
5. **When all agents complete**, verify locally:
   - `pnpm test` from monorepo root → all tests pass
   - `pnpm --filter server typecheck` → clean
   - Each agent's commit is its own; no accidental cross-file contamination
6. **Push branch**, merge to main with `--no-ff`, push main. Server-only changes don't trigger frontend deploys (Pages paths don't include `apps/server/**`). Railway deploy stays manual via `railway up`.

### Hard rules for agents (include verbatim in every Agent prompt)

- **Working directory**: `/Users/fox296/Desktop/entuned/entuned-0.3`. On the branch (do not switch branches).
- **No worktrees.** Worktree isolation failed in this codebase — agents wrote to the main checkout instead. Stay in the main checkout.
- **One test file only.** Each agent writes to exactly one file path. Adding new fixtures to `apps/server/src/test-utils/fixtures.ts` is allowed IF the agent actually uses them; don't add unused builders.
- **No source-code modifications.** If a test reveals a real bug, STOP and report — don't fix source. (Add a finding to `FOLLOWUPS.md` after the sweep.)
- **Read `TESTING.md` first.** The conventions doc.
- **Imports use `.js` extensions** to match the codebase (ESM).
- **Run `pnpm --filter server test` (or the relevant package) at the end** and verify the agent's tests pass AND the existing suite still passes.
- **Commit only the test file**, tagged like `test(<module>): <description>`. Do NOT push — parent pushes after review.

### Mocking conventions

- **Prisma**: `vi.mock('../db.js', () => ({ prisma: { /* models */ } }))` at the top of the test file (path is relative to the test file's location). Inline literal, not extracted to a helper — `vi.mock` is hoist-based and the path must be a string literal.
- **Global `fetch`**: `vi.stubGlobal('fetch', fetchMock)`. `Response` bodies are single-read — for tests that hit the mock multiple times with the same response, use `mockImplementation(async () => new Response(...))` not `mockResolvedValue(new Response(...))`.
- **`requireAuth`** (preHandler in `lib/session.js`): mock the module so requireAuth populates `request.user` (and any other fields the route handlers read — check session.ts). See `apps/server/src/routes/me.test.ts` for the canonical pattern.
- **`requireAdmin`** (inline function in `admin.ts`): mock `lib/auth.js` for the JWT verify + Prisma `account.findUnique` for the operator lookup. Set `Authorization: Bearer admin-test-token` on requests. See `apps/server/src/routes/admin.test.ts` for the canonical pattern.
- **Anthropic SDK** (generation pipeline): mock the module. Pattern: `vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn().mockImplementation(() => ({ messages: { create: vi.fn() } })) }))`.
- **Stripe SDK**: similar — mock the module, return canned responses per test.

### Reference test files (point agents at these as worked examples)

| Pattern | File |
|---|---|
| Unit test against pure functions | `apps/server/src/lib/scheduleSlots.test.ts` |
| Unit test with Prisma mock | `apps/server/src/lib/outcomes.test.ts` |
| Unit test with DST / timezone math | `apps/server/src/lib/outcomeSchedule.test.ts` |
| Integration test, public route | `apps/server/src/routes/stores.test.ts` |
| Integration test, requireAuth-protected route | `apps/server/src/routes/me.test.ts` |
| Integration test, requireAdmin (JWT Bearer) route | `apps/server/src/routes/admin.test.ts` |
| Mocked `fetch`, factory client | `packages/api-client/src/index.test.ts` |

---

## Sweep A — Cron / silent-failure (HIGHEST LEVERAGE)

Run this first. The code that runs without anyone watching it; silent regressions go unnoticed for days. Hardest to verify manually, so tests are the only realistic detection.

Branch: `cleanup/test-backfill-2`.

### Agents

1. **`apps/server/src/lib/lifecycleEmails.ts`** (730 LOC) → `apps/server/src/lib/lifecycleEmails.test.ts`
   - The most complex single module in scope. 6 lifecycle drips (3 time-based, 3 behavioral) running daily at 9am MT.
   - Test surface: each drip's decision logic in isolation. Days-since-X calculations. Tier-transition gating. Already-sent suppression. Opt-out enforcement.
   - Mock: Prisma (many models — Account, Store, EmailLog or similar). Mock the email-send function so tests verify "would have sent" not "did send". Mock the current date via `vi.useFakeTimers()`.
   - Expected: ~40–60 tests. Most LOC = most branches.

2. **`apps/server/src/lib/pauseAutoResume.ts`** → `apps/server/src/lib/pauseAutoResume.test.ts`
   - Cron that auto-resumes paused subscriptions on their due date.
   - Mock: Prisma (Store with pausedUntil), tier mutation helpers.
   - Expected: ~15–25 tests. Boundary conditions on pausedUntil dates.

3. **`apps/server/src/lib/compExpiry.ts`** → `apps/server/src/lib/compExpiry.test.ts`
   - Cron that downgrades stores when comp expires.
   - Mock: Prisma (Store with compTier + compExpiresAt), `applyTierChange`.
   - Expected: ~15–20 tests. Half-open interval at expiry instant (already convention).

4. **`apps/server/src/lib/tier.ts` mutation helpers** → extend `apps/server/src/lib/tier.test.ts`
   - `applyTierChange` is the transactional mutation helper that all the above call. NOT yet tested (the existing `tier.test.ts` only tests `tierRank`, `effectiveTier`, `compIsActive`).
   - Mock: Prisma `$transaction`, `store.update`, `tierChangeLog.create`.
   - Expected: ~10–15 new tests. Audit log shape, no-op skip when fromTier == toTier, transaction propagation.
   - **Note**: this agent EXTENDS an existing test file (the only sweep-A agent that does this). Brief it to ADD a new `describe('applyTierChange', ...)` block, NOT rewrite the existing ones.

---

## Sweep B — Customer signup-to-payment journey

Where customer breakage is loud and immediate. Run second.

Branch: `cleanup/test-backfill-3`.

### Agents

1. **`apps/server/src/routes/auth.ts`** → `apps/server/src/routes/auth.test.ts`
   - Magic-link request, magic-link consume, Google OAuth start/callback, session creation.
   - Mock: Prisma (Account, MagicLink or whatever), JWT signing, email send, Google OAuth client.
   - Expected: ~20–30 tests.

2. **`apps/server/src/routes/login.ts`** → `apps/server/src/routes/login.test.ts`
   - If separate from auth.ts. Read the file first to confirm scope; might be `/login/me`, `/login/logout`, `/login/google` etc.
   - Mock: Prisma, JWT, possibly OAuth client.
   - Expected: ~15–25 tests.

3. **`apps/server/src/routes/billing.ts`** (970 LOC) → `apps/server/src/routes/billing.test.ts`
   - Stripe checkout session creation, webhook handling, customer portal.
   - Mock: Stripe SDK. This is the hardest mock — Stripe SDK has lots of nested types. Read the route file first to see exactly which Stripe methods are called and mock only those.
   - Expected: ~25–40 tests. Especially focus on webhook event types (checkout.session.completed, invoice.paid, customer.subscription.deleted, etc.).
   - **High-value tests**: signature verification, idempotency, the case where a webhook arrives before its prerequisite (e.g. invoice.paid before checkout.session.completed).

4. **`apps/server/src/lib/account.ts`** → `apps/server/src/lib/account.test.ts`
   - Slug generation (`uniqueStoreSlug` with collision retry), free-tier provisioning (`ensureFreeClientForUser`).
   - Mock: Prisma (Account, Client, Store, ClientMembership), `pickSystemDefaultOutcomeId`, `sendWelcome`, `randomBytes`.
   - Expected: ~15–20 tests. The 5-retry loop on slug collision is the load-bearing path.

---

## Sweep C — Player traffic path

What runs constantly in production while music plays. Run third.

Branch: `cleanup/test-backfill-4`.

### Agents

1. **`apps/server/src/routes/hendrix.ts`** (445 LOC) → `apps/server/src/routes/hendrix.test.ts`
   - `/hendrix/next` — every song change calls this. High-volume, business-logic-heavy (outcome resolution via `outcomeSchedule`, rotation, free-tier pool fallback, panic mode).
   - Mock: Prisma (Store, LineageRow, Hook, AudioEvent, etc.), `outcomeSchedule.resolveOutcomeForNow`.
   - Expected: ~25–40 tests. Outcome resolution paths, rotation, free-tier fallback to general pool, panic-tier when no songs available, store-not-found.

2. **`apps/server/src/routes/events.ts`** → `apps/server/src/routes/events.test.ts`
   - Audio event ingest. Every play/skip/heartbeat hits this.
   - Mock: Prisma (PlaybackEvent or AudioEvent, possibly Session).
   - Expected: ~15–25 tests. Idempotency on `idempotency_key`, event-type validation (zod), phase-3 correlation fields, session creation/lookup.

3. **`apps/server/src/lib/hendrix.ts`** (if separate from the route) → `apps/server/src/lib/hendrix.test.ts`
   - Internal rotation logic. The route file at 445 LOC may include the lib, OR there may be a separate `lib/hendrix.ts`. Check first; only spawn this agent if the lib file exists separately.
   - Expected: ~15–25 tests if applicable.

4. **`apps/server/src/lib/playbackHeartbeat.ts`** → `apps/server/src/lib/playbackHeartbeat.test.ts`
   - Heartbeat-processing logic (the cron that runs every 5 min — separate from the daily 9am cron in Sweep A).
   - Mock: Prisma (PlaybackEvent, Store).
   - Expected: ~10–20 tests.

---

## Self-contained Agent prompt template

Use this shape for each agent in any sweep:

```
You are writing tests for `<MODULE>`. Self-contained brief follows.

## Context

Working directory: /Users/fox296/Desktop/entuned/entuned-0.3
Branch: cleanup/test-backfill-<N> (do NOT switch branches; do NOT use worktrees).

Read first:
1. `TESTING.md` at repo root — the conventions doc
2. `<SOURCE FILE>` — the target you're testing
3. `<REFERENCE TEST FILE>` — canonical pattern for this style

## What to write

ONE file: `<TEST FILE PATH>`

<test surface — bullet list of cases to cover>

## Mocking strategy

<Prisma models to mock>
<Auth / fetch / SDK mocking guidance>

## Constraints (hard)

- One file only: <test file path>
- Imports use `.js` extension
- Tests must run and pass
- Do NOT modify any source file. If a test reveals a real bug, STOP and report
- Tag commit: `test(<module>): <description>`
- Commit but DO NOT push

End your reply with: test file path, test count, pass/fail count, and any source observations.
```

---

## When all three sweeps complete

- Expected new test count: roughly **+200 tests** (Sweep A ~80, Sweep B ~85, Sweep C ~70).
- Expected suite size: **~400 tests** total.
- All previously-uncovered cron paths, customer-journey paths, and player-traffic paths get coverage.
- Update `TESTING.md`'s backfill priority section to reflect what's now done.
- Append any new findings to `FOLLOWUPS.md`.

After Sweep C lands, remaining backfill targets per `TESTING.md`:

- The other 100+ admin routes (most are simple CRUD; can be batched)
- `apps/server/src/lib/email.ts` (template render shell — likely a snapshot test)
- `apps/server/src/email-templates/*.ts` — snapshot tests for HTML output (27 templates; could be ONE agent that does all of them)
- `apps/server/src/routes/push.ts`, `email.ts`, `health.ts`, `admin-reliability.ts`, `admin-retention.ts`
- Generation pipeline (`decomposer/`, `eno/`, `bernie/`, `mars/`, `hendrix/`, `ref-tracks/`) — lower priority, experiment surfaces

---

## Memory note

This handoff complements the persistent memory entry `feedback_testing_practice.md` in the user's Claude memory directory. Read both for the full picture. The memory entry covers conventions; this file covers the specific sweep work.
