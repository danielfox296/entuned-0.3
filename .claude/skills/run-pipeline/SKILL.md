---
name: run-pipeline
description: Full music generation pipeline for any client/store/ICP — from empty pool to songs in Dash. Bootstraps the ICP if needed (default outcome, reference tracks, decompose, hooks), then runs Hook→Prompt and populate-songs. Use when Daniel says "fill the library", "run the pipeline", or "generate songs for X" — works for both curated ICPs (Gary @ UNTUCKit) and ICPs created via the app surface (app.entuned.co self-serve intake).
---

# run-pipeline

Runs the complete music generation pipeline end-to-end:

```
[Bootstrap] → Hook Writing → Hook→Prompt → Suno generation → Dash library
              (seed-hooks)                  (populate-songs)
```

The skill resolves the target client / store / ICP from `ARGUMENTS`. Both curated ICPs (Gary @ UNTUCKit) and self-serve ICPs (created via `app.entuned.co` intake) work the same way — Dash is the source of truth for both.

## Resolve targets from ARGUMENTS

`ARGUMENTS` should specify (or imply):
- `clientId`, `storeId`, `icpId` — the three IDs the workflow filters on
- `icpName` for human-readable logging
- Optional: a target outcome (otherwise: use the store's `defaultOutcomeId`, or fall back to "Convert Browsers" if none set)

If only a name is given, query Dash for the IDs:
- `GET /admin/clients` → find `companyName`
- `GET /admin/stores` → find by `clientId`
- The ICP list comes from `client.icps` or `store.icps` in detail GETs

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

The live system has 9 named outcomes: **Calm, Lift Energy, Reinforce Brand, Convert Browsers, Move Through, Linger, Impulse Buy, Increase Order Value, Add More Items**. Pick from those.

Heuristic for picking from ICP psychographic intake:
| ICP signal | → Outcome |
|---|---|
| "browsing", "looking around", "wow item" | Convert Browsers |
| "in and out", "low patience", "task-oriented" | Move Through |
| "wants to feel relaxed", "calm" | Calm |
| "high-energy", "stimulus-driven" | Lift Energy |
| (default if unsure) | Convert Browsers |

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

### Step 0c — Voice notes — SKIP

GENERATION.md mentions `corporateIcp.voiceNotes` / `storeIcp.voiceNotes` — that field does NOT exist in the current schema. The psychographic ICP fields (`values`, `desires`, `unexpressedDesires`, `turnOffs`, `fears`) carry that role now. No action needed.

## Step 1 — Assess current state

After bootstrap (or if ICP was already provisioned), navigate to Workflows → Launch Checklist and read which gates are still red. For a single-ICP test, check:
- Marissa's hook count under Workflows → Hook Writing
- Marissa's reference track count under Workflows → Reference Tracks
- Marissa's pool count for default outcome under Library → Pool Depth (sort by `icp`)

## Step 2 — Hook Writing

Workflows → Hook Writing → click the target outcome card → "generate 5 drafts".

Then approve all 5 via API in one batch (faster than UI clicks):
```js
const ICP_ID = '...'; const headers = { 'authorization': 'Bearer ' + localStorage.getItem('entuned.admin.token') };
const hooks = await (await fetch(`https://api.entuned.co/admin/icps/${ICP_ID}/hooks`, { headers })).json();
const drafts = hooks.filter(h => h.status === 'draft');
await Promise.all(drafts.map(h => fetch(`https://api.entuned.co/admin/hooks/${h.id}/approve`, { method:'POST', headers, body:'{}' })));
```

For a fuller library, generate hooks for each outcome you want covered (each call is cheap).

## Step 3 — Hook → Prompt (seed-builder)

Workflows → Hook → Prompt → click the target outcome card → "seed N for [Outcome]". This invokes the Eno seed builder which produces full Suno prompts (lyrics + style + exclusions + title) tied to specific reference tracks. Takes ~30-60s for 5.

Verify in DB:
```bash
GET /admin/song-seeds?icpId=...&status=queued
```

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
