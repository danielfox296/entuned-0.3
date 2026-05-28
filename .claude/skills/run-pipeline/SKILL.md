---
name: run-pipeline
description: Full music generation pipeline for any client/store/ICP — from empty pool to songs in Dash. Bootstraps the ICP if needed (default outcome, reference tracks, decompose), then orchestrates draft-hooks → make-song-seeds → populate-songs. Use when Daniel says "fill the library", "run the pipeline", or "generate songs for X" — works for both curated ICPs and ICPs created via the app surface (app.entuned.co self-serve intake).
---

# run-pipeline

Orchestrator. Runs the complete music generation pipeline end-to-end by delegating to the 3 stage-specific skills:

```
[Bootstrap]  →  draft-hooks  →  make-song-seeds  →  populate-songs
 (browser +     (browser-free)   (browser-free)     (Chrome MCP, Suno)
 API fetch)     railway ssh      railway ssh        suno.com web UI
```

Stages 1 and 2 run browser-free over `railway ssh`. Only Stage 3 (Suno round-trip) needs a browser. The bootstrap step uses Dash for reference-track suggestion and parallel API fetches for decompose.

## Pre-flight (read this first)

**Working directory:** every `railway ssh` call must run from the monorepo root (`entuned-0.3/`). From `~/Desktop/entuned/` one level up, `railway ssh` fails with `No linked project found`. Always prefix with `cd entuned-0.3 &&`.

**SSH auth:** `railway ssh` uses `~/.ssh/railway_ed25519` (passphrase-less ed25519). `~/.ssh/config` has a `Host ssh.railway.com` block pinning that key with `IdentitiesOnly yes`, so auth works flag-free. Do NOT pass `--identity-file`. If you get `Permission denied (publickey)`, check `~/.ssh/config` still has the Host block and `railway ssh keys list` still shows the `railway-cli` key — see `entuned-0.3/CLAUDE.md` → Railway SSH.

## Step 0 — Resolve targets (REQUIRED)

`ARGUMENTS` must specify all three of `client`, `location`, `icp` (or IDs directly), plus the target `outcomes` (csv of `Outcome.title`) and optional `n` per outcome. No name-guessing, no silent defaults. If anything is missing or ambiguous, fail loudly with the candidate list — never pick.

Canonical rule + cascade: [GENERATION.md](../../../../../GENERATION.md) → "Canonical target resolution". Memory pins: `feedback_pipeline_target_specification`, `project_free_tier_vs_song_builder`.

Run the cascade via `railway ssh` (same form as `draft-hooks` Step 0) to capture `CLIENT_ID`, `STORE_ID`, `ICP_ID`, and the resolved `Outcome` map. Pass these IDs through to each delegated skill — don't re-resolve at each stage.

## Tools

- **Chrome MCP** (`mcp__Claude_in_Chrome__*`) for all browser interactions. Load via ToolSearch at the start of each context segment.
- **Direct API calls** via `fetch()` from the Dash tab — auth header is `Authorization: Bearer ${localStorage['entuned.admin.token']}`. Use this for batch ops like `decompose-all`, `accept-all`, etc. Much faster than UI clicks.
- **Railway SSH** for direct DB queries (verify state, list ICPs by client, count songs in lineage). `cd entuned-0.3 && railway ssh "..."`.

## Setup notes

- Dash login screen flashes briefly even when authed — wait ~500ms after navigating to `dash.entuned.co/`. If the URL hash includes any authed route (`#workflows`, `#catalogue`, `#brand/Location`), treat as logged in.
- API base is `https://api.entuned.co`. All admin routes are prefixed `/admin`.
- Auth token in localStorage key: `entuned.admin.token`.
- Suno is at `suno.com/create`, Advanced mode (was "Custom" pre-v5.5).

## Step 0 — Bootstrap an empty ICP (if needed)

Self-serve ICPs from `app.entuned.co` intake start empty (no refs, no hooks, no default outcome). Curated ICPs may already have these. Run only the parts that aren't done yet — check current state first by reading the Launch Checklist gates for the store.

The 7 Launch Checklist gates (see `apps/admin/src/panels/workflow/PreLaunchChecklist.tsx`):

1. **Location config** — store has `timezone` AND `defaultOutcomeId`
2. **ICPs** — store has ≥1 ICP
3. **Approved hooks** — every ICP at the store has ≥1 approved hook
4. **Reference tracks decomposed** — every ICP has ≥1 reference track with a styleAnalysis row
5. **Pool depth (default outcome)** — every ICP has non-critical pool for the default outcome
6. **Outcome schedule** — store has ≥1 schedule slot (NOT a generation blocker)
7. **Player paired** — store has recent playback events (NOT a generation blocker)

To make songs for a single ICP under a store, you only need gates 3, 4, 5 (the ICP's row), plus a default outcome on the store. Gates 6 and 7 are for go-live, not generation.

### Step 0a — Set default outcome (if missing)

11 named outcomes in the live system. Free-tier stores use Chill / Steady / Upbeat (mood only, no lyrical priming). Boost stores unlock all 8 behavioral outcomes below.

Boost outcomes — `title` is the internal/hook-gen name; Dash + player show the display label:

| title (code / hook-gen) | Display label (Dash / player) | KPI |
|---|---|---|
| Linger | Stay & Browse | Dwell time |
| Browse to Buy | Help Them Decide | Conversion |
| Value Lift | Trade Them Up | AOV |
| Add Items | Fill the Basket | UPT |
| Impulse | Grab It Now | Conversion (spontaneous) |
| Move Through | Keep It Moving | Throughput |
| Brand Match | Our Sound | Brand affinity |
| Status Lift | Swagger Spend | AOV (bravado) |

Heuristic for picking from ICP psychographic intake:
| ICP signal | → title to use |
|---|---|
| "browsing", "looking around", "discover" | Browse to Buy |
| "in and out", "low patience", "task-oriented" | Move Through |
| "wants to stay", "relaxed", "linger" | Linger |
| "high-energy", "impulsive", "spontaneous" | Impulse |
| "wants to spend more", "treat myself" | Value Lift |
| "brand loyalty", "our aesthetic" | Brand Match |
| (default if unsure) | Browse to Buy |

Set via Clients → Location tab → "Default outcome" dropdown → save changes.

### Step 0b — Reference tracks (if `referenceTracks: []`)

Workflows → Reference Tracks tab → click "suggest reference tracks". Suggestion run takes ~30-60s and returns ~30 candidates (typical: 33). Click "approve all" to accept the whole batch.

Then decompose them. The UI only does per-track decompose, but `POST /admin/reference-tracks/:id/decompose` works in parallel. Fire 8 in parallel via `fetch` from the Dash tab:

```js
const ids = [/* uuids from GET /admin/reference-tracks?icpId=... or DB */];
const headers = { 'authorization': 'Bearer ' + localStorage.getItem('entuned.admin.token'), 'content-type': 'application/json' };
const wave = 8;
window.__decResults = {};
(async () => {
  for (let i = 0; i < ids.length; i += wave) {
    await Promise.all(ids.slice(i, i+wave).map(async id => {
      const r = await fetch(`https://api.entuned.co/admin/reference-tracks/${id}/decompose`, { method:'POST', headers, credentials:'include', body:'{}' });
      window.__decResults[id] = { ok: r.ok, status: r.status };
    }));
  }
  window.__decDone = true;
})();
```

Poll `window.__decResults` until count matches. ~33 tracks decomposes in ~135s. Gate just needs styleAnalysis row to exist (status `draft` is fine).

> Track suggestion volumes are too high — typical run returns 33 candidates and the "approve all" button takes them all. Most are never used. Future: add a curation step that scores against ICP psychographic vector and accepts top ~12.

### Step 0c — Voice notes — N/A

There is no `voiceNotes` field in the schema. The psychographic ICP fields (`values`, `desires`, `unexpressedDesires`, `turnOffs`, `fears`) carry that role.

## Step 1 — Assess current state

After bootstrap (or if ICP was already provisioned), check pool headroom against the targets in ARGUMENTS. For each `(ICP × outcome)` combo, query:

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p = new m.PrismaClient();
  const approved = await p.hook.count({ where: { icpId: \"$ICP_ID\", outcomeId: \"$OUTCOME_ID\", status: \"approved\" } });
  const inflight = await p.songSeed.count({ where: { hook: { icpId: \"$ICP_ID\", outcomeId: \"$OUTCOME_ID\" }, status: { in: [\"assembling\", \"queued\", \"accepted\"] } } });
  const queued = await p.songSeed.count({ where: { hook: { icpId: \"$ICP_ID\", outcomeId: \"$OUTCOME_ID\" }, status: \"queued\" } });
  console.log({ approvedHooks: approved, availableHooks: approved - inflight, queuedSeeds: queued });
  await p.\$disconnect();
})'"
```

Decide per-combo: skip if pool already healthy, otherwise advance to Step 2.

## Step 2 — Draft hooks (delegate to `draft-hooks`)

For each `(ICP × outcome)` where `availableHooks < n`: invoke the `draft-hooks` skill with the resolved `ICP_ID`, `OUTCOME_ID`, and target `n`. See [draft-hooks/SKILL.md](../draft-hooks/SKILL.md).

`draft-hooks` calls `draftHooks()` over `railway ssh`, trigram-dedups, persists with `status='approved'`. No browser needed.

## Step 3 — Make song seeds (delegate to `make-song-seeds`)

For each `(ICP × outcome)` where `queuedSeeds < n`: invoke the `make-song-seeds` skill with the resolved `ICP_ID`, `OUTCOME_ID`, and target `n`. See [make-song-seeds/SKILL.md](../make-song-seeds/SKILL.md).

`make-song-seeds` calls `runEno()` over `railway ssh` — produces full Suno prompts (lyrics + style + exclusions + title) tied to specific reference tracks. Each batch dumps the seeds for sanity check before Stage 4. No browser needed.

## Step 3.5 — Coverage gate (REQUIRED before populate-songs)

**Never start `populate-songs` until every requested `(ICP × outcome)` has `queuedSeeds ≥ 1`.**

Re-run the Step 1 query for every combo in ARGUMENTS. Any combo with 0 queued seeds is a gap — loop back to Step 2 or Step 3 for that combo. A partial queue produces partial results and silent coverage gaps.

## Step 4 — Suno generation (populate-songs)

Run the `populate-songs` skill. Critical points learned this run:

1. **Use 4 Suno tabs in parallel.** Per the populate-songs skill table.
2. **Slider setup** (Weirdness 75%, Style Influence 62%) needs 2 separate JS calls per slider (dblclick + setReactValue).
3. **Inject pattern**: read full prompt from `window.__seeds` on Dash tab, embed values directly in the Suno-tab JS (cross-origin blocks `window.__prompts` sharing).
4. **Verify vocal selection in a separate JS call after inject** — React state lags. Then click Create.
5. **Create silently no-ops on tabs that have just been navigated and configured** for the first time. Symptom: form values look right, sidebar empty after ~10s. Fix: vocal-toggle trick (click opposite gender, click target gender) then Create. Side effect: the original Create may also fire on retry, producing 4 takes. Accept only top 2.
6. **Wait ~60-90s per batch.** Most takes finish in 60s.
7. **Accept via API** instead of clicking through the modal:
   ```js
   await fetch(`https://api.entuned.co/admin/song-seeds/${seedId}/accept`, {
     method: 'POST', headers,
     body: JSON.stringify({ takes: uuids.map(u => ({ sourceUrl: `https://suno.com/song/${u}` })) })
   });
   ```
   Server auto-resolves `suno.com/song/UUID` → `cdn1.suno.ai/UUID.mp3` (`apps/server/src/lib/r2.ts:48`).

## Step 5 — Verify

Check 3 places:
1. **Library → Song Browser** — filter by ICP, confirm new songs appear with ACTIVE status
2. **Library → Pool Depth** (sort by `icp`) — confirm the cell for [ICP × default outcome] moved off CRITICAL
3. **DB**: `prisma.lineageRow.findMany({ where: { icpId, active: true }})` — confirms count and r2 URLs

## Failure modes

| What you see | What it means |
|---|---|
| Self-serve ICP with `referenceTracks: []`, `hooks: []` | Run Step 0b/0c first — this is expected for app-surface ICPs |
| `accept` returns 401 | Forgot the `Authorization: Bearer` header on the fetch (cookies alone don't auth admin routes) |
| Suno Create silently no-ops on first attempt | Use vocal-toggle trick, accept top 2 of resulting 4 takes |
| `accept` returns 409 `hook_already_accepted` | A previous SongSeed for this hook already accepted; skip or retire one |
| Pool Depth still 0 after accept | Check that LineageRows were created (sometimes accept transaction errors silently) |
| Suno captcha | Stop populate-songs, log it, come back when Daniel is awake |

## Done condition

Default-outcome pool for the target ICP shows a count ≥ 5 in Library → Pool Depth. Report: songs added, ICP affected, pool status (CRITICAL → THIN/OK).

## Reference

`UPGRADE_NOTES_2026-05-06.md` — full friction log from the first end-to-end self-serve run (Marissa @ hello / Core). 5 hooks → 5 prompts → 10 songs in 35.1 MB R2 storage.
