---
name: populate-songs
description: Populate a library in Dash (dash.entuned.co) by round-tripping prompts to Suno and pasting the share link back. Use when Daniel asks to fill out a library, generate songs for a store/entity, or "run Dash → Suno → Dash" loop.
---

# populate-songs

Round-trip song generation: read all queued prompts from Dash, generate in Suno, accept URLs back into Dash.

## Tools

- **Chrome MCP** (`mcp__Claude_in_Chrome__*`) for all browser actions. Both Dash and Suno are pre-logged-in.
- Load Chrome MCP tools at the start of each session via ToolSearch before doing anything.
- Use `browser_batch` for visual coordinate clicks when JS `.click()` silently no-ops (see friction notes).

## Suno mode

The lyrics/style input mode is called **"Advanced"** in Suno v5.5 (previously "Custom"). Click the "Advanced" button in the top bar to activate it. Textareas won't be present in Simple mode.

## Tab count

| Queue size | Tabs | Batches | ~Time |
|---|---|---|---|
| 1–2 | 2 | 1 | ~2 min |
| 3–4 | 4 | 1 | ~2 min |
| 5–8 | 4 | 2 | ~4 min |
| 9+ | 4 | ceil(N/4) | ~2 min/batch |

**Default to 4 tabs.** Suno Pro has no rate limiting at 4 parallel. Open all 4 before touching Dash.

## Session setup (do this once, upfront)

### Step 1 — Open 4 Suno tabs

```js
// You'll have one existing tab. Open 3 more:
// tabs_create_mcp × 3, navigate each to https://suno.com/create
```

Note tab IDs: A, B, C, D.

### Step 2 — Click Advanced + set sliders on all 4 tabs

Do each tab sequentially (sliders are per-tab state):

```js
// On each tab:
Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Advanced')?.click();
```

Then set **Weirdness to 75%** and **Style Influence to 62%** on each tab. These must be set in **two separate JS calls per slider** — batching both in one setTimeout causes both to target the same input:

```js
// Call 1 — open Weirdness input (pctEls[0] = Weirdness, pctEls[1] = Style Influence)
const pctEls = Array.from(document.querySelectorAll('*')).filter(el =>
  el.children.length === 0 && el.textContent.trim().match(/^\d+%$/)
);
pctEls[0].dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));

// Call 2 — set value
function setReactValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
}
const inp = Array.from(document.querySelectorAll('input[type="text"]')).find(i => i.placeholder === '');
setReactValue(inp, '75');
inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',keyCode:13,bubbles:true}));
inp.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',keyCode:13,bubbles:true}));
inp.dispatchEvent(new KeyboardEvent('keyup',  {key:'Enter',keyCode:13,bubbles:true}));
inp.blur();
// Repeat for pctEls[1] → '62'
```

Verify: both % labels show correct values before continuing.

### Step 3 — Front-load ALL Dash prompt reads

**Read every queued prompt into `window.__prompts` on the Dash tab before injecting anything into Suno.** This eliminates mid-inject tab-switching.

```js
// In Dash — Song Creation Queue
window.__prompts = [];
```

For each prompt row in the queue, click to open modal, read all 5 fields, close, store:

```js
// Read fields
const tas = document.querySelectorAll('textarea');
// tas[0]=lyrics, tas[1]=style, tas[2]=exclusions, tas[3]=title, tas[4]=gender
window.__prompts.push({
  lyrics: tas[0].value,
  style: tas[1].value,
  exclusions: tas[2].value,
  title: tas[3].value,
  gender: tas[4].value
});
// Close modal
Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('✕'))?.click();
```

Repeat for all prompts you intend to generate this batch (up to 4 = one full tab cycle).

> **Lyrics and style can be long.** If a field value is truncated in the JS response, read the tail with `tas[0].value.slice(700)` in a second call and concatenate before storing.

---

## The loop

### Inject batch (after all prompts are read into `window.__prompts`)

For each tab A/B/C/D, inject `__prompts[0]`, `__prompts[1]`, etc. No Dash tab-switching needed — all data is in `window.__prompts`.

**Inject pattern (React-safe):**
```js
function setReactValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
}
const p = window.__prompts[N]; // N = 0,1,2,3
const tas = document.querySelectorAll('textarea');
setReactValue(tas[0], p.lyrics);
setReactValue(tas[1], p.style);
const exclInput = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === 'Exclude styles');
setReactValue(exclInput, p.exclusions);
const titleInput = Array.from(document.querySelectorAll('input')).filter(i => i.placeholder === 'Song Title (Optional)').at(-1);
setReactValue(titleInput, p.title);

// Vocal toggle
// gender=male → Male; gender=female → Female; gender=instrumental + non-empty lyrics → Male; gender=instrumental + empty lyrics → Instrumental
const vocal = p.gender === 'female' ? 'Female' : 'Male';
const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === vocal);
if (btn && btn.getAttribute('data-selected') !== 'true') btn.click();
```

### Create (two-call pattern per tab)

**Call 1** injects fields + sets vocal (above).

**Call 2** verifies vocal is selected, then clicks Create:
```js
// Verify vocal
const maleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Male');
const femaleBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Female');
const vocalOk = maleBtn?.getAttribute('data-selected') === 'true' || femaleBtn?.getAttribute('data-selected') === 'true';

// Click Create
Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create')?.click();
```

After clicking, **check the Create button's loading state** (not the sidebar) to confirm it fired:
```js
// The button enters a loading/disabled state immediately on success — sidebar lags 2-3s
const createBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Create');
({disabled: createBtn?.disabled, loading: createBtn?.getAttribute('aria-busy')})
```

If the button is still in its normal enabled state after 3s, Create didn't fire. Use a visual coordinate click as fallback (`browser_batch` → `computer` → `left_click` on the button coordinates from a screenshot). **Never fall back to visual click before verifying button state** — doing so risks double-submit (JS click registered but sidebar hadn't updated yet).

### Wait (~2 min)

Schedule **one wakeup for 120s** for the whole batch. Wakeup prompt needs: tab IDs, prompt titles, that's it.

### Accept batch

On wakeup, for each tab:

1. Get top-2 URLs — verify titles match what you submitted. Use **two-pass approach** (sidebar may use `href` attributes OR React fiber state depending on tab):

   **Pass 1 — attribute selector (fast):**
   ```js
   Array.from(document.querySelectorAll('[href]')).filter(el=>el.getAttribute('href')?.includes('/song/')).slice(0,4).map(el=>{const c=el.closest('li')||el.parentElement?.parentElement?.parentElement||el.parentElement;return{path:el.getAttribute('href'),text:(c?.textContent||'').trim().slice(0,50)}})
   ```

   **Pass 2 — fiber scan (fallback when Pass 1 returns []):**
   ```js
   const uuids=new Set();const texts={};document.querySelectorAll('*').forEach(el=>{const key=Object.keys(el).find(k=>k.startsWith('__reactFiber')||k.startsWith('__reactProps'));if(!key)return;const fiber=el[key];if(!fiber)return;const props=fiber.memoizedProps||fiber;const href=props?.href||props?.to;if(href&&typeof href==='string'&&href.includes('/song/')){const m=href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);if(m){uuids.add(m[0]);texts[m[0]]=(el.textContent||'').trim().slice(0,50);}}});Array.from(uuids).slice(0,4).map(u=>({uuid:u,text:texts[u]}))
   ```

   Check per-card spinner (not global spinner count):
   ```js
   Array.from(document.querySelectorAll('a[href*="/song/"]')).slice(0,2).map(a => {
     const c = a.closest('li') || a.parentElement?.parentElement?.parentElement;
     return {title: a.textContent?.trim(), hasSpinner: !!c?.querySelector('[class*="spin"]')};
   })
   ```

2. In Dash: open the matching prompt row → find take inputs via `find` tool → paste URLs via `form_input` → click "accept takes" → close modal.

3. Repeat for all tabs in the batch.

If any tab is still spinning on wakeup, reschedule 60s for just that tab.

---

## Vocal toggle rules

| Dash gender | Lyrics | → Suno |
|---|---|---|
| `male` | any | Male |
| `female` | any | Female |
| `instrumental` | non-empty | Male |
| `instrumental` | empty | Instrumental |

**Suno requires exactly one of {Male, Female, Instrumental} to have `data-selected="true"` — if none is selected, Create silently no-ops.**

---

## Captcha handling

Stop immediately. Ask Daniel before retrying.

---

## Done condition

All queued prompts have accepted Suno URLs. Report: N songs added, ICP(s) affected, any failures.

---

## Friction notes

1. **Create silently no-ops with no vocal selected.** Always verify toggle before clicking Create.

2. **Dash gender="instrumental" with non-empty lyrics means Male**, not instrumental. The seeder writes this for fully-voiced songs.

3. **React state is stale within the same JS turn.** Inject in Call 1, verify + Create in Call 2.

4. **Lyrics + style often exceed the JS response truncation limit (~2KB).** Read long fields in two calls: `tas[0].value.slice(0, 700)` then `tas[0].value.slice(700)`.

5. **Style text is outcome-templated, not per-hook.** Multiple prompts in the same outcome share most of the style string. Expected behavior.

6. **Modal placeholder-based queries are stable; ref IDs are not.** Re-find inputs by placeholder on each modal open.

7. **Modal stays open after "accept takes"** — shows "downloading…" forever. Close it manually.

8. **Each Suno tab has independent vocal toggle state.** Set and verify per-tab.

9. **All Suno tabs share one account-wide sidebar.** `slice(0,2)` on tab A returns the 2 newest account-wide, not tab-A-specific. Confirm titles match before accepting.

10. **JS Create click can fire but sidebar lags 2-3s.** Check the Create button's loading/disabled state immediately after clicking — it updates before the sidebar does. Don't use visual click until you've confirmed the button is *not* in loading state after 3s.

11. **Queue display can be stale after accept.** If a prompt stays visible after accepting, open it — a green "accepted" badge means it worked. Click the refresh button to force queue to re-render. Don't re-accept blindly.

12. **Sliders must be set in separate JS calls.** Batching Weirdness + Style Influence dblclick+set in one setTimeout causes both to target the same newly-appeared input. Set Weirdness (verify 75%), then set Style Influence (verify 62%).
