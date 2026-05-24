---
name: populate-songs
description: Round-trip queued SongSeeds through Suno (dash.entuned.co → suno.com → dash.entuned.co). For each queued prompt: inject the lyrics/style/exclusions/title/vocal into a Suno tab, click Create, wait for both takes to render, paste the two URLs back into the Dash seed row, click "accept takes". Server downloads + re-hosts the audio on R2. Use when Daniel asks to "fill the library", "run populate-songs", "generate songs for X", "make final songs", or after `make-song-seeds` produces queued prompts. Required because Suno has no API — the browser is the only interface.
---

# populate-songs

The third and final stage of the generation pipeline:

```
draft-hooks  →  make-song-seeds  →  populate-songs (YOU ARE HERE)
   (CLI)         (CLI)               (browser, Suno web UI)
```

This is the only stage that needs a browser. The previous two run over `railway ssh`.

## Tools

- **Chrome MCP** (`mcp__Claude_in_Chrome__*`) — both Dash (`dash.entuned.co`) and Suno (`suno.com/create`) are pre-logged-in.
- Load Chrome MCP tools via ToolSearch at the start of each context segment.
- Use `browser_batch` heavily — most steps batch cleanly into one round trip per tab.

## Step 0 — Resolve targets (REQUIRED)

`ARGUMENTS` must specify `client`, `location`, `icp` (or IDs directly). No name-guessing, no silent defaults. If anything is missing or ambiguous, fail loudly with the candidate list — never pick.

Canonical rule + cascade: [GENERATION.md](../../../../../GENERATION.md) → "Canonical target resolution". Memory pins: `feedback_pipeline_target_specification`, `project_free_tier_vs_song_builder`.

Run the cascade via `railway ssh` (same form as `draft-hooks` Step 0) to capture `CLIENT_ID`, `STORE_ID`, `ICP_ID` and the **exact `Client.companyName` / `Store.name` / `ICP.name` strings**. The Dash dropdowns in Step 2 match by exact text, so the resolved names go into those `<select>` queries verbatim.

## How the round trip works

```
Dash (read prompt)  →  Suno tab (inject + Create)  →  wait ~75-90s
                                                        ↓
Dash (accept takes) ←  Suno tab (read 2 UUIDs)  ←  generation completes
       ↓
Server downloads + uploads to R2 + sets SongSeed.status='accepted'
```

Each prompt produces 2 takes (Suno's default). Both UUIDs go into the Dash seed row's `take 1` / `take 2` URL inputs; one click on "accept takes" triggers server-side R2 download for both.

## Tab count

| Queue size | Tabs | ~Time per batch |
|---|---|---|
| 1–2 | 1 | ~3 min |
| 3–4 | 4 | ~3 min |
| 5–8 | 4 | ~3 min × ceil(N/4) |
| 9+ | 4 | ~3 min × ceil(N/4) |

**Default to 4 tabs.** Suno Pro has no rate limiting at 4 parallel. Open all 4 before touching Dash.

---

## Step 0 — Open N Suno tabs + navigate

```js
// tabs_create_mcp × N, then for each:
// navigate to https://suno.com/create
```

Wait ~4s after the last navigate for all tabs to render.

## Step 1 — Per Suno tab: Advanced mode + More Options + sliders

Suno v5.5 hides the sliders behind a collapsed "More Options" panel inside Advanced mode. Per tab:

```js
// Activate Advanced (if not already) + expand More Options
const adv = Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'Advanced' && b.getAttribute('data-selected') !== 'true');
adv?.click();
const moreOpt = Array.from(document.querySelectorAll('div, span'))
  .find(el => el.textContent.trim() === 'More Options' && el.children.length === 0);
moreOpt?.click();
```

Then set **Weirdness = 61** and **Style Influence = 61** (the default values Daniel ships with).

### Slider routine — JS-only (works in non-focused tabs)

The keystroke-based routine (`cmd+a → type → Return`) only commits values in the **focused** tab. For multi-tab work, only this React-setter routine is reliable:

```js
// Two-call pattern per slider. Call 1: open the inline editor.
const pctEls = Array.from(document.querySelectorAll('*'))
  .filter(el => el.children.length === 0 && el.textContent.trim().match(/^\d+%$/));
// pctEls[0] = Weirdness, pctEls[1] = Style Influence
pctEls[0].dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
```

```js
// Call 2 (after ~1s): find the now-focused input, set value, commit.
function setRV(el, v) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
  el.blur();
}
const inp = Array.from(document.querySelectorAll('input'))
  .find(i => i.type === 'text' && i.placeholder === '' && /^\d+$/.test(i.value));
if (inp) setRV(inp, '61');
```

Repeat the two-call pattern for `pctEls[1]` (Style Influence) with value `61`.

**Verify:** in a third call, query `pctEls` again — both labels should read `"61%"`.

---

## Step 2 — Dash: switch to the target Client/Location/ICP

Open Dash in its own tab: `https://dash.entuned.co/#workflows`

The Workflows panel has 3 page-level `<select>` dropdowns at the top: **CLIENT**, **LOCATION**, **ICP**. They cascade — Location options populate after Client is set, ICP options after Location.

Use the resolved Client / Location / ICP names from Step 0 verbatim — these are the exact strings the Dash `<option>` text contains.

```js
function setSel(sel, val) {
  const nv = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  nv.call(sel, val);
  sel.dispatchEvent(new Event('change', {bubbles: true}));
}
const sels = Array.from(document.querySelectorAll('select'));
// sels[0] = Client, sels[1] = Location, sels[2] = ICP
const opt = Array.from(sels[0].options).find(o => o.textContent.trim() === '<CLIENT_NAME>');
setSel(sels[0], opt.value);
// wait ~1s for Location options to populate, then sels[1] with '<LOCATION_NAME>'
// wait ~1s for ICP options to populate, then sels[2] with '<ICP_NAME>'
```

## Step 3 — Click the Pipeline sub-tab

```js
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'Pipeline')?.click();
```

The bottom of the Pipeline panel shows `N prompts queued — click to review` followed by a list of queued seed rows.

---

## Per-prompt loop

For each Suno tab (1 to N), pick one prompt from the Dash queue and run:

### 1. Open the seed row in Dash

Each row has the hook text + outcome + ref track. Find the row by its title (e.g., `Just Need This`):

```js
const target = 'Just Need This';
const row = Array.from(document.querySelectorAll('div'))
  .filter(el => el.textContent.includes(target) && el.textContent.length < 200 && getComputedStyle(el).cursor === 'pointer')
  .sort((a, b) => b.textContent.length - a.textContent.length)[0];
row?.click();
```

Wait ~2s for modal to render.

### 2. Read all fields from the modal

The modal contains 3 textareas (lyrics / style / style-exclusions), 3 inputs (title + 2 take-URL slots), and 1 select (vocal gender). Page-level `<select>`s (the client/location/ICP at top) also exist — scope queries to the modal:

```js
// Find the modal container by walking up from the "Song Prompt" heading
const heading = Array.from(document.querySelectorAll('*'))
  .find(el => el.children.length === 0 && el.textContent.trim() === 'Song Prompt');
let modal = heading;
while (modal && modal.tagName !== 'BODY') {
  if (modal.querySelectorAll('textarea').length >= 3 && modal.querySelector('select')) break;
  modal = modal.parentElement;
}

const tas = modal.querySelectorAll('textarea');
// NOTE: querySelectorAll('input[type="text"]') returns [] because Dash's React
// doesn't set type as an HTML attribute. Use input + filter by .type prop:
const titleI = Array.from(modal.querySelectorAll('input'))
  .find(i => i.type === 'text' && !i.placeholder.startsWith('take'));
const genSel = modal.querySelector('select');

window.__prompts = window.__prompts || {};
window.__prompts[N] = {  // N = the index of the Suno tab this prompt goes to
  lyrics: tas[0].value,
  style: tas[1].value,
  exclusions: tas[2].value,
  title: titleI.value,
  gender: genSel.value,  // 'male' | 'female' | 'instrumental' | ''
};
```

**Long fields (>800 chars) get truncated in the JS-tool response.** Read them in chunks in follow-up calls: `window.__prompts[N].lyrics.slice(800)`, etc. The full text is stored in `window.__prompts` even when the response truncates.

### 3. Close the Dash modal

```js
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'close ✕')?.click();
```

### 4. Inject into the matching Suno tab

The Suno modal has 4 textareas. Only the first 2 are used; ignore the other 2 (song-idea / sound-description):

```js
const p = window.__prompts[N];  // values must be inlined as JS literals; window state doesn't cross origins
function setRV(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
}
const tas = document.querySelectorAll('textarea');
setRV(tas[0], p.lyrics);
setRV(tas[1], p.style);
const exclI = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === 'Exclude styles');
setRV(exclI, p.exclusions);
const titleI = Array.from(document.querySelectorAll('input'))
  .filter(i => i.placeholder === 'Song Title (Optional)').at(-1);
setRV(titleI, p.title);

// Vocal toggle — pick label per gender rules below
const vocalLabel = p.gender === 'female' ? 'Female' : (p.gender === 'instrumental' && !p.lyrics.trim() ? 'Instrumental' : 'Male');
const vBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === vocalLabel);
const wasSelected = vBtn?.getAttribute('data-selected') === 'true';
if (!wasSelected) vBtn?.click();
```

**Cross-origin caveat:** `window.__prompts` on the Dash tab is NOT readable from Suno tabs. The values for each prompt must be inlined into the inject JS as string literals. Use template literals (backticks) for the lyric — they handle newlines and apostrophes natively. Beware: backticks and `${` in the source require escaping; in practice the lyric content rarely contains either.

### Vocal toggle rules

| Dash `gender` | Lyrics | → Suno button |
|---|---|---|
| `male` | any | Male |
| `female` | any | Female |
| `instrumental` | non-empty | Male |
| `instrumental` | empty | Instrumental |
| `''` / `unknown` / anything else | non-empty | Male |
| `''` / `unknown` / anything else | empty | Instrumental |

Suno requires exactly one of {Male, Female, Instrumental} to have `data-selected="true"`. If none is selected, Create silently no-ops. **Vocal buttons are toggles** — clicking the already-selected gender DESELECTS it. Always check `data-selected` before clicking.

### 5. Verify vocal in a separate call (React lag)

React's `data-selected` attribute reflects state from the previous render. Verify in a follow-up call:

```js
Array.from(document.querySelectorAll('button'))
  .filter(b => ['Male', 'Female', 'Instrumental'].includes(b.textContent.trim()))
  .map(b => ({label: b.textContent.trim(), sel: b.getAttribute('data-selected')}));
```

If the target gender shows `sel === 'true'`, ready to fire Create.

### 6. Click Create

```js
Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create')?.click();
```

When firing Create across multiple tabs, do it in a single `browser_batch` with one javascript_tool per tab. All 4 Creates fire reliably; no race conditions observed.

---

## Wait

Schedule one ~75-90s wakeup for the whole batch. Songs typically finish in under 90s.

## Per-tab collect URLs

When the wait finishes, for each Suno tab:

### 1. Force the tab to render its sidebar

**Sidebar virtualization:** non-focused Suno tabs do NOT render the sidebar songs list in the DOM. A JS query for songs on a background tab returns just nav links (~19 items, no song entries). Bring the tab into focus first — a `screenshot` call activates the tab and forces render:

```
computer.screenshot(tabId: <suno tab>)
```

### 2. Click "Show new clips" if present

When new clips arrive while a tab is in the background, Suno shows a `Show new clips ↑ N` notification badge instead of auto-appending them to the sidebar. Click it:

```js
const sn = Array.from(document.querySelectorAll('button'))
  .find(b => /show new clips/i.test(b.textContent));
sn?.click();
```

The button only appears when there are new unrendered clips for this tab.

### 3. Scan for the title

```js
Array.from(document.querySelectorAll('a'))
  .filter(a => a.textContent.trim() === '<TITLE>')
  .map(a => ({
    uuid: a.href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0],
    href: a.href,
  }));
```

This returns both takes. Title-matching beats `a[href*="/song/"]` because spinning cards have `<a>` text content even when the href hasn't transitioned to `/song/UUID` yet.

If you get fewer than 2 takes, the generation isn't done yet. Wait another 30s and re-query (after another screenshot to keep the tab focused).

---

## Accept in Dash

For each prompt with 2 captured UUIDs, in the Dash tab:

```js
// 1. Click the row to open the modal
const target = '<TITLE>';
const row = Array.from(document.querySelectorAll('div'))
  .filter(el => el.textContent.includes(target) && el.textContent.length < 200 && getComputedStyle(el).cursor === 'pointer')
  .sort((a, b) => b.textContent.length - a.textContent.length)[0];
row?.click();
```

Wait ~2s.

```js
// 2. Set both take URLs + click accept-takes
function setRV(el, v) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
}
const t1 = document.querySelector('input[placeholder^="take 1"]');
const t2 = document.querySelector('input[placeholder^="take 2"]');
setRV(t1, 'https://suno.com/song/<UUID_1>');
setRV(t2, 'https://suno.com/song/<UUID_2>');
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'accept takes')?.click();
```

Wait ~4s. The modal auto-closes; the queue count decrements; the outcome card's "accepted" badge increments.

### Verification

Don't rely on `document.querySelector('Song Prompt heading')` going null — there's a small animation window where it lingers. The reliable signals:

1. **Queue count decreases** by 1 (top of Pipeline: `N prompts queued — click to review`)
2. **Outcome card's "accepted" badge** increments by 1
3. **DB ground truth:**

```bash
railway ssh "cd /app && node -e 'import(\"@prisma/client\").then(async m=>{
  const p = new m.PrismaClient();
  const s = await p.songSeed.findFirst({
    where: { title: \"<TITLE>\" },
    include: { lineageRows: { include: { song: true } } },
    orderBy: { createdAt: \"desc\" }
  });
  console.log({status: s.status, lineageCount: s.lineageRows.length, r2Filled: s.lineageRows.every(lr => !!lr.song?.r2Url)});
  await p.\$disconnect();
})'"
```

Successful end state: `status: 'accepted'`, `lineageCount: 2`, `r2Filled: true`. R2 upload typically completes within ~2-5 seconds of `accept takes`.

---

## Friction surviving from past sessions

These are the bites worth keeping in mind:

1. **Captcha → STOP.** Suno occasionally shows a captcha. Don't try to bypass — stop and ask Daniel.
2. **Long lyrics chunk-read.** JS-tool responses truncate at ~1000 chars. For lyrics > 800 chars, read in chunks: `field.slice(0, 800)` then `field.slice(800)`. The full value is in the DOM regardless of response truncation.
3. **Each Suno tab has independent slider state.** Setting Weirdness 61 on tab A does NOT propagate to tabs B/C/D. Run Step 1 on every tab.
4. **Style strings already obey Suno's 1000-char cap.** make-song-seeds writes styles within that limit; don't need to slice further.
5. **Sidebar Filters(3).** Suno's sidebar may show "Filters (3)" active, but the title-match `<a>` query bypasses it.
6. **Account-wide sidebar.** All Suno tabs see the same account-wide song list. When scanning tab N's sidebar, filter by title to disambiguate from songs generated on other tabs.

## Done condition

All queued prompts that this batch targeted have `status='accepted'` + `r2Url` populated on both lineage rows. Report: N prompts accepted, ICP(s) affected, any failures.
