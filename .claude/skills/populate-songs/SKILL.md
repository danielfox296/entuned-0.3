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

## Pre-flight (read this first)

**Working directory:** every `railway ssh` call must run from the monorepo root (`entuned-0.3/`). From `~/Desktop/entuned/` one level up, `railway ssh` fails with `No linked project found`. Always prefix with `cd entuned-0.3 &&` (already in the Step 1 recipe below; preserve it in any new calls).

**SSH auth:** `railway ssh` uses `~/.ssh/railway_ed25519` (passphrase-less ed25519). `~/.ssh/config` has a `Host ssh.railway.com` block pinning that key with `IdentitiesOnly yes`, so auth works flag-free. Do NOT pass `--identity-file`. If you get `Permission denied (publickey)`, check `~/.ssh/config` still has the Host block and `railway ssh keys list` still shows the `railway-cli` key — see `entuned-0.3/CLAUDE.md` → Railway SSH.

## Step 0 — Load tools + verify target

Load the Chrome MCP toolkit in one shot. Keyword search returns 0 results in some shells — use the explicit `select:` form:

```
ToolSearch query: "select:mcp__Claude_in_Chrome__navigate,mcp__Claude_in_Chrome__tabs_create_mcp,mcp__Claude_in_Chrome__tabs_context_mcp,mcp__Claude_in_Chrome__javascript_tool,mcp__Claude_in_Chrome__browser_batch,mcp__Claude_in_Chrome__computer"
```

Target must be unambiguous: `client + location + icp` per [GENERATION.md](../../../../GENERATION.md) "Canonical target resolution." If `make-song-seeds` produced a specific `songSeedBatchId`, that's the simplest target — just process all queued seeds in that batch.

## Step 1 — Pull seed data from Prisma (canonical)

Get every queued seed's full prompt in one query. Use base64 for transport — `console.log` of long lyrics with newlines + em-dashes + apostrophes mangles in shell escaping.

**Always filter `engine: "suno"`.** This skill is Suno-only. Google Flow (Lyria) seeds carry `engine: "flow"` and a Flow-shaped payload (`style` = sound-world prose, `lyrics` = a `[mm:ss]` timeline) that must NEVER be injected into Suno. The filter keeps Flow seeds out of the queue. Existing/Suno seeds all default to `engine: "suno"`, so nothing is lost.

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e '
(async () => {
  const m = await import(\"@prisma/client\");
  const p = new m.PrismaClient();
  const seeds = await p.songSeed.findMany({
    where: { engine: \"suno\", songSeedBatchId: \"<BATCH_ID>\" },  // or { engine: \"suno\", status: \"queued\", hook: { icpId: \"<ICP_ID>\" } }
    select: { id: true, title: true, status: true, vocalGender: true, style: true, negativeStyle: true, lyrics: true },
    orderBy: { createdAt: \"asc\" },
  });
  const z = await import(\"zlib\");
  console.log(\"BEGINB64\" + z.gzipSync(Buffer.from(JSON.stringify(seeds),\"utf-8\")).toString(\"base64\") + \"ENDB64\");
  process.exit(0);
})();
'" > /tmp/raw.txt

python3 -c "
import re,base64,gzip
m=re.search(r'BEGINB64(.*?)ENDB64', open('/tmp/raw.txt').read(), re.S)
open('/tmp/seeds.json','wb').write(gzip.decompress(base64.b64decode(re.sub(r'\s','',m.group(1)))))
"
```

**Gzip + markers are required, not optional (2026-07-26).** `railway ssh` stdout truncates at
exactly 48 KB, and a plain `... | tail -1 | base64 -d` silently writes a *truncated* JSON file —
the failure surfaces much later as `SyntaxError: Unexpected end of JSON input`. A 24-seed pull is
~56 KB raw but ~14 KB gzipped, well under the cap.

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
// vocalGender on Suno is NOT a required field. Only force a button click when
// Bernie was explicit (male / female) or when the seed is truly instrumental
// (gender === 'instrumental' AND no lyrics). For everything else — duet,
// instrumental-with-lyrics, unknown, '' — return null and leave Suno's vocal
// selection alone. Suno will choose; that's correct behavior. The old default
// of 'Male' silently mis-cast duets and instrumental-with-lyrics seeds.
function vocalLabel(gender, lyrics) {
  if (gender === 'female') return 'Female';
  if (gender === 'male') return 'Male';
  if (gender === 'instrumental' && !lyrics.trim()) return 'Instrumental';
  return null;  // duet, instrumental+lyrics, unknown, '' — let Suno pick
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
    + 'const target = ' + (vl === null ? 'null' : ('\"' + vl + '\"')) + '; '
    // FORCE vocal-toggle dance UNCONDITIONALLY when target is set — click other, then click target.
    // Earlier "deselect-other-if-selected, select-target-if-not-selected" was a no-op when
    // gender was unchanged from previous wave, which made Create silently fail.
    // When target === null (duet / instrumental+lyrics / unknown), skip the toggle entirely —
    // leave Suno's vocal selection alone.
    + (vl === null
        ? '/* skip vocal toggle */ '
        : vl === 'Instrumental'
        ? 'const iBtn = Array.from(document.querySelectorAll(\"button\")).find(b => b.textContent.trim() === \"Instrumental\"); iBtn?.click(); '
        : ('const other = target === \"Male\" ? \"Female\" : \"Male\"; '
         + 'const oBtn = Array.from(document.querySelectorAll(\"button\")).find(b => b.textContent.trim() === other); oBtn?.click(); '
         + 'const tBtn = Array.from(document.querySelectorAll(\"button\")).find(b => b.textContent.trim() === target); tBtn?.click(); '))
    + '({title: ' + jsLit(s.title) + ', vocal: target});';
  out[s.id] = { title: s.title, vocal: vl ?? 'unset', js };
}
require('fs').writeFileSync('/tmp/inject.json', JSON.stringify(out, null, 2));
for (const [id, v] of Object.entries(out)) console.log(v.title, '|', v.vocal);
"
```

**Why the unconditional toggle dance matters:** Suno's vocal buttons are toggles — clicking the already-selected gender DESELECTS it. On a reused tab where the target gender is *the same* as the previous wave, a conditional "select-only-if-not-already-selected" recipe never fires the click, and Create silently no-ops on first press. The unconditional dance (click opposite, click target) always fires both clicks — React sees the state change, Suno enables Create, the first press works. Safe on fresh and reused tabs alike.

**When `target === null` (duet / instrumental+lyrics / unknown), the toggle dance is intentionally skipped** — Suno's vocal selection is left at whatever it was, and Suno picks. Field changes via `setRV` (lyrics, style, title, exclude) still dispatch input/change events, which is usually enough for React to re-enable Create on a reused tab. If you ever see Create silently no-op specifically on a null-vocal seed in a reused tab, fire the inject's other-side click manually (`Female` if previous wave used Male, or vice versa) — that's enough to re-trigger React without re-asserting a gender.

## Step 5 — Inject + verify + Create (wave-batched)

**For N seeds, plan waves of 4.** Suno Pro tested at 4-parallel; 5+ untested.

- **Wave 1:** inject seeds 1–4 into tabs 1–4
- **Wave 2 (if N>4):** inject seeds 5+ into reused tabs 1, 2, ... in order

**Interleave, don't serialize (validated on a 24-seed run, 2026-07-26).** Suno's render is the
only slow part. Once wave N's takes are scraped, inject and fire wave N+1 *first*, then accept
wave N while N+1 renders. Accepting is a `railway ssh` call that doesn't touch the browser, so it
overlaps cleanly. Serial injecting→waiting→accepting→injecting roughly doubles wall-clock.

**Inject a helper library once per tab, then pass only the seed.** Rather than building one giant
per-seed JS blob (Step 4), define `window.__clear/__focus/__paste/__fields/__verify/__create/
__scan` on each tab once, all reading from a single `window.__s` seed object. Each wave then costs
one small `window.__s = {...}` assignment plus one-word calls. Page state survives Create (the
create page is an SPA and doesn't navigate), so this holds for the whole run and makes a re-inject
after a silent no-op essentially free. Keep clear → focus → paste as three separate
`javascript_tool` calls even so — that's a Lexical constraint, not a transport one.

For each wave, in one `browser_batch`:

```
javascript_tool(tabId: tab1, text: <inject JS for seed 1>)
javascript_tool(tabId: tab2, text: <inject JS for seed 2>)
javascript_tool(tabId: tab3, text: <inject JS for seed 3>)
javascript_tool(tabId: tab4, text: <inject JS for seed 4>)
```

(The inject JS text comes from `/tmp/inject.json` from Step 4.)

**CRITICAL — Suno v5.5 lyrics field is a Lexical contenteditable, NOT a textarea (discovered 2026-07-14).** The Lyrics editor is `div.lyrics-editor-content` (`contenteditable="true"`, Lexical framework). On tabs with the new UI, `document.querySelectorAll('textarea')[0]` is the **"Ask anything" AI-chat box** — the old `tas[0]` recipe silently writes lyrics into the chat box and generates lyric-less instrumentals. This shipped 2 defective songs before it was caught (both were deactivated). A `tas[0].value.length` check does NOT catch it — it reads back the same wrong box. Some tabs still serve the old all-textarea layout, which is why the failure is intermittent.

**Working lyrics-inject recipe — three SEPARATE javascript_tool calls per tab** (Lexical applies updates asynchronously; combining these into one call drops or duplicates content):

```js
// Call 1: clear via the Lexical API (execCommand selectAll/delete is unreliable here)
const ed = document.querySelector('.lyrics-editor-content');
ed.__lexicalEditor.setEditorState(ed.__lexicalEditor.parseEditorState(
  '{"root":{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}}'));
// Call 2: focus via the Lexical API (restores an editor selection — paste no-ops without one)
document.querySelector('.lyrics-editor-content').__lexicalEditor.focus();
// Call 3: paste the lyrics as a ClipboardEvent (execCommand insertText does not stick)
const dt = new DataTransfer(); dt.setData('text/plain', LYRICS);
document.querySelector('.lyrics-editor-content').dispatchEvent(
  new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
```

Style / Exclude styles / Title are still plain elements — set them with the `setRV` React-setter pattern.

**Select the Styles textarea by `maxLength === 1000`** — it is the only stable handle. Never by
index (`textarea[0]` is the AI chat box), never by placeholder (the genre-examples string
rotates), and not by walking up to an ancestor containing the text `Styles` — that lookup works
on an empty form but stops matching once lyrics are pasted, so a pre-Create verify silently
reports `styleLen: null` on a field that is actually populated. Reference maxLengths: Styles
1000, Song Description 3000, Sound 500, chat box none.

**Verify BEFORE every Create — no exceptions**, in a separate call after a ~2s wait:

```js
const ed = document.querySelector('.lyrics-editor-content');
({brackets: (ed.textContent.match(/\[/g) || []).length,          // must equal the seed's section count
  startsIntro: ed.textContent.startsWith('['),                    // first section marker intact
  len: ed.textContent.length});                                   // = lyrics length minus newline count
```

If any check fails, redo calls 1–3. Only when the verify passes, click Create.

**CRITICAL — `btn.click()` does NOT fire Create on Suno v5.5 (discovered 2026-07-26).** A
programmatic click returns `{clicked: true, disabled: false}` and does nothing: no card appears,
no credits are drawn. Suno's handler requires a trusted event. Use a real mouse click, and
**screenshot the same tab immediately before clicking it, in the same `browser_batch`** — the
screenshot is what brings the tab to focus, and a `computer` click on an unfocused background tab
is silently dropped:

```
mcp__Claude_in_Chrome__computer({ action: "screenshot", tabId: <tab> })
mcp__Claude_in_Chrome__computer({ action: "left_click", coordinate: [<x>, <y>], tabId: <tab> })
```

Take the coordinates from that screenshot — the Create button sits at the bottom of the form
(~`[663, 679]` on a 1400×843 tab). **Confirm the credit counter dropped** (10 credits per
generation) before treating the wave as fired; that is the only reliable signal, since the form
keeps its contents either way.

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

UUID scan script per tab (replace `<TITLE>` with the seed's title). **Always scrape the duration
alongside the UUID** — the duration is the only reliable "this take is finished" signal, and a
UUID alone will happily let you accept a still-rendering or failed take:

```js
// Click "Show new clips ↑ N" if Suno is hiding them
const sn = Array.from(document.querySelectorAll('button')).find(b => /show new clips/i.test(b.textContent));
sn?.click();
await new Promise(r => setTimeout(r, 600));
// Scan for the title — title-match beats href-based scan because spinning cards have <a> text content before the href transitions
const takes = Array.from(document.querySelectorAll('a'))
  .filter(a => a.textContent.trim() === '<TITLE>')
  .map(a => {
    const uuid = (a.href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
    let el = a, dur = null;
    for (let i = 0; i < 6 && el; i++) { el = el.parentElement; const m = el && el.textContent.match(/\d+:\d\d/); if (m) { dur = m[0]; break; } }
    return { uuid, dur };
  })
  .filter(t => t.uuid);
({takes});
```

Each seed must produce **exactly 2 takes**. If <2 after the screenshot+scan: a tab silently no-op'd Create. Recover by RE-RUNNING THE FULL INJECT SCRIPT for that seed (never just toggle+Create — a no-op'd tab may have dropped the lyrics field while keeping style, and a bare retry-Create renders a lyric-less instrumental; this shipped 2 defective songs on 2026-07-14), then run the pre-Create lyrics verify, then Create. Wait another 60s and re-scan. Don't ask the operator; the silent-no-op is a known Suno quirk and the full re-inject handles it.

If `Create` silently no-ops on multiple tabs in the same wave, re-fire the dance across all those tabs in one batch and re-scan. Side effect: the original Create may also fire on retry, producing 4 takes. Just take the first 2 — those are the newest.

## Step 7.5 — Pre-accept render check

The take URLs become valid in the DOM **before** the audio finishes rendering on Suno's CDN.

**This is a hard gate, not a heuristic (tightened 2026-07-26).** Every take you are about to
accept must show a duration (`dur` non-null from the Step 7 scan). A card with no duration is
still rendering. Wait 30s and re-scan rather than accepting it.

The earlier guidance — "go straight to Step 8, the server guard catches anything that isn't
ready" — **is wrong and shipped a defective song.** The server's audio-integrity floor passes
57 KB, so a 2-second clip accepts cleanly with HTTP 200 and a populated `r2Url`. Nothing
downstream flags it. Two distinct failures both present as a short clip:

- **Still rendering** — waiting fixes it.
- **Suno-side generation failure** — the workspace card shows `Credits Refunded` and a `0:02`
  duration. Re-downloading returns byte-identical short audio; waiting never fixes it. The seed
  must be regenerated (Step 5 again) and the rows repaired via `repair-takes.mjs`.

Both are caught by the same rule: no duration, or a duration under ~0:30, means do not accept.

## Step 8 — Accept via `railway ssh` (primary path)

**The HTTP accept path is not available from a browser-driven run.** Chrome MCP's credential
filter masks the bearer: `localStorage.getItem('entuned.admin.token')` returns the literal string
`[BLOCKED: JWT token]` — deterministically, every run, not intermittently. Don't spend a round
trip discovering this; go straight to the script. (Memory: `feedback_chrome_mcp_jwt_filter`.)

Use the checked-in [`accept-song-seeds.mjs`](accept-song-seeds.mjs), which mirrors the accept
transaction in `apps/server/src/routes/admin.ts` and adds a 500 KB per-take floor. Upload it,
run it, delete it:

```bash
cd entuned-0.3
B64=$(base64 < .claude/skills/populate-songs/accept-song-seeds.mjs | tr -d '\n')
J=$(base64 < /tmp/wave.json | tr -d '\n')   # [{seedId, urls:[u1,u2]}, ...]
railway ssh "cd /app && echo '$B64' | base64 -d > _accept-seeds.mjs \
  && node --import tsx _accept-seeds.mjs '$J' && rm -f _accept-seeds.mjs"
```

Parse the `ACCEPTREPORT…ENDREPORT` payload and confirm `ok: true` plus 2 `r2` URLs per seed.

**Do not hand-author this script per run.** It duplicates a real transaction (Song upsert,
LineageRow create, status flip, `useCount` bumps on both hook and reference track); an
improvised version that forgets a side effect writes rows that look correct and silently differ
from what the browser path would have written. If the route changes, update the checked-in copy.

`error: truncated_take_<n>b` means the floor fired — the seed stays `queued`, so re-fire Create
for it (Step 5) and re-run accept once the cards show real durations. For a seed already accepted
with bad audio, use [`repair-takes.mjs`](repair-takes.mjs) instead; accept can't be re-run because
the hook is consumed.

Two gotchas on the container: every `railway ssh` must run from the monorepo root (a `cat <<EOF`
heredoc earlier in the same Bash call resets the cwd and you'll get `No linked project found`),
and Node warns about AWS SDK wanting node>=22 — that warning is noise, not a failure.

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
| Create silently no-ops (sidebar shows no new card after 60s) | Conditional vocal-toggle never fired, OR the tab dropped injected fields (lyrics can vanish while style persists) | Re-run the FULL inject script for that seed, verify lyricsLen, then Create. Never retry with toggle+Create alone — see Step 5/7 (2026-07-14 lyric-less instrumental incident) |
| Take renders but page shows no lyrics / take is instrumental when it shouldn't be | Lyrics were injected into the wrong element — on Suno v5.5 tabs `textarea[0]` is the "Ask anything" chat box; the real lyrics field is the Lexical `div.lyrics-editor-content` | Use the Lexical clear/focus/paste recipe in Step 5 and its bracket-count verify. If already accepted: deactivate the lineage rows and regenerate |
| `accept` returns 404 on r2Url | Take was still rendering at the moment of accept | Re-screenshot to check if duration now shown, then re-POST accept |
| `accept` returns `502 r2_upload_failed` | Server's audio-integrity guard fired (empty/short body or non-audio content-type from audiopipe.suno.ai — take wasn't rendered) | Wait 30–60s, re-POST that seed. Do not bypass — guard exists to prevent 0-byte R2 objects. |
| `accept` returns 409 `hook_already_accepted` | Previous SongSeed for the same hook already accepted | Skip — the hook can only back one accepted song; either rotate the hook or delete the old SongSeed |
| `__create()` returns `{clicked: true, disabled: false}` but no card appears and credits don't move | `btn.click()` is untrusted; Suno v5.5 ignores it | Use a real `computer left_click`, preceded by a `screenshot` **of the same tab in the same batch** to focus it. See Step 5. |
| Real click fires on one tab but the other 3 do nothing | Those tabs weren't focused — a `computer` click on a background tab is dropped | Never batch `click(tabA), screenshot(tabB)`. Pair every click with a screenshot of *its own* tab, immediately before. |
| Accepted song is 50–200 KB / plays for 2–8 seconds | Suno's generation itself failed (workspace card shows `Credits Refunded`), not a download race — re-downloading returns the same bytes | Deactivate those `LineageRow`s, then re-fire Create for that seed and repair the rows in place with the new audio. Always check `byteSize` after a batch: healthy takes are 1.5–5 MB. |
| Suno captcha | Suno occasionally requires human verification | **STOP.** Don't try to bypass. Report to Daniel. |
| `fetch('http://localhost:...')` from a suno.com tab hangs, then the CDP call times out at 45 s | Chrome Private Network Access blocks HTTPS→localhost | Don't serve seed data over a local HTTP server. Inline the payload into the `javascript_tool` text. |
| `localStorage.getItem('entuned.admin.token')` returns `[BLOCKED: JWT token]` | Chrome MCP credential filter — expected, deterministic, not a fault | Don't try to work around it. Step 8's `railway ssh` script is the primary accept path. |
| `railway ssh` → `No linked project found` mid-run | A `cat <<EOF` heredoc earlier in the same Bash call reset the shell cwd | Re-`cd` to the monorepo root in the same command as the `railway ssh` call. |

## Done condition

All targeted SongSeed rows have `status: 'accepted'` + `r2Url` populated on both lineage rows —
**and every new Song passes a byte-size audit.** `status: accepted` + populated `r2Url` is not
sufficient; a 2-second failed render satisfies both. Run this before reporting done:

```bash
cd entuned-0.3 && railway ssh "cd /app && node -e '
import(\"@prisma/client\").then(async m=>{
  const p=new m.PrismaClient();
  const songs=await p.song.findMany({
    where:{lineageRows:{some:{songSeed:{songSeedBatchId:{in:[<BATCH_IDS>]}}}}},
    select:{byteSize:true}});
  const bad=songs.filter(s=>!s.byteSize || Number(s.byteSize) < 500000);
  console.log(\"songs:\", songs.length, \"| under-500KB:\", bad.length,
    \"| min:\", Math.round(Math.min(...songs.map(s=>Number(s.byteSize)))/1024)+\"KB\");
  await p.\$disconnect();
})'"
```

`under-500KB` must be 0. Anything flagged gets deactivated and regenerated (Step 7.5) before you
call the batch done.

Also confirm the pool actually grew by `2 × seeds` in **active** rows. Count with
`active: true` on both sides of the comparison — a raw `lineageRow.count` includes rows
deactivated in earlier incidents and will make a correct run look short.

Report includes:

- N prompts accepted / N requested
- ICP affected. For free-tier work, say which path the songs took: generated **directly** under
  the sentinel `Free Tier` ICP (audible immediately), or generated under an archetype/paid ICP,
  which is audible to free-tier customers **only after** an operator promotes each row via Dash
  (`POST /admin/lineage-rows/:id/toggle-general`). Don't report archetype-generated songs as
  "live on the free tier" until that step has happened.
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
