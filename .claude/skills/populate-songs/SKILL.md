---
name: populate-songs
description: Round-trip queued SongSeeds through Suno (read prompts from DB → inject into suno.com tabs → click Create → wait → scrape take UUIDs → POST accept-takes to admin API). Server downloads + re-hosts the audio on R2. Required because Suno has no API — the browser is the only interface. Use when Daniel asks to "fill the library", "run populate-songs", "generate songs for X", "make final songs", or after `make-song-seeds` produces queued prompts.
---

# populate-songs

Third and final stage of the generation pipeline:

```
draft-hooks  →  make-song-seeds  →  populate-songs (YOU ARE HERE)
   (CLI)         (CLI)               (Chrome MCP + Suno web UI)
```

Only this stage needs a browser. Stages 1 and 2 run over `railway ssh`.

## Canonical path (this is the fast one — use this)

1. Pull seed data from Prisma — no Dash navigation
2. Open N Suno tabs, configure sliders
3. Inject + Create per seed (wave-batched for N>4)
4. Wait via background bash
5. Screenshot each tab + scrape take UUIDs from `<a>` text-content matches
6. POST accept-takes to admin API in parallel via curl
7. Verify R2 fills in API response

Total time for N=5: ~5–6 min end-to-end. Most of it is two 90-second Suno render waits.

A legacy Dash-UI path exists at the bottom of this file as a fallback when railway access is unavailable. **Do not use it by default** — it's slow and modal-scraping is fragile.

## Step 0 — Load tools + verify target

Load the Chrome MCP toolkit in one shot. Keyword search returns 0 results in some shells — use the explicit `select:` form:

```
ToolSearch query: "select:mcp__Claude_in_Chrome__navigate,mcp__Claude_in_Chrome__tabs_create_mcp,mcp__Claude_in_Chrome__tabs_context_mcp,mcp__Claude_in_Chrome__javascript_tool,mcp__Claude_in_Chrome__browser_batch,mcp__Claude_in_Chrome__computer"
```

Target must be unambiguous: `client + location + icp` per [GENERATION.md](../../../../GENERATION.md) "Canonical target resolution." If `make-song-seeds` produced a specific `songSeedBatchId`, that's the simplest target — just process all queued seeds in that batch.

## Step 1 — Pull seed data from Prisma (canonical)

Get every queued seed's full prompt in one query. Use base64 for transport — `console.log` of long lyrics with newlines + em-dashes + apostrophes mangles in shell escaping.

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e '
(async () => {
  const m = await import(\"@prisma/client\");
  const p = new m.PrismaClient();
  const seeds = await p.songSeed.findMany({
    where: { songSeedBatchId: \"<BATCH_ID>\" },  // or { status: \"queued\", hook: { icpId: \"<ICP_ID>\" } }
    select: { id: true, title: true, status: true, vocalGender: true, style: true, negativeStyle: true, lyrics: true },
    orderBy: { createdAt: \"asc\" },
  });
  console.log(Buffer.from(JSON.stringify(seeds),\"utf-8\").toString(\"base64\"));
  process.exit(0);
})();
'" | tail -1 | base64 -d > /tmp/seeds.json
```

Verify locally:

```bash
node -e "const s = JSON.parse(require('fs').readFileSync('/tmp/seeds.json','utf-8')); console.log('seeds:', s.length); for (const x of s) console.log(' -', x.title, '/ vocal:', x.vocalGender, '/ lyrics:', x.lyrics.length, 'chars');"
```

Each seed object has: `id` (SongSeed UUID), `title`, `status`, `vocalGender` (`male` | `female` | `instrumental` | `unknown` | `''`), `style`, `negativeStyle`, `lyrics`.

## Step 2 — Open Suno tabs + grab admin token

```
mcp__Claude_in_Chrome__tabs_context_mcp({ createIfEmpty: true })
```

First call uses `createIfEmpty: true`. Returns the existing tab id (call it tab A). Then in one `browser_batch`:

- `tabs_create_mcp` × (N tabs needed - 1) → returns more tab ids
- `navigate` tab A to `https://suno.com/create`
- `navigate` one extra tab to `https://dash.entuned.co/` (used ONLY for grabbing the admin token; no UI interaction needed)

For **N seeds**, open **min(N, 4)** Suno tabs + 1 Dash tab. Default is 4 Suno + 1 Dash = 5 tabs total. For N=5: wave 1 fills 4 tabs, wave 2 reuses Suno tab 1 for the 5th seed.

In the next `browser_batch`, navigate the new tabs to `suno.com/create` and grab the token from the Dash tab in one shot:

```js
// In the Dash tab — returns the bearer token string
localStorage.getItem('entuned.admin.token')
```

Cache the returned token for Step 8.

## Step 3 — Configure each Suno tab (Advanced + sliders)

Per Suno tab, in a single `browser_batch`:

```js
// Activate Advanced + expand More Options
const adv = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Advanced' && b.getAttribute('data-selected') !== 'true');
adv?.click();
const mo = Array.from(document.querySelectorAll('div, span')).find(el => el.textContent.trim() === 'More Options' && el.children.length === 0);
mo?.click();
({adv: !!adv, mo: !!mo});  // should return both true on first run
```

Then set **Weirdness = 61** and **Style Influence = 61** (Daniel's defaults). Each tab has independent slider state — must repeat per tab.

The slider routine is a 2-call pattern per slider, and the keystroke version doesn't work in background tabs. Use the React setter:

```js
// Call 1: open the inline editor (dblclick the % element)
const pctEls = Array.from(document.querySelectorAll('*'))
  .filter(el => el.children.length === 0 && el.textContent.trim().match(/^\d+%$/));
// pctEls[0] = Weirdness, pctEls[1] = Style Influence
pctEls[0].dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
```

```js
// Call 2 (sequenced after dblclick): find the focused input, set value, commit
function setRV(el, v) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
  el.blur();
}
const inp = Array.from(document.querySelectorAll('input')).find(i => i.type === 'text' && i.placeholder === '' && /^\d+$/.test(i.value));
if (inp) setRV(inp, '61');
```

Repeat for `pctEls[1]` (Style Influence) with value `61`.

Verify: a final query of `pctEls.map(el => el.textContent.trim())` should return `["61%", "61%"]`.

## Step 4 — Build per-seed inject scripts

Each Suno tab gets one prompt's full inject script. Values must be inlined as JS string literals because `window.__prompts` doesn't cross origins.

Use a node helper to build the JS scripts safely (handles backticks, apostrophes, em-dashes, newlines):

```bash
node -e "
const seeds = JSON.parse(require('fs').readFileSync('/tmp/seeds.json','utf-8'));
function vocalLabel(gender, lyrics) {
  if (gender === 'female') return 'Female';
  if (gender === 'male') return 'Male';
  if (gender === 'instrumental' && !lyrics.trim()) return 'Instrumental';
  return 'Male';  // default for instrumental+lyrics, unknown+lyrics, '', etc.
}
function jsLit(s) {
  // Backtick-safe: escape backticks, backslashes, dollar-curly
  return '\`' + s.replace(/\\\\/g, '\\\\\\\\').replace(/\`/g, '\\\\\`').replace(/\\\$\\{/g, '\\\\\${') + '\`';
}
const out = {};
for (const s of seeds) {
  const vl = vocalLabel(s.vocalGender, s.lyrics);
  const js = 'function setRV(el, v) { const proto = el.tagName === \"TEXTAREA\" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, \"value\").set.call(el, v); el.dispatchEvent(new Event(\"input\", {bubbles: true})); el.dispatchEvent(new Event(\"change\", {bubbles: true})); } '
    + 'const tas = document.querySelectorAll(\"textarea\"); '
    + 'setRV(tas[0], ' + jsLit(s.lyrics) + '); '
    + 'setRV(tas[1], ' + jsLit(s.style) + '); '
    + 'const exclI = Array.from(document.querySelectorAll(\"input\")).find(i => i.placeholder === \"Exclude styles\"); '
    + 'if (exclI) setRV(exclI, ' + jsLit(s.negativeStyle) + '); '
    + 'const titleI = Array.from(document.querySelectorAll(\"input\")).filter(i => i.placeholder === \"Song Title (Optional)\").at(-1); '
    + 'if (titleI) setRV(titleI, ' + jsLit(s.title) + '); '
    + 'const target = \"' + vl + '\"; const other = target === \"Male\" ? \"Female\" : (target === \"Female\" ? \"Male\" : null); '
    // VOCAL-DESELECT recipe — required for tab reuse (wave 2) and harmless on fresh tabs
    + 'if (other) { const oBtn = Array.from(document.querySelectorAll(\"button\")).find(b => b.textContent.trim() === other); if (oBtn?.getAttribute(\"data-selected\") === \"true\") oBtn.click(); } '
    + 'const tBtn = Array.from(document.querySelectorAll(\"button\")).find(b => b.textContent.trim() === target); '
    + 'if (tBtn?.getAttribute(\"data-selected\") !== \"true\") tBtn?.click(); '
    + '({title: ' + jsLit(s.title) + ', vocal: target});';
  out[s.id] = { title: s.title, vocal: vl, js };
}
require('fs').writeFileSync('/tmp/inject.json', JSON.stringify(out, null, 2));
for (const [id, v] of Object.entries(out)) console.log(v.title, '|', v.vocal);
"
```

**Why the vocal-deselect block matters:** Suno's vocal buttons are toggles — clicking the already-selected gender DESELECTS it. On wave 2 (reused tab), the previously-set gender will still be selected. If you click Male without deselecting Female, both end up in an ambiguous state and Create silently no-ops. The recipe above ALWAYS deselects the "other" gender first if it's selected, then selects the target. Safe on both fresh and reused tabs.

## Step 5 — Inject + verify + Create (wave-batched)

**For N seeds, plan waves of 4.** Suno Pro tested at 4-parallel; 5+ untested.

- **Wave 1:** inject seeds 1–4 into tabs 1–4
- **Wave 2 (if N>4):** inject seeds 5+ into reused tabs 1, 2, ... in order

For each wave, in one `browser_batch`:

```
javascript_tool(tabId: tab1, text: <inject JS for seed 1>)
javascript_tool(tabId: tab2, text: <inject JS for seed 2>)
javascript_tool(tabId: tab3, text: <inject JS for seed 3>)
javascript_tool(tabId: tab4, text: <inject JS for seed 4>)
```

(The inject JS text comes from `/tmp/inject.json` from Step 4.)

**Then verify vocals in a separate call** — React's `data-selected` reflects the previous render, so this MUST be a follow-up call, not in the same batch as the inject:

```js
Array.from(document.querySelectorAll('button'))
  .filter(b => ['Male', 'Female', 'Instrumental'].includes(b.textContent.trim()))
  .map(b => ({label: b.textContent.trim(), sel: b.getAttribute('data-selected')}));
```

Exactly one of {Male, Female, Instrumental} should have `sel === "true"` on each tab. If none — Create will silently no-op; re-run the inject's vocal section.

**Then click Create on all wave tabs in one batch:**

```js
const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create');
btn?.click(); ({clicked: !!btn});
```

## Step 6 — Wait for renders (background bash)

Suno renders take ~75–90s per batch. **Do not use a plain `sleep 90`** — the harness blocks long leading sleeps. Use `run_in_background`:

```
Bash(command: "sleep 90 && echo wait done", run_in_background: true)
```

You will receive a `task-notification` when it completes. Don't poll; don't schedule shorter sleeps as a workaround.

**The `ScheduleWakeup` tool only works in `/loop` dynamic mode** — not appropriate for one-shot generation runs.

## Step 7 — Screenshot + scrape UUIDs

Suno sidebar virtualization: non-focused tabs do NOT render the song list in the DOM. A JS query on a background tab returns just nav links. **A `mcp__Claude_in_Chrome__computer` screenshot brings the tab to focus and forces sidebar render.**

For each Suno tab (do them in one `browser_batch`):

```
mcp__Claude_in_Chrome__computer({ action: "screenshot", tabId: <tab> })
javascript_tool(tabId: <tab>, text: <UUID scan script>)
```

UUID scan script per tab (replace `<TITLE>` with the seed's title):

```js
// Click "Show new clips ↑ N" if Suno is hiding them
const sn = Array.from(document.querySelectorAll('button')).find(b => /show new clips/i.test(b.textContent));
sn?.click();
// Scan for the title — title-match beats href-based scan because spinning cards have <a> text content before the href transitions
const links = Array.from(document.querySelectorAll('a'))
  .filter(a => a.textContent.trim() === '<TITLE>')
  .map(a => ({uuid: a.href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0], href: a.href}));
({takes: links});
```

Each seed must produce **exactly 2 takes**. If <2: generation isn't done — re-screenshot + re-scan after another 20s.

## Step 7.5 — Pre-accept render check (DO NOT SKIP)

The take URLs become valid in the DOM **before** the audio finishes rendering on Suno's CDN. If you accept while a take is still spinning, the server-side R2 download will hit a 404.

**Visual check from the screenshots in Step 7:** each take card shows either a duration (e.g. `1:47`, `2:26`) when ready, or a spinning loader icon when still rendering. **If any take in your batch shows a spinner, wait another 20–30s** (background bash again) before proceeding to Step 8.

## Step 8 — Accept via admin API (parallel curl)

Skip the Dash modal entirely. POST to `/admin/song-seeds/:id/accept` for each seed in parallel.

Bash recipe — paste the cached admin token from Step 2 into `$TOKEN`, then call `accept` once per seed in the background, `wait` for all:

```bash
TOKEN='<the bearer token from Step 2>'
accept() {
  local TITLE=$1 SEED_ID=$2 U1=$3 U2=$4
  echo "=== $TITLE ($SEED_ID) ==="
  curl -sS -X POST "https://api.entuned.co/admin/song-seeds/$SEED_ID/accept" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"takes\":[{\"sourceUrl\":\"https://suno.com/song/$U1\"},{\"sourceUrl\":\"https://suno.com/song/$U2\"}]}" \
    -w "\nHTTP %{http_code}\n"
}
export -f accept; export TOKEN

accept "Drifting"    "34d9757d-..." "343bea42-..." "108cf58f-..." &
accept "Golden Air"  "22e0607f-..." "82f309dd-..." "c50341ab-..." &
# ... one per seed ...
wait
echo "all done"
```

Each call returns JSON with the updated `songSeed` (status should be `"accepted"`) and a `lineageRows[]` array with 2 entries, each containing an `r2Url`. **Verify `HTTP 200` and `r2Url` populated on every lineage row** — these are the URLs Daniel listens to.

## Step 9 — Return R2 URLs to the user

Collect every `lineageRows[].r2Url` from the Step 8 responses and report grouped by song. Format example:

```
## <Title> — <genre> / <vocal> / <bpm>
- take 1: https://pub-c56d67b37830400a982d07e34b528013.r2.dev/song-seeds/<seed-id>/take-1-<ts>.mp3
- take 2: https://pub-c56d67b37830400a982d07e34b528013.r2.dev/song-seeds/<seed-id>/take-2-<ts>.mp3
```

End the report with `N/N accepted · 0 failures · drafted with lyric-draft v<X> / lyric-edit v<Y>`.

---

## Edge cases

| Symptom | Cause | Fix |
|---|---|---|
| `taCount: 6` (not 4) when reusing a tab | Workspace sidebar adds song-card textareas after a Create completes | `tas[0]` (lyrics) and `tas[1]` (style) are still the form's textareas — additions are AFTER. Safe to ignore. |
| `mcp__Claude_in_Chrome` (no method) error | Wrong tool name | Correct names: `mcp__Claude_in_Chrome__browser_batch`, `mcp__Claude_in_Chrome__javascript_tool`, `mcp__Claude_in_Chrome__computer`, `mcp__Claude_in_Chrome__tabs_context_mcp`, `mcp__Claude_in_Chrome__tabs_create_mcp`, `mcp__Claude_in_Chrome__navigate` |
| ToolSearch `"Claude_in_Chrome"` returns 0 results | Keyword search doesn't always match Chrome MCP tools | Use the explicit form: `select:mcp__Claude_in_Chrome__navigate,...` (see Step 0) |
| `sleep 90` blocked by harness | Long leading sleeps are blocked | Use `Bash(command: "sleep 90 && echo done", run_in_background: true)` and wait for task-notification |
| Vocal button shows neither `true` nor `false` after inject | React lag | Verify in a separate javascript_tool call (must be a different call from the inject) before clicking Create |
| `accept` returns 404 on r2Url | Take was still rendering at the moment of accept | Re-screenshot to check if duration now shown, then re-POST accept |
| `accept` returns 409 `hook_already_accepted` | Previous SongSeed for the same hook already accepted | Skip — the hook can only back one accepted song; either rotate the hook or delete the old SongSeed |
| Suno captcha | Suno occasionally requires human verification | **STOP.** Don't try to bypass. Report to Daniel. |
| `accept` returns 401 | Bearer token missing/expired | Re-grab `localStorage.getItem('entuned.admin.token')` from the Dash tab; tokens last ~weeks but can be invalidated |

## Done condition

All targeted SongSeed rows have `status: 'accepted'` + `r2Url` populated on both lineage rows. Report includes:

- N prompts accepted / N requested
- ICP affected
- Any failures (with reason)
- The R2 URLs grouped by song (this is what Daniel listens to)

---

## Fallback: legacy Dash-UI flow (use only if railway access is unavailable)

The pre-v2 path read seed prompts by clicking through Dash modal scrapes and accepted takes by clicking through the Dash accept-takes modal. This is **5+ minutes slower** per batch and exposes you to React text-input race conditions, long-lyric chunk-read truncation, and modal scoping bugs.

Use it ONLY if `railway ssh` is unavailable (e.g., Railway down, no project link). Otherwise the canonical path above is dramatically more reliable.

If you must use the legacy path:

1. Open Dash at `https://dash.entuned.co/#workflows`
2. Set the 3 page-level `<select>` dropdowns (Client / Location / ICP) to match your target — they cascade, so wait ~1s between each set
3. Click the `Pipeline` button to surface the queued-seeds list
4. For each seed: click the row to open the modal, scope queries to the modal by walking up from the `"Song Prompt"` heading, read 3 textareas + 3 inputs + 1 select; close modal; inject into matching Suno tab; click Create
5. Use Suno + wait per Steps 6–7 above
6. For accept: click each seed row, paste both URLs into `take 1` / `take 2` inputs, click `accept takes` button

The pre-v2 SKILL.md is in git history if you need the full per-step recipe. But again — use the canonical path. Don't.
