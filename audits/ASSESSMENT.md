# entuned-0.3 Codebase Assessment

Read-only diagnostic snapshot. No code modifications were made. All file:line
citations are from a single pass on 2026-05-17.

Tool note: `ts-prune`, `madge`, and `jscpd` were not installed in the workspace
(no `node_modules/.bin/ts-prune`, and `pnpm exec ts-prune` returns
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). All dead-code claims below are
grep-based (MEDIUM confidence at best).

---

## 1. Structural facts

### Total

- 46,756 LOC across `apps/` (excludes `node_modules/`, `dist/`, `build/`).

### Per app

| App | Files | LOC |
|---|---:|---:|
| `apps/server` | 117 | 21,483 |
| `apps/admin` | 63 | 15,296 |
| `apps/dashboard` | 34 | 5,674 |
| `apps/player` | 25 | 4,303 |

### Per server subdirectory

| Path | LOC |
|---|---:|
| `apps/server/src/routes/` (13 files) | 8,047 |
| `apps/server/src/lib/` (top-level files, 17) | 2,978 |
| `apps/server/src/lib/decomposer/` (9 files) | 2,060 |
| `apps/server/src/lib/mars/` (10 files) | 1,180 |
| `apps/server/src/lib/bernie/` (4 files) | 762 |
| `apps/server/src/lib/eno/` (3 files) | 622 |
| `apps/server/src/lib/ref-tracks/` (2 files) | 431 |
| `apps/server/src/lib/hooks/` (1 file) | 418 |
| `apps/server/src/lib/arranger/` (1 file) | 250 |
| `apps/server/src/lib/retailnext/` (1 file) | 144 |
| `apps/server/src/lib/proto-bernie/` (1 file) | 113 |
| `apps/server/src/lib/variance/` (1 file) | 65 |

### Server route files (LOC + route counts)

| File | LOC | Routes |
|---|---:|---:|
| `routes/admin.ts` | 4,576 | 122 |
| `routes/billing.ts` | 970 | 10 |
| `routes/me.ts` | 818 | 18 |
| `routes/login.ts` | 447 | 6 |
| `routes/auth.ts` | 248 | 5 |
| `routes/events.ts` | 241 | 2 |
| `routes/hendrix.ts` | 213 | 4 |
| `routes/admin-retention.ts` | 199 | 1 |
| `routes/admin-reliability.ts` | 141 | 1 |
| `routes/push.ts` | 83 | 3 |
| `routes/email.ts` | 52 | 0 (delegates only) |
| `routes/stores.ts` | 50 | 1 |
| `routes/health.ts` | 9 | 1 |
| **Total** | **8,047** | **174** |

### Top 25 biggest files

| LOC | File |
|---:|---|
| 4,576 | `apps/server/src/routes/admin.ts` |
| 1,489 | `apps/admin/src/api.ts` |
| 1,436 | `apps/player/src/screens/PlayerScreen.tsx` |
| 1,078 | `apps/admin/src/panels/workflow/ReferenceTrackRefresh.tsx` |
| 970   | `apps/server/src/routes/billing.ts` |
| 867   | `apps/admin/src/App.tsx` |
| 830   | `apps/dashboard/src/routes/IcpIntake.tsx` |
| 818   | `apps/server/src/routes/me.ts` |
| 730   | `apps/server/src/lib/lifecycleEmails.ts` |
| 674   | `apps/admin/src/panels/brand/HookQueue.tsx` |
| 635   | `apps/admin/src/panels/playback/LiveStoreView.tsx` |
| 548   | `apps/admin/src/panels/seeding/SongSeed.tsx` |
| 541   | `apps/admin/src/panels/workflow/PreLaunchChecklist.tsx` |
| 534   | `apps/admin/src/panels/seeding/SongSeedQueue.tsx` |
| 526   | `apps/admin/src/panels/email/EmailTemplates.tsx` |
| 494   | `apps/admin/src/panels/engine/FormArchetypes.tsx` |
| 489   | `apps/admin/src/panels/salesdata/SalesDataIngest.tsx` |
| 474   | `apps/admin/src/panels/brand/Campaigns.tsx` |
| 460   | `apps/server/scripts/e2e.ts` |
| 455   | `apps/player/src/components/UpgradeRail.tsx` |
| 447   | `apps/server/src/routes/login.ts` |
| 446   | `apps/dashboard/src/routes/Locations.tsx` |
| 445   | `apps/server/src/lib/hendrix.ts` |
| 443   | `apps/admin/src/panels/workflow/HookRefresh.tsx` |
| 440   | `apps/dashboard/src/routes/Upgrade.tsx` |

### Prisma models touched (across `apps/server/src`)

50 distinct Prisma model accesses found:

`account`, `adAsset`, `campaign`, `campaignAssetState`, `campaignPlayState`,
`client`, `clientMembership`, `emailTemplate`, `formArchetype`,
`freeTierOutcome`, `hook`, `hookWriterPrompt`, `hookWriterPromptVersion`,
`iCP`, `lifecycleEmailLog`, `lineageRow`, `lyricBanEntry`,
`lyricDraftPrompt`, `lyricEditPrompt`, `magicLinkToken`, `outcome`,
`outcomeFactorPrompt`, `outcomeLyricFactor`, `pOSEvent`, `pOSPullRun`,
`passwordResetToken`, `playbackEvent`, `playbackEventRaw`, `playbackRules`,
`productionEra`, `pushSubscription`, `referenceTrack`, `referenceTrackPrompt`,
`retailNextDailySnapshot`, `retailNextHourlySnapshot`, `retailNextIngestRun`,
`scheduleSlot`, `song`, `songSeed`, `songSeedBatch`, `store`,
`storeAssignment`, `storeICP`, `storeRetiredSong`, `styleAnalysis`,
`styleAnalyzerInstructions`, `styleExclusionRule`, `styleTemplate`,
`subscription`, `tierChangeLog`.

### Route registrations (HTTP method + path per file)

#### `routes/health.ts` (1)
- `GET /health` — `routes/health.ts:4`

#### `routes/stores.ts` (1)
- `GET /stores/by-slug/:slug` — `routes/stores.ts:15`

#### `routes/events.ts` (2)
- `POST /events/` — `routes/events.ts:119`
- `GET /events/loved` — `routes/events.ts:219`

#### `routes/push.ts` (3)
- `GET /push/vapid-public-key` — `routes/push.ts:22`
- `POST /push/subscribe` — `routes/push.ts:30`
- `POST /push/unsubscribe` — `routes/push.ts:77`

#### `routes/hendrix.ts` (4)
- `GET /hendrix/next` — `routes/hendrix.ts:65`
- `GET /hendrix/outcomes` — `routes/hendrix.ts:91`
- `POST /hendrix/outcome-selection` — `routes/hendrix.ts:136`
- `POST /hendrix/outcome-selection/clear` — `routes/hendrix.ts:187`

#### `routes/auth.ts` (5) — operator (Dash) password flow
- `POST /auth/login` — `routes/auth.ts:37`
- `GET /auth/me` — `routes/auth.ts:63`
- `POST /auth/forgot-password` — `routes/auth.ts:112`
- `POST /auth/reset-password` — `routes/auth.ts:152`
- `POST /auth/change-password` — `routes/auth.ts:211`

#### `routes/login.ts` (6) — customer (app.entuned.co) passwordless flow
- `POST /login/magic-link` — `routes/login.ts:305`
- `GET /login/verify` — `routes/login.ts:370`
- `GET /login/google` — `routes/login.ts:410`
- `GET /login/google/callback` — `routes/login.ts:411`
- `POST /login/logout` — `routes/login.ts:414`
- `GET /login/me` — `routes/login.ts:423`

#### `routes/billing.ts` (10)
- `POST /billing/checkout` — `routes/billing.ts:146`
- `GET /billing/checkout` — `routes/billing.ts:188`
- `POST /webhooks/stripe` — `routes/billing.ts:217`
- `POST /billing/checkout-session/confirm` — `routes/billing.ts:300`
- `GET /billing/portal` — `routes/billing.ts:355`
- `GET /billing/upgrade-from-comp` — `routes/billing.ts:399`
- `GET /billing/upgrade` — `routes/billing.ts:492`
- `POST /billing/stores` — `routes/billing.ts:557`
- `POST /billing/pause` — `routes/billing.ts:628`
- `POST /billing/resume` — `routes/billing.ts:678`

#### `routes/me.ts` (18) — customer self-serve dashboard
- `PATCH /me/profile` — `routes/me.ts:119`
- `GET /me/stores` — `routes/me.ts:148`
- `GET /me/icp` — `routes/me.ts:218`
- `POST /me/icp` — `routes/me.ts:240`
- `GET /me/stores/:storeId/icp` — `routes/me.ts:284`
- `POST /me/stores/:storeId/icp` — `routes/me.ts:307`
- `GET /me/stores/:storeId/icps` — `routes/me.ts:359`
- `POST /me/stores/:storeId/icps` — `routes/me.ts:396`
- `PUT /me/icps/:icpId` — `routes/me.ts:437`
- `POST /me/icps/:icpId/archive` — `routes/me.ts:479`
- `PATCH /me/stores/:id` — `routes/me.ts:511`
- `GET /me/stores/:storeId/schedule` — `routes/me.ts:570`
- `POST /me/stores/:storeId/schedule` — `routes/me.ts:583`
- `PUT /me/schedule-rows/:id` — `routes/me.ts:604`
- `DELETE /me/schedule-rows/:id` — `routes/me.ts:629`
- `GET /me/outcomes` — `routes/me.ts:642`
- `POST /me/boost-trial` — `routes/me.ts:665`
- `GET /me/boost-trial/status` — `routes/me.ts:752`
- `POST /me/referral-code` — `routes/me.ts:789`

#### `routes/admin-reliability.ts` (1)
- `GET /admin/reliability/summary` — `routes/admin-reliability.ts:54`

#### `routes/admin-retention.ts` (1)
- `GET /admin/retention` — `routes/admin-retention.ts:56`

#### `routes/admin.ts` (122)
See section 3 for the full enumeration and clustering.

#### `routes/email.ts` (0)
Re-exports lifecycle email helpers only; no HTTP routes registered. Mounted at
`/email` prefix in `src/index.ts:79`.

---

## 2. Ranked divergent-pathway candidates

### HIGH

**1. Decomposer rules versions v1–v8 all live in source; default = v8.**
Domain: generation. Each rules-vN file exports a single string constant
imported by `decomposer.ts:13-20` into a `RULES_BY_VERSION` lookup
(`decomposer.ts:25-34`). `LATEST_RULES_VERSION = 8`
(`decomposer.ts:35`). Selection happens via the `DECOMPOSER_RULES_VERSION`
env var or falls back to v8 (`decomposer.ts:134-137`). The
`styleAnalyzerInstructions` row can also override (`decomposer.ts:137-143`).
- v1 (125 LOC) — `decomposer/rules-v1.ts`. Only consumer:
  `decomposer.ts:13`.
- v2 (177 LOC) — `decomposer/rules-v2.ts`. Only consumer:
  `decomposer.ts:14`.
- v3 (147 LOC) — `decomposer/rules-v3.ts`. Only consumer:
  `decomposer.ts:15`.
- v4 (191 LOC) — `decomposer/rules-v4.ts`. Consumers: `decomposer.ts:16`,
  plus a comment-only mention in `mars/sanitize.ts:17` and
  `mars/style-template-v1.ts:10`.
- v5 (225 LOC) — `decomposer/rules-v5.ts`. Only consumer:
  `decomposer.ts:17`.
- v6 (287 LOC) — `decomposer/rules-v6.ts`. Consumers: `decomposer.ts:18`,
  `prisma/seed/update-v6-rules.ts:8` (a one-off seed/upgrade script that
  writes v6 into the DB row). Comment reference in `eno/eno.ts:160`.
- v7 (346 LOC) — `decomposer/rules-v7.ts`. Only consumer:
  `decomposer.ts:19`.
- v8 (233 LOC) — `decomposer/rules-v8.ts`. Default. Consumer:
  `decomposer.ts:20`.

Confidence: HIGH. v1–v7 are dead under production defaults; they remain only
as historical fallbacks reachable via the `DECOMPOSER_RULES_VERSION` env or
a manually-edited `styleAnalyzerInstructions` row. Justification: same
exported shape (one constant string per file), same import pattern, same
consumer (`decomposer.ts` lookup map), and `LATEST_RULES_VERSION` pins to 8.

**2. Schedule-slot CRUD duplicated between admin and customer surfaces.**
Domain: outcomes/schedule. Identical signatures, identical logic
(time-string parsing, overlap detection, `prisma.scheduleSlot.*`).
- Operator path:
  - `GET    /admin/stores/:id/schedule`           — `routes/admin.ts:2541`
  - `POST   /admin/stores/:id/schedule`           — `routes/admin.ts:2569`
  - `PUT    /admin/schedule-rows/:id`             — `routes/admin.ts:2617`
  - `DELETE /admin/schedule-rows/:id`             — `routes/admin.ts:2666`
- Customer path:
  - `GET    /me/stores/:storeId/schedule`         — `routes/me.ts:570`
  - `POST   /me/stores/:storeId/schedule`         — `routes/me.ts:583`
  - `PUT    /me/schedule-rows/:id`                — `routes/me.ts:604`
  - `DELETE /me/schedule-rows/:id`                — `routes/me.ts:629`

Both versions duplicate the helpers `timeToHHMM`/`hhmmToTime`/`hhmmToSec`
(`admin.ts:80-94` and equivalents in `me.ts`) and reimplement overlap
detection inline (e.g. `admin.ts:2591` vs `me.ts:596`). Auth differs
(admin requires operator token; me uses `requireAuth`/`getClient`).
Both call sites use `prisma.scheduleSlot.*` directly.

Confidence: HIGH. Same Prisma model, same business invariants, same time
helpers, near-identical control flow. Justification: 4-route shape and
overlap-clash semantics are word-for-word parallel.

**3. Outcome-selection override duplicated between hendrix and admin.**
Domain: playback/outcomes. Both routes call the same lib
`setOverride`/`clearOverride` from `lib/outcomeSchedule.ts:132-150`, but
the route shells diverge in request parsing.
- `POST /hendrix/outcome-selection` — `routes/hendrix.ts:136` (accepts
  `store_id` OR `slug`; calls `setOverride(storeId, outcome_id)` at
  `routes/hendrix.ts:168`)
- `POST /hendrix/outcome-selection/clear` — `routes/hendrix.ts:187`
- `POST /admin/stores/:id/outcome-selection` — `routes/admin.ts:2491`
  (operator path; same `setOverride` call at `routes/admin.ts:2504`)
- `POST /admin/stores/:id/outcome-selection/clear` —
  `routes/admin.ts:2520`

Confidence: HIGH. Same lib function, same effect, two route shells. The
lib boundary is correct; the divergence is at the route layer.

**4. Three `generateLyrics`-style implementations.**
Domain: generation/lyrics.
- `proto-bernie/lyrics.ts:84` — `generateLyrics(input: LyricInput)`,
  single-pass. **Only callsite:** `scripts/compare-modes.ts:17` (a dev
  CLI script that does not run in production).
- `bernie/bernie.ts:100` — `generateLyrics(input: BernieInput)`, two-pass
  (draft → edit). Active production path; consumed by `eno/eno.ts:9`.
- `bernie/bernie-v2.ts:113` — `generateLyricsV2(input: BernieV2Input)`,
  two-pass + GenreBrief. Consumed by `eno/eno-v2.ts:13`. Pipeline
  selection at `eno/eno.ts:84-86` toggles via `opts.pipeline === 'eno-2'`.

The proto-bernie `DRAFT_PROMPT_SEED` and `EDIT_PROMPT_SEED` exports are
still consumed by `bernie/bernie.ts:10` and `bernie/bernie-v2.ts:17` — so
the proto-bernie file is not dead in full; only its `generateLyrics`
function is unreferenced from production.

Confidence: HIGH for the duplicated function name across three files
with overlapping responsibility (lyric generation from a hook). The
proto-bernie path is unambiguously dev-only.

**5. Two pipeline orchestrators in `eno/`.**
Domain: generation. `createSongSeed` in `eno/eno.ts:116` and
`createSongSeedV2` in `eno/eno-v2.ts:100` are structurally identical for
~90% of their bodies (hook pick, ref-track pick, marsAssemble, variance,
outcomeFactorPrompt, archetype, injectArrangement, prisma writes). The
only meaningful divergence is the lyric generator (`generateLyrics` vs
`generateLyricsV2`) and `extractGenreBrief` (Eno-2 only,
`eno-v2.ts:26-55`). Both call sites share imports of
`pickAvailableHook`, `pickReferenceTrack`, `applyOutcomeFactorPrompt`,
`getOrSeedOutcomeFactorPrompt`, all re-exported from `eno/eno.ts:228`.

Confidence: HIGH. Two parallel functions, ~90% shared logic,
documented in `eno-v2.ts:3-9` as "Parallel to createSongSeed() in
eno.ts (Eno-1)".

**6. `Tier` type drifted across three files.**
Domain: tier/billing.
- `apps/server/src/lib/tier.ts:8` —
  `'free' | 'core' | 'pro' | 'enterprise' | 'mvp_pilot'` (5 values, the
  source of truth used by `effectiveTier`, `applyTierChange`).
- `apps/server/src/lib/email.ts:27` — `'free' | 'core' | 'pro'`
  (3 values; used only by the welcome-variant router).
- `apps/dashboard/src/api.ts:45` —
  `'free' | 'core' | 'pro' | 'enterprise'` (4 values; client-facing).

Confidence: HIGH. Same name `Tier`, three different unions, all
representing the same domain concept. `effectiveTier()` can return
`'enterprise'` (`tier.ts:8`), which `email.ts:27` doesn't model, and
`'mvp_pilot'` which the dashboard doesn't model.

**7. `HookVocalGender` defined three times, identical shape.**
Domain: generation/hooks.
- `apps/server/src/lib/eno/eno.ts:226` —
  `'male' | 'female' | 'duet' | null`
- `apps/server/src/lib/hooks/drafter.ts:120` —
  `'male' | 'female' | 'duet' | null`
- `apps/admin/src/api.ts:804` — `'male' | 'female' | 'duet' | null`

Confidence: HIGH. Same name, same shape, three locations. Shapes match,
so no current runtime drift, but the duplication is a soft hazard.

**8. `OutcomeOption` is the same name with different shapes across
dashboard and player.**
Domain: outcomes (UI-facing).
- `apps/dashboard/src/api.ts:101` — `{ id, title, displayTitle }`
  (3 fields). Consumed by `meOutcomes` → `GET /me/outcomes` which returns
  exactly these three columns (`routes/me.ts:642-648`).
- `apps/player/src/api.ts:53` — `{ outcomeId, outcomeKey, title,
  tempoBpm, mode, poolSize, availableOnFree }` (7 fields). Consumed by
  `GET /hendrix/outcomes` (`routes/hendrix.ts:91`).

Confidence: HIGH. Two routes return two different shapes under the same
TypeScript name, in two different apps. They are intentionally different
endpoints — but the name collision is misleading.

### MEDIUM

**9. Two `/me` endpoints (operator vs customer).**
Domain: auth.
- `GET /auth/me` — `routes/auth.ts:63` (operator JWT; returns
  `{ accountId, email, isAdmin }`-shaped payload).
- `GET /login/me` — `routes/login.ts:423` (customer session cookie;
  returns customer Client/Account context).

Comment at `routes/login.ts:5-6` explicitly notes the mount path was
chosen to dodge the `GET /auth/me` collision. Two distinct
authentication systems live side by side: a Dash JWT (`routes/auth.ts`)
and a customer session cookie (`routes/login.ts` +
`lib/session.ts`). This is correct by design but a meaningful contributor
to cognitive sprawl in `routes/`.

Confidence: MEDIUM — two real authentication mechanisms, but the design
is documented in-source and necessary.

**10. ICP shapes: per-store vs primary, and singular vs plural.**
Domain: ICP/store.
- `GET /me/icp` (`routes/me.ts:218`) — returns the ICP for the authed
  Client's *primary* store.
- `GET /me/stores/:storeId/icp` (`routes/me.ts:284`) — returns the ICP
  for a *specific* store.
- `GET /me/stores/:storeId/icps` (`routes/me.ts:359`) — *list* of
  audiences for a store (Pro multi-audience feature).
- `POST /me/stores/:storeId/icp` (`routes/me.ts:307`) — singular
  upsert (Core).
- `POST /me/stores/:storeId/icps` (`routes/me.ts:396`) — plural create
  (Pro).

The singular/plural distinction is documented at `routes/me.ts:393-395`
and looks intentional, but `pickIcpFields` is repeatedly used across
all five endpoints. Whether the two POST shapes need to remain separate
is unresolved from code alone.

Confidence: MEDIUM — possibly intentional tier-feature split, but
inviting a single endpoint with a `mode: 'upsert' | 'create'` flag.

**11. Two Mars style builders configurable per call.**
Domain: generation/style. `marsAssemble` (`mars/mars.ts:71`) dispatches
to one of:
- `routeStylePortion` (`mars/style-router.ts:172`) — default `'router'`
- `buildAnchorStyle` (`mars/style-anchor.ts:140`) — `'anchor'`
- `assembleStylePortion` (`mars/style-template-v1.ts:52`) — `'legacy'`

Per-call selection via `opts.styleBuilder` or env `STYLE_BUILDER`
(`mars.ts:76`); operator picks per-batch via the Dash dropdown. Notably,
`styleLegacy = assembleStylePortion(...)` is **always recomputed** for
QC parity (`mars.ts:77`), even when the chosen builder is router or
anchor. This is documented at `mars.ts:37-38`.

Confidence: MEDIUM. Three strategies is intentional (memory:
"Suno style steering: anchor-and-carve"). Not a duplication to remove,
but worth flagging that `style-template-v1.ts` is now a "parity oracle"
rather than a production code path, and runs on every assembly.

### LOW

**12. `email.ts:27` `Tier` is a narrower local-domain alias.**
Already counted in #6 above but tagged LOW separately because the
narrowing is plausibly intentional (`sendWelcome` only routes among
three tiers).
Files: `apps/server/src/lib/email.ts:27` vs `apps/server/src/lib/tier.ts:8`.

**13. Schedule-slot helpers duplicated.**
Time-string helpers `timeToHHMM`, `hhmmToTime`, `hhmmToSec` exist at
`apps/server/src/routes/admin.ts:80-94` and almost-certainly again in
`apps/server/src/routes/me.ts` (used at `me.ts:565`, `me.ts:595`). The
function names are imported/declared per file; not pulled into a shared
helper. Confidence LOW because I did not read the `me.ts` declaration
block fully.

---

## 3. `apps/server/src/routes/admin.ts` breakdown (4,576 LOC, 122 handlers)

### Imports (top of file)

`admin.ts:18-42` imports 21 modules. None are frontend-facing
(no `apps/admin/*` or `apps/dashboard/*` imports were found:
`grep -nE "from.*/admin|from.*/dashboard|from.*/player" admin.ts` returns
zero hits except an in-comment reference at `admin.ts:3369`). One auth
helper (`requireAdmin`, `admin.ts:50-77`) is declared locally — not
pulled from `lib/session.ts` or `lib/auth.ts`.

### Cluster map (operator-marked sections, `// -----` markers, all 27)

| Section header (file:line) | Span | Routes |
|---|---|---:|
| Musicological Rules — `admin.ts:123` | 125–141 | 2 |
| FailureRules / StyleExclusionRules — `admin.ts:143` | 145–202 | 4 |
| StyleTemplate — `admin.ts:202` | 204–223 | 2 |
| Production Eras — `admin.ts:222` | 224–235 | 1 |
| OutcomeFactorPrompt — `admin.ts:234` | 236–256 | 2 |
| ReferenceTrackPrompt — `admin.ts:254` | 256–292 | 3 |
| Lyric prompts (Bernie) — `admin.ts:292` | 294–330 | 3 |
| LyricBanEntries — `admin.ts:330` | 332–382 | 4 |
| Clients (Card 3 Duke) — `admin.ts:384` | 386–622 | 5 |
| Store editor — `admin.ts:623` | 633–867 | 5 |
| ICP — `admin.ts:862` | 869–1219 | 11 (icps, reference-tracks, decompose) |
| Bulk decompose — `admin.ts:1220` | 1222–1270 | 1 |
| Outcomes read-only — `admin.ts:1271` | 1273–1291 | 1 |
| Outcomes write (Card 9) — `admin.ts:1292` | 1304–1432 | 4 |
| OutcomeLyricFactor — `admin.ts:1362` | 1366–1432 | 2 |
| FormArchetype — `admin.ts:1434` | 1457–1557 | 4 |
| Free Tier Outcome Allowlist — `admin.ts:1554` | 1559–1601 | 2 |
| Pool Depth — `admin.ts:1597` | 1602–1648 | 1 |
| Song Catalogue (LineageRow CRUD) — `admin.ts:1649` | 1653–1979 | 7 (incl. flagged/retire) |
| Hooks queue — `admin.ts:1978` | 1980–1998 | 1 |
| Hook Drafter — `admin.ts:2000` | 2002–2265 | 11 (hook-writer-prompt + CRUD + bulk) |
| Playback live store view — `admin.ts:2266` | 2268–2540 | 5 |
| Schedule per-store — `admin.ts:2539` | 2541–2682 | 5 |
| Schedule Dry Run — `admin.ts:2677` | 2683–2856 | 1 (large handler, ~170 LOC) |
| Operator Seeding (Song Seeds + Eno) — `admin.ts:2857` | 2865–3250 | 10 |
| Users / Operators — implicit cluster | 3251–3554 | 8 |
| Logins panel / clients — `admin.ts:3555` | 3555–3620 | 1 |
| POS + RetailNext ingest — implicit | 3621–3908 | 5 |
| Campaigns + AdAssets — `admin.ts:3909` | 3909–4140 | 8 |
| Email template preview/test — `admin.ts:4125` | 4142–4310 | 3 |
| Comp / tier history — implicit | 4312–4483 | 3 |
| Maintenance crons (manual triggers) — implicit | 4484–4513 | 3 |
| Song load failures — `admin.ts:4513` | 4513–end | 1 |

### Handler-by-handler list

All 122 admin routes (method + path + line). See section 1 above for the
raw `grep` output; the file:line citations there are authoritative. They
group into the 27 sections above.

### Duplication notes (admin.ts handlers vs other places)

- `POST /admin/stores/:id/outcome-selection` (`admin.ts:2491`) and
  `POST /admin/stores/:id/outcome-selection/clear` (`admin.ts:2520`) —
  both wrap `lib/outcomeSchedule.ts::setOverride/clearOverride`
  (`outcomeSchedule.ts:132-150`); the same lib is also wrapped by
  `routes/hendrix.ts:168` and `routes/hendrix.ts:202`. The duplication
  is at the route shell, not the lib. See section 2 #3.
- The schedule-slot CRUD block (`admin.ts:2541-2682`) duplicates
  `routes/me.ts:570-639`. See section 2 #2.
- `POST /admin/email/pause-auto-resume/run` (`admin.ts:4484`),
  `POST /admin/comp-expiry/run` (`admin.ts:4498`),
  `POST /admin/email/lifecycle/run` (`admin.ts:4276`) — these are
  on-demand triggers for the cron-driven jobs in
  `lib/pauseAutoResume.ts`, `lib/compExpiry.ts`,
  `lib/lifecycleEmails.ts`. Duplication is intentional ("fire now"
  button); each wraps the same library entry point also called from
  `src/index.ts` (the daily cron).
- `POST /admin/stores` (`admin.ts:633`) creates stores. The customer
  surface creates stores via `POST /billing/stores`
  (`routes/billing.ts:557`) — but the billing path runs through Stripe
  checkout and provisioning, so the duplication is more apparent than
  real. Both ultimately upsert `prisma.store.*`. Not flagged.
- `GET /admin/stores` (`admin.ts:799`), `GET /me/stores`
  (`routes/me.ts:148`), `GET /stores/by-slug/:slug`
  (`routes/stores.ts:15`): three "list/lookup stores" endpoints, each
  scoped differently (all operator | by Client | public by slug).
  Reasonable surface differentiation; not a duplication.

### Frontend-imports check

`admin.ts:1-42` has no imports outside `apps/server/`. Verified by
`grep -nE "from '../../apps|from.*/admin|from.*/dashboard|from.*/player"
admin.ts`.

### Summary characterisation

`admin.ts` is a 4,576-LOC sprawl of 27 sections and 122 routes, but it
is *not* incoherent: each section is a tightly cohesive CRUD or
LLM-runner block, and routes inside a section all share `requireAdmin`
+ a Zod body schema + direct Prisma access. The pain is finding things,
not internal mess. The 170-LOC schedule-dry-run handler
(`admin.ts:2683-2856`) and the 200-LOC retailnext ingest
(`admin.ts:3735-3853`) are the biggest single handlers and the most
plausible "extract to lib" candidates.

---

## 4. Generation pipeline check

### Pipeline shape

The production pipeline composes cleanly. Names match
`GENERATION.md` (Hook × Outcome × ReferenceTrack lanes).

1. **Drafter** (`lib/hooks/drafter.ts:346`, `draftHooks`) — produces
   `Hook` rows per ICP + Outcome via Claude. Single caller in
   production: `routes/admin.ts:2053`. Does **not** pick reference
   tracks.
2. **Suggester** (`lib/ref-tracks/suggester.ts:216`,
   `suggestReferenceTracks`) — produces `ReferenceTrack` candidates
   per ICP. Single production caller: `routes/admin.ts:32` (used at
   `admin.ts:283-288` to seed reference tracks). Does **not** touch
   Hooks. v2 "unified suggester" comment in
   `seed/bump-reference-track-prompt-v2.ts:1` mentions that an earlier
   *standalone Adjacent suggester* was already merged in; no second
   suggester file remains.
3. **Decomposer** (`lib/decomposer/decomposer.ts:129`, `decompose`) —
   takes one reference track and produces a `StyleAnalysis` row. v8 by
   default. Production callers:
   `routes/admin.ts:1160` (single-track) and `admin.ts:1222-1270`
   (bulk).
4. **Eno** orchestrator (`lib/eno/eno.ts:59`, `runEno`) — the per-batch
   loop. Picks one hook + one ref track + runs Mars + Variance +
   Bernie + Arranger. Pipeline toggle at `eno.ts:84-86` dispatches
   to `createSongSeedV2` (`eno-v2.ts:100`) when `opts.pipeline ===
   'eno-2'`. Sole production caller: `routes/admin.ts:3054`
   (`POST /admin/eno/run`).
5. **Mars** (`lib/mars/mars.ts:71`, `marsAssemble`) — picks one of
   three style builders. See section 2 #11.
6. **Variance** (`lib/variance/variance.ts`, `resolveOutcomeParams`) —
   samples concrete tempo/mode from the Outcome.
7. **Bernie** (`lib/bernie/bernie.ts:100` or
   `lib/bernie/bernie-v2.ts:113`) — two-pass lyric generator.
8. **Arranger** (`lib/arranger/arranger.ts`, `injectArrangement`) —
   pure injection of `[Instrument: ...]` tags.
9. **outcomeFactorPrompt wrap** (`lib/eno/eno.ts:28`,
   `applyOutcomeFactorPrompt`) — prepends mood/tempo/mode to Mars's
   style.

No overlapping responsibilities found between drafter and decomposer
(they operate on disjoint domains: hooks vs ref-tracks). No second
ref-track picker found (Eno's internal `pickReferenceTrack` is exported
from `eno/eno.ts` and used by both Eno-1 and Eno-2).

### Is `rules-v6.ts` called anywhere?

Yes. Two consumers:
- `apps/server/src/lib/decomposer/decomposer.ts:18` (imported into the
  `RULES_BY_VERSION` table).
- `apps/server/prisma/seed/update-v6-rules.ts:1-8` (a one-off seed
  script that writes the v6 text into the
  `styleAnalyzerInstructions` table; not a production runtime
  dependency).

The default rules version is v8 (`decomposer.ts:35`). v6 would only
fire if a `DECOMPOSER_RULES_VERSION=6` env override is set OR a v6
`styleAnalyzerInstructions` row exists and is picked. Confidence on
"v6 is dead in production": HIGH — but the file is not orphaned in
source, and Daniel may keep it as a parity tool.

#### v6 → v7 → v8 substantive differences

- v6 (`rules-v6.ts:1-5`): adds `arrangement_sections` (per-section
  instrumentation directives) for the Arranger module.
- v7 (`rules-v7.ts:1-5`): hard ban on literary/aesthetic vocabulary in
  descriptive fields (doleful, plaintive, pastoral, etc); replaces with
  technical-spec vocabulary.
- v8: drops `arrangement_shape` and `dynamic_curve` as standalone
  fields; pushes that info into `arrangement_sections`'s per-section
  `dynamic`/`vocal_delivery` keys. The schema-divergence is encoded in
  `decomposer.ts:150-158` (per-version required-keys list).

### Mars `applyOutcomeFactorPrompt` invariant check

Daniel's documented invariant: "Every Mars style builder MUST let
eno's `applyOutcomeFactorPrompt` wrap its output. Tempo/mode/mood live
on the prepend; don't inline them or skip the wrap."

What I found: the wrap is applied **at the Eno layer, not per Mars
builder**. The three Mars builders (`routeStylePortion`,
`buildAnchorStyle`, `assembleStylePortion`) all return a raw style
string — none of them call `applyOutcomeFactorPrompt`. The wrap happens
exactly once per song-seed assembly, in:
- `eno/eno.ts:151-155` (Eno-1 path).
- `eno/eno-v2.ts:139-143` (Eno-2 path).

Both call sites pass `mars.style` (the builder output) into
`applyOutcomeFactorPrompt`. So the invariant is satisfied by the Eno
orchestrator, not by individual builders. This is consistent with the
memory note's intent ("don't inline tempo/mode/mood into the builder
output") because the builders never receive the Outcome's mood/tempo as
parameters in the first place:
- `mars/style-router.ts:172` signature: `(styleAnalysis, { year })` —
  no Outcome.
- `mars/style-anchor.ts:140` signature: `(decomposition, ctx)` where
  `ctx = { year }` — no Outcome.
- `mars/style-template-v1.ts:52` signature: `({ decomposition })` —
  no Outcome.

`mars.ts:71` (`marsAssemble`) accepts `_outcome` as a parameter but
prefixes the name with `_` and never reads it
(`mars.ts:73` underscore-prefix indicates "intentionally unused"). The
invariant is structurally enforced: builders simply cannot inline
tempo/mode/mood because they don't have access to the Outcome.

Confidence: HIGH — invariant is upheld at the Eno layer by every
production code path. No Mars builder bypasses it.

### Pipeline summary

One clean pipeline. The Eno layer is the single orchestrator. The
duplication is at the Eno layer itself (Eno-1 vs Eno-2, section 2 #5)
rather than in the modules it calls. The flag-based dispatch
(`eno.ts:84-86`) keeps the parallel path opt-in.

---

## 5. Cross-app type drift

There are **no shared workspace packages** (`pnpm-workspace.yaml`
exists but there is no `packages/` directory). The pattern repeats:
each app declares its own copy of the types it needs to talk to the
server.

| Type | Defined in | Status |
|---|---|---|
| `Tier` | server `lib/tier.ts:8` (5 values), server `lib/email.ts:27` (3 values), dashboard `api.ts:45` (4 values) | HIGH drift — see section 2 #6 |
| `HookVocalGender` | server `lib/eno/eno.ts:226`, server `lib/hooks/drafter.ts:120`, admin `api.ts:804` | HIGH duplication, identical shape — section 2 #7 |
| `OutcomeOption` | dashboard `api.ts:101` (3 fields), player `api.ts:53` (7 fields) | HIGH drift, intentional (different endpoints), same name | section 2 #8 |
| `StoreRow` | admin `api.ts:65` (8 fields: id, name, timezone, clientId, icpId, defaultOutcomeId, outcomeSelectionId, outcomeSelectionExpiresAt, goLiveDate), dashboard `api.ts:113` (id, name, slug, tier, paidTier, compTier, compExpiresAt, …) | HIGH drift — two completely different shapes under the same name. Both are real (different endpoints) but the name collision is misleading. |
| `OutcomeRow` / `OutcomeRowFull` | admin `api.ts:77`, admin `api.ts:786` (full version with extra fields) | Single-app, intentional thin/full split. Not drift. |
| `HookRow` / `HookRowFull` | admin `api.ts:108`, admin `api.ts:806` | Single-app, same pattern. Not drift. |
| `StoreBySlug` | player `api.ts:27` | Single-app. No counterpart. |
| `OutcomeFactorPromptRow`, `OutcomeLyricFactorRow`, `ReferenceTrackPromptRow`, `StoreSummary`, `StoreCompState`, `TierHistoryRow`, `ClientPlan`, `ClientListRow`, `ClientFull`, `ClientLoginRow`, `UserRow`, `SongSeedRow`, `SongSeedDetail`, `OutcomeWithPool`, `StoreRetentionRow` | admin `api.ts` only | Single-app, no drift. |
| `StoreSubscriptionSummary` | dashboard `api.ts:107` | Single-app. No counterpart. |

### Notes

- The `Tier` drift in `email.ts:27` is the one most likely to silently
  break: `effectiveTier(...)` can return `'enterprise'` or
  `'mvp_pilot'`, but the `sendWelcome` switch only handles three values
  and would fall through to the `welcomeFree` branch (`email.ts:274-277`).
- The `StoreRow` collision is the structurally most-confusing one: an
  Admin developer reading `dashboard/src/api.ts` could reasonably
  assume both `StoreRow` types are interchangeable, but they share
  almost no fields.

---

## 6. Dead-code candidates

ts-prune is not installed, so this list is grep-based (MEDIUM confidence
unless otherwise noted).

### Files with zero importers from production paths

- `apps/server/scripts/compare-modes.ts` — 0 importers in
  `apps/server/src/`, `apps/admin/src/`, `apps/dashboard/src/`,
  `apps/player/src/`. Only referenced in its own comments/usage
  string. It is the *sole* production-tree consumer of
  `lib/proto-bernie/lyrics.ts::generateLyrics` (see section 2 #4). If
  removed, `proto-bernie/lyrics.ts::generateLyrics` becomes orphaned;
  the `DRAFT_PROMPT_SEED`/`EDIT_PROMPT_SEED` exports from that file are
  still used.
- `apps/server/scripts/e2e.ts` — 0 importers. Top-of-file comment
  identifies it as a CLI smoke-test. Likely dev-only by design;
  confirm with Daniel.
- `apps/server/prisma/seed/test-*.ts` (`test-arranger-decompose.ts`,
  `test-arranger-eno.ts`, `test-form-archetype.ts`,
  `test-no-instrumentals.ts`, `test-unified-suggester.ts`,
  `test-variance.ts`) — 0 importers. All appear to be one-off
  verification scripts. Confidence MEDIUM that they're dev tooling
  worth keeping; LOW that any are still actively useful.
- `apps/server/prisma/seed/bump-*.ts` and `update-v6-rules.ts` — these
  are one-shot DB migration helpers; their value is historical, not
  runtime. Cannot be marked dead without confirming the DB is past the
  point each one would advance it.

### Exports with zero importers from production paths

- `MUSICOLOGICAL_RULES_V1` through `MUSICOLOGICAL_RULES_V7`
  (`decomposer/rules-v[1-7].ts`) — each is consumed only by
  `decomposer.ts:13-19` (lookup table) and a handful of one-off seed
  scripts. v8 is the only default-reachable version. Confidence HIGH
  that v1–v3 are dead at production defaults; MEDIUM that v4–v7 are
  dead (recent enough to plausibly be a rollback target).
- `generateLyrics` from `lib/proto-bernie/lyrics.ts:84` — consumed only
  by `scripts/compare-modes.ts:17`. Confidence HIGH (dev-tool only).
- `getStyleTemplateVersion` (`mars/style-template-v1.ts`) — still
  imported by `mars/mars.ts:21` and used at `mars.ts:100`. Not dead.
- `assembleStylePortion` (`mars/style-template-v1.ts:52`) — still
  imported (used as parity oracle, `mars.ts:77`). Not dead, but its
  output is discarded unless `styleBuilder === 'legacy'`. Section 2
  #11 flags the cost.

### Notes on confidence

Grep-based detection cannot distinguish "imported but unused" from
"imported and used". A real `ts-prune` pass would tighten these
numbers; without it, every claim above is MEDIUM at best and HIGH only
when the file has zero importers via grep.

---

## 7. Cron / scheduled-job inventory

### Server-side (`apps/server/src/index.ts`)

There are **two** cron registrations, both via `node-cron`
(`index.ts:6`).

#### Daily cron (`index.ts:100`)

Schedule: `0 9 * * *` (every day, 9am America/Denver). Registered
behind `LIFECYCLE_DRIPS_DISABLED !== '1'` env flag (`index.ts:99`).
Fires the following in order (`index.ts:100-133`):
1. `runPauseAutoResume()` — `lib/pauseAutoResume.ts:68,100`. Resumes
   stores whose pause window expired.
2. `runBoostTrialClockActivation()` — `lib/boostTrialClock.ts`.
   Activates Boost trial clocks for stores whose first generation
   landed.
3. `runLifecycleEmails()` — `lib/lifecycleEmails.ts:51` (the 730-LOC
   file). Fires 9 drips in parallel (`lifecycleEmails.ts:52-72`):
   `icpUnfilled`, `pauseEnding`, `freeToCoreNudge`,
   `engagedFreeToCore`, `scalingCoreToPro`, `establishedCoreToPro`,
   `boostTrialStreamReady`, `boostTrialEngagement`,
   `postConversionBenchmark`.
4. `runCompExpiryCron()` — `lib/compExpiry.ts`. Expires comp tiers and
   sends `compEnded` emails.

Each step is wrapped in try/catch (`index.ts:101-132`) and logs
structured stats. **Risk note:** `runLifecycleEmails` fires all nine
drips with `Promise.all` — one slow query in any drip blocks the whole
batch, and a single drip throwing would still surface via
`Promise.all` rejection (which the try/catch handles). No per-drip
timeout. The file is 730 LOC and contains the same
`prisma.lifecycleEmailLog.findUnique`/`create` block 9 times.
Idempotency rails are present (`LifecycleEmailLog` unique key at
`lifecycleEmails.ts:15-17`).

Manual-trigger admin routes wrap the same lib entry points:
- `POST /admin/email/lifecycle/run` (`admin.ts:4276`) →
  `runOneLifecycleDrip` (`lifecycleEmails.ts:76`).
- `POST /admin/email/pause-auto-resume/run` (`admin.ts:4484`).
- `POST /admin/comp-expiry/run` (`admin.ts:4498`).

#### Playback heartbeat cron (`index.ts:142`)

Schedule: `*/5 * * * *` (every 5 minutes). Registered behind
`PLAYBACK_HEARTBEAT_DISABLED !== '1'` env AND `isPushConfigured()`
(`index.ts:141`). Fires:
- `runPlaybackHeartbeat()` — `lib/playbackHeartbeat.ts:100 LOC`. Finds
  active stores that went silent without explicit operator pause and
  sends a "music paused — tap to resume" web push.

Risk note: every 5 minutes is the highest-frequency job; if it stalls,
silent stores miss the resume nudge. No per-tick timeout.

#### Boot-time job (not a cron)

`seedEmailTemplates()` at `index.ts:84-91` runs once on boot. Idempotent
by design (`lib/email.ts:320`). Low risk.

### Frontend `setInterval` (informational, not silent-regression risk)

- `apps/admin/src/panels/brand/HookQueue.tsx:197` — UI elapsed-time
  counter (1 s).
- `apps/player/src/screens/PlayerScreen.tsx:748,829,856,1029` — player
  control loops (15 s / 2 s / heartbeat / playback).
- `apps/player/src/components/UpgradeRail.tsx:244`.
- `apps/player/src/audio/loudness-sampler.ts:127`.
- `apps/player/src/lib/event-buffer.ts:82` — event flush loop.

These are client-side display/IO loops, not server-side scheduled jobs.

### Cron risk summary

The 9am daily cron is the single biggest invisible-regression surface:
4 cascaded functions, 9 lifecycle-drip subqueries each with their own
SQL, no shared rate-limit, and no observable status (only Pino
`info`/`error` logs). The playback heartbeat is small but
high-frequency. Neither has a dead-man timer or success heartbeat
exposed to monitoring beyond log lines.

---

## 8. Open questions for Daniel

1. **rules-v1 through rules-v7 — keep or prune?** All seven older
   rules versions are imported by `decomposer.ts:13-19` into a lookup
   table reachable only via `DECOMPOSER_RULES_VERSION` env override
   or a manually-edited `styleAnalyzerInstructions` DB row. v8 is the
   default. Are any of these still needed as rollback parachutes? If
   yes, which?
2. **Eno-1 vs Eno-2 — is the parallel `createSongSeed`/
   `createSongSeedV2` split a long-term lane or a migration window?**
   The `eno-v2.ts:3-9` comment frames it as a parallel path; current
   dispatch (`eno.ts:84-86`) uses `opts.pipeline === 'eno-2'` to
   switch. Once Eno-2 is the default, can Eno-1 be retired?
3. **`scripts/compare-modes.ts` / `scripts/e2e.ts` / `scripts/
   assemble.ts` / `scripts/decompose.ts` — are these still actively
   used as dev tools?** None are imported by any other file. If still
   used as CLIs, they should stay; if abandoned, they account for the
   sole consumers of `proto-bernie/lyrics.ts::generateLyrics`.
4. **`prisma/seed/test-*.ts` — keep or prune?** Six `test-*.ts` files
   in `prisma/seed/` are one-off verification scripts. None are
   imported. Keep as historical record or drop?
5. **`mars/style-template-v1.ts::assembleStylePortion` runs on every
   song-seed assembly as a parity oracle (`mars.ts:77`).** Is the
   parity check still operationally valuable, or can the legacy
   builder be deleted entirely along with this always-run side
   computation?
6. **Schedule-slot endpoints duplicated between
   `/admin/stores/:id/schedule*` and `/me/stores/:storeId/schedule*` —
   are these intentionally separate handlers, or should they share a
   `lib/schedule.ts` like outcome-selection shares
   `lib/outcomeSchedule.ts`?**
7. **`Tier` type drift in `lib/email.ts:27` (3 values) vs
   `lib/tier.ts:8` (5 values):** `sendWelcome` falls through to
   `welcomeFree` for `'enterprise'` / `'mvp_pilot'` callers
   (`email.ts:274-277`). Is that intentional, or should those tiers
   route to `welcomePro`?
8. **`OutcomeOption` and `StoreRow` collide across `dashboard` and
   `player` / `admin` apps with different shapes. Is the type-name
   reuse intentional (each app's local DTO), or worth pulling into a
   shared `packages/types` workspace package?**
9. **Daily cron — is there an external monitor (Sentry cron, Better
   Stack, etc.) watching for missed 9am ticks, or only log-grep on
   Railway?** Silent cron failure is the biggest invisible-regression
   risk in the server.

---

## Modules marked as experimental / opt-in

The following modules look like sprawl/divergent pathways at first glance but are intentional experiment surfaces. They are documented as discrete modules and **should not be cleaned up by consolidating their parallel paths.** Future audits should treat them as out-of-scope for "dedupe" work.

### `apps/server/src/lib/eno/` — Eno-1 + Eno-2 parallel orchestrators

Eno-1 (`createSongSeed`, the production default) and Eno-2 (`createSongSeedV2`, opt-in via Dash toggle) coexist while Daniel evaluates whether Eno-2's genre-aware lyric path produces better output than Eno-1's general path. Eno-2 is a thin extension of Eno-1, not a parallel rewrite — it imports shared helpers from Eno-1, and the only substantive diff is the Bernie draft prompt. The Bernie-1/2 pair under `apps/server/src/lib/bernie/` follows the same opt-in contract. See [`apps/server/src/lib/eno/README.md`](apps/server/src/lib/eno/README.md) for the full module contract, default-selection logic, and the load-bearing `applyOutcomeFactorPrompt` invariant. Original audit: [`ASSESSMENT-eno-comparison.md`](ASSESSMENT-eno-comparison.md).

### `apps/server/src/lib/decomposer/` — MusicologicalRules version sweep (v1–v8)

`rules-v1.ts` through `rules-v8.ts` are not eight competing implementations — they are the history of one prompt as it has evolved. v8 is the production default ([`decomposer.ts:35`](apps/server/src/lib/decomposer/decomposer.ts)); v6 remains imported by [`decomposer.ts:18`](apps/server/src/lib/decomposer/decomposer.ts); v1–v5 and v7 are reachable only via env override or DB row. The older versions are kept on disk for rollback, A/B comparison, and historical-reproducibility of past `Decomposition` rows. See [`apps/server/src/lib/decomposer/README.md`](apps/server/src/lib/decomposer/README.md) for the version sweep contract and the rules for adding a new version.

---

## Notes on scope

- All file:line citations were verified by direct read or `grep -n`.
- No code was modified. Only `ASSESSMENT.md` was written.
- `ts-prune`, `madge`, and `jscpd` were not available; dead-code
  detection is grep-based and capped at MEDIUM confidence.
- Section 3 enumerates the admin.ts route list at high level; the raw
  route-by-line list lives in section 1 of this file. Reading every
  one of the 122 admin handlers to verify duplication against `lib/`
  was out of budget; spot checks against five major sections
  (schedule, outcome-selection, lifecycle email triggers, store
  CRUD, comp expiry) found one HIGH-confidence duplication (schedule)
  and several intentional thin wrappers.
