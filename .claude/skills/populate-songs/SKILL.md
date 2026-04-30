---
name: populate-songs
description: Populate a library in Dash (dash.entuned.co) by round-tripping prompts to Suno and pasting the share link back. Use when Daniel asks to fill out a library, generate songs for a store/entity, or "run Dash → Suno → Dash" loop. Specifically scoped to Gary @ UNTUCKit Park Meadows on first run.
---

# populate-songs

Round-trip song generation: Dash gives you a prompt, you paste it into Suno, wait for Suno to finish, copy the share link, paste back into Dash. Repeat until library is full or something breaks.

## Mission

Fill the **Gary @ UNTUCKit Park Meadows** library in Dash. It's already partially started. Continue from wherever it left off and go until:
- The library is complete (no more empty prompts), OR
- You hit a Suno captcha (Daniel is asleep — log it and stop), OR
- Anything in Dash breaks (this is desired — log it, suggest a redesign).

## Tools

- **Chrome MCP** (`mcp__Claude_in_Chrome__*`) for everything in the browser. Both Dash and Suno are pre-logged-in and persist.
- Do NOT use computer-use for browser actions — Chrome MCP is faster and DOM-aware.
- Load Chrome MCP tools at the start of each new context segment via ToolSearch before doing anything else.

## Suno settings (set these once per session, then leave alone)

- **Weirdness:** ~65%
- **Style influence:** ~80%
- To set: double-click the `%` label next to the slider — it becomes a direct text input. Type the value, press Enter. Do NOT try to drag sliders or dispatch keyboard events.
- Verify these are still set on **both Suno tabs** at session start.

## Setup (dual-tab)

Before starting the loop, open a second Suno tab and verify both are ready:

1. Note the ID of the existing Suno tab — this is **tab A**.
2. Call `tabs_create_mcp` to open a new tab and navigate it to `https://suno.com/create` — this is **tab B**.
3. Verify tab B is logged in (same account as tab A). If either tab is logged out, stop and log it.
4. On both tabs, verify Weirdness (~65%) and Style Influence (~80%) are set correctly.
5. Verify the vocal toggle state on both tabs before any Create click (see friction notes).
6. Initialize the in-flight tracker on the Dash tab:
   ```js
   window.__flight = {}; // {sunoTabId: dashPromptTitle}
   ```

> **Two Suno tabs double throughput. Net time for 6 prompts drops from ~18 min to ~9 min. Each tab needs its own vocal toggle verification before Create is clicked.**

## The loop (optimized — dual-tab)

Each cycle submits to both tabs in parallel, then accepts from both on wakeup. Basic structure: submit prompt 1 → tab A, submit prompt 2 → tab B, wait 180s, accept from tab A + submit prompt 3, accept from tab B + submit prompt 4, repeat.

### Submit a prompt (two-call pattern — apply to each tab)

The two-call pattern is unchanged. Apply it once per tab, back-to-back, without waiting between them.

Use a **two-call pattern** to avoid stale-state bugs (see Friction notes below):

**Call 1 — read fields from Dash, then inject into Suno + set vocal toggle:**
1. Open the prompt modal in Dash (click its row in Song Creation Queue).
2. Read all five fields from Dash's textareas via JS:
   ```js
   const tas = document.querySelectorAll('textarea');
   // tas[0]=lyrics, tas[1]=style, tas[2]=exclusions, tas[3]=title, tas[4]=gender
   ```
3. Inject lyrics, style, exclusions, title into Suno (React native setter — see Proven JS patterns).
4. Set vocal selector. **Suno requires exactly one of {Male, Female, Instrumental} to be `data-selected="true"` for Create to fire.** If none is selected, Create silently no-ops.
   - `gender === 'male'` → if Male not selected, click it.
   - `gender === 'female'` → if Female not selected, click it.
   - `gender === 'instrumental'`:
     - **If lyrics are non-empty** (typical case in Dash — gender="instrumental" is misleading), keep Male selected. The lyrics + style description drive the actual vocal sound.
     - **If lyrics are empty**, click the `Instrumental` button.

**Call 2 — verify vocal toggle, click Create:**
5. Re-read Male/Female/Instrumental `data-selected` state (in a new JS call so React has settled).
6. Confirm exactly one is `true`. If none, click your intended target now.
7. Click Create.
8. Verify generation started: `document.querySelectorAll('a[href*="/song/"]')` first 2 entries should be NEW URLs (not the previous prompt's), and `[class*="spin"]` count should be > 0. If neither — Create didn't fire; recover the vocal toggle and retry.

**Why two calls:** within a single JS turn, React state updates are batched. A click on Male and a click on Create in the same turn can have Create read the pre-click state.

### Dual-tab submit sequence (start of loop or after each wakeup)

On the **first iteration** (or any time both tabs are idle):

1. Switch to Dash → open prompt N modal → read fields → switch to tab A → inject + set toggle (Call 1) → verify toggle + click Create (Call 2). Confirm spinners.
2. Update tracker: `window.__flight[TAB_A_ID] = 'Prompt N title'`
3. Immediately switch back to Dash → open prompt N+1 modal → read fields → switch to tab B → inject + set toggle (Call 1) → verify toggle + click Create (Call 2). Confirm spinners.
4. Update tracker: `window.__flight[TAB_B_ID] = 'Prompt N+1 title'`
5. Both tabs are now generating. Close the Dash modal.

**Do not wait between tab A submit and tab B submit.** The goal is both tabs generating simultaneously.

### Wait for generation (~3 min)

- Schedule **one wakeup for 180s** covering both in-flight prompts.
- The wakeup message must state: both prompt titles, both Suno tab IDs, and the `window.__flight` state at submit time. Example: `"Tab A (id=123) generating 'Prompt Title X'; Tab B (id=456) generating 'Prompt Title Y'. Check tab A first (oldest)."`
- Re-fetch everything live from Dash on wakeup — Dash always has the data. Do not rely on stale in-wakeup state.
- On wakeup: check **tab A first** (it was submitted first). Accept its takes into Dash prompt N, then immediately submit prompt N+2 to tab A. Then check tab B, accept its takes into Dash prompt N+1, then immediately submit prompt N+3 to tab B. Both tabs are generating again — schedule the next 180s wakeup.

### Accept completed tracks

1. In Suno: `document.querySelectorAll('a[href*="/song/"]').slice(0,2).map(a=>a.href)` — the first 2 results are the newest tracks. No spinners = done.
2. In Dash: close any open modal, then click the row for the prompt you just generated.
3. Find take 1/take 2 inputs via `find` tool, paste URLs with `form_input`.
4. Click "accept takes" via JS: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'accept takes')?.click()`
5. The server starts downloading. Close the modal — the queue will update when done.

### Check if queue is empty

If Dash shows "No Song Prompts" but you expected more:
- Check if hooks have been accepted: go to Workflows → Hook → Prompt and look for outcomes with "0 to work / 0 accepted".
- If hooks are unreviewed, you must accept them and run Hook → Prompt before songs can be queued. The Suno loop cannot unblock this — surface it to Daniel.

## Proven JS patterns

**Read all Dash fields at once:**
```js
const tas = document.querySelectorAll('textarea');
({lyrics: tas[0].value, style: tas[1].value, exclusions: tas[2].value, title: tas[3].value, gender: tas[4].value})
```

**Inject into a Suno field (React-safe):**
```js
function setReactValue(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
// Usage:
setReactValue(document.querySelectorAll('textarea')[0], lyricsText); // lyrics
setReactValue(document.querySelectorAll('textarea')[1], styleText);  // style
setReactValue(document.querySelectorAll('input,textarea')[find el with placeholder==='Exclude styles'], exclusionsText);
setReactValue(Array.from(document.querySelectorAll('input')).filter(el => el.placeholder === 'Song Title (Optional)').at(-1), titleText);
```

**Extract completed Suno URLs:**
```js
Array.from(document.querySelectorAll('a[href*="/song/"]')).slice(0,2).map(a=>a.href)
```

**Check Male/Female button state:**
```js
document.querySelectorAll('button')[N].getAttribute('data-selected') // 'true' or null
```

**Open a prompt modal by title:**
```js
Array.from(document.querySelectorAll('*'))
  .find(el => el.textContent.trim() === 'Prompt Title Here' && el.children.length === 0)
  ?.click()
```

**Close modal:**
```js
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.includes('close') || b.textContent.includes('✕'))
  ?.click()
```

## Friction notes (verified in test runs)

These are the bugs / surprises that bit prior runs. Internalize them before starting.

1. **Suno's Create button silently no-ops when no vocal selector is active.** No error toast, no disabled state, the click just does nothing. Always verify `data-selected="true"` on at least one of Male/Female/Instrumental before clicking Create. If you submit and see no spinners + no new song URLs after 2 seconds, this is your bug.

2. **Dash gender="instrumental" is a misnomer.** It does not mean the song should have no vocals. The Hook → Prompt seeder writes `gender=instrumental` for some prompts that have full lyrics with vocal sections AND style descriptions like "Earnest plaintive male lead with conversational intimacy, no vibrato or affectation, tender female harmony weaving through". In practice: if lyrics are non-empty, default to Male in Suno; if lyrics are truly empty, click Suno's Instrumental.

3. **React state read in the same JS turn as a click is stale.** Set values, click toggles, then return. Read state and click Create in a separate call.

4. **Cross-tab data ferrying requires multiple round trips.** A single javascript_tool response truncates around 2KB; lyrics + style routinely exceed that. Read fields in piecewise calls (`window.__cur.lyrics`, then `window.__cur.style.substring(0, 1000)`, etc.) and assemble in your inject call. There is no localStorage bridge — Dash and Suno are different origins.

5. **Style text appears templated by outcome, not per-hook.** Multiple prompts in the same outcome share most of the style language. Worth flagging back to Daniel if diversity matters.

6. **Modal ref IDs change across modal opens but field placeholders are stable.** Don't reuse ref IDs from a prior modal — re-find each time. Use placeholder-based queries when possible.

7. **Modal does not auto-close after "accept takes".** It shows "downloading + uploading…" indefinitely from the user's perspective. Close it manually after clicking accept.

8. **Each Suno tab has independent vocal toggle state.** Verifying the toggle on tab A tells you nothing about tab B. Run the two-call pattern separately on each tab. A tab that was left on Female from a prior session will stay Female — don't assume it matches what you set on the other tab.

9. **`window.__flight` lives on the Dash tab only.** It's a convenience tracker for the current run. Update it immediately after each successful Create click. If you lose track of which tab has which prompt, re-check via tab IDs in the wakeup message you scheduled.

## Captcha handling

If Suno shows a captcha at any step:
- Stop immediately.
- Log: timestamp, which prompt # you were on, the prompt text.
- Append to the failure log (see below).
- Exit gracefully — don't keep retrying.

## Failure logging — DO NOT SKIP

Write findings to: `/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/populate-songs/RUN_LOG.md`

For every run, prepend a section dated with today's date (newest at top). Include:
- How many prompts processed successfully
- The first failure (what broke, where in the flow, exact error / DOM state)
- Suggested redesign for that failure point
- Any Dash UX papercuts noticed even if non-blocking

This log is the deliverable. Daniel cares more about the bug list than the songs.

## Important reminders

- Daniel runs everything live — there is no staging. Don't "test" by clicking Delete on real data.
- The receptacle takes the share URL **as-is** (don't strip query params unless you've confirmed Dash needs it stripped).
- If a prompt has only 1 successful Suno track (the other failed), note it in the log; ask whether to paste 1 link or regenerate. Default: paste the 1 good link and continue.
- Dash and Suno persist login. If either logs out, stop and log it.

## Done condition

- All Gary @ UNTUCKit Park Meadows prompts have share links accepted, OR
- A failure was logged with reproduction steps and a redesign suggestion.

When done, output a 3-line summary to chat:
1. N prompts completed / M total
2. First failure (or "no failures")
3. Path to RUN_LOG.md
