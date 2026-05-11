---
name: seed-hooks
description: Drive the Hook Writing and Hook→Prompt steps in Dash for a given ICP. Generates and approves hooks for outcomes, then seeds Suno prompts into the Song Creation Queue. Run this before populate-songs when the queue is empty or short.
---

# seed-hooks

Drive the first two stages of the music generation pipeline in Dash:
1. **Hook Writing** — generate AI-drafted hooks per outcome and approve them
2. **Hook → Prompt** — convert approved hooks into Suno prompts that land in Song Creation Queue

When done, hand off to `populate-songs`.

## Setup

- **Client:** Untuckit / **Location:** Park Meadows / **ICP:** Gary
- **Tab:** Dash at `dash.entuned.co` (pre-logged-in)
- **Tool:** Chrome MCP (`mcp__Claude_in_Chrome__*`) — load via ToolSearch at start of each context segment

## How the pipeline works (verified)

```
Hook Writing                Hook → Prompt              Song Creation Queue
[Drafts] → [Approved]  →    seed N → [Recent: queued]  →  [Prompts ready]
                                       ↓
                              populate-songs picks up
                                       ↓
                                 [Recent: accepted]
                                 + Library updated
```

- "**N to work**" on the Hook → Prompt outcome row = N prompts currently **queued** in Song Creation Queue
- "**N accepted**" = N prompts already processed by populate-songs (URLs accepted, songs in library)
- Each `seed N` click deterministically pulls N approved hooks (not previously seeded) and produces N Suno prompts

## Phase 1 — Hook Writing

### Navigate

`Workflows → Hook Writing`. Verify ICP filter is Gary.

### Layout (post-redesign)

Two-column workspace:
- **Left (1/3):** outcome cards stacked vertically — single-row when collapsed. Each card shows the outcome name on the left and a right-justified count of accepted hooks. Selected card highlights and expands to reveal a number input (default 5) + `Draft` button.
- **Right (2/3):** drafted hooks appear here as N rows of `[textarea][Accept]`. Clicking `Accept` greys the row and the button becomes `Edit`. There is no separate "approved" column anymore — only the count badge on the card.

Drafts are **ephemeral until Accept** — switching outcomes or refreshing the page discards unaccepted drafts.

### Decide which outcomes need more hooks

Cross-reference `Library → Pool Depth`:
- Outcome with **0 songs** = critical, needs hooks ASAP
- Outcome with **< 5 songs** = critical, but lower priority

A reasonable target is **8–10 accepted hooks per outcome** so you have headroom for multiple seed runs.

### Generate and accept drafts

For each outcome you want to seed:

1. **Click the outcome card** in the left column. Cards are `<div>` elements (not buttons) — the title row is the first child, the right-justified accepted count is the second child.
   ```js
   // Cards are <div> elements. First child is the title row;
   // first child of THAT is the name div (the count is the second sibling).
   Array.from(document.querySelectorAll('div'))
     .find(d => {
       const titleRow = d.children[0]
       if (!titleRow || !titleRow.children[0]) return false
       return (titleRow.children[0].textContent || '').trim() === 'OutcomeName'
     })
     ?.click()
   ```

2. **Click `Draft`** inside the now-active card. Wait 30–60s.
   ```js
   Array.from(document.querySelectorAll('button'))
     .find(b => b.textContent.trim() === 'Draft')
     ?.click()
   ```

3. **Verify drafts appeared:** check that the right column has N `<textarea>` elements with non-empty values and N adjacent `Accept` buttons. If not yet, wait another 30s — there is a progress bar but it does not block.
   ```js
   document.querySelectorAll('textarea').length  // should equal your N
   ```

4. **Accept all drafts** with one JS call:
   ```js
   Array.from(document.querySelectorAll('button'))
     .filter(b => b.textContent.trim() === 'Accept' && !b.disabled)
     .forEach(b => b.click())
   ```
   Each click emits a `hook saved` toast and the card's `accepted` count increments. Accepted rows grey out and their button changes to `Edit` — they will not be re-accepted by a second pass.

5. **Read draft text** (e.g. for the RUN_LOG) before accepting:
   ```js
   Array.from(document.querySelectorAll('textarea')).map(t => t.value)
   ```

6. **Watch out:** clicking a different outcome card wipes the drafts in the right column. Always finish accepting (or copying) the current outcome's drafts before switching.

## Phase 2 — Hook → Prompt

### Navigate

`Workflows → Hook → Prompt`. Verify ICP filter is Gary.

### Read the outcome state

Each row reads `OutcomeName{N} hooks·{M} to work·{K} accepted`. To pick targets:
- Skip outcomes where `to work + accepted` already covers your pool depth goal
- Prioritize outcomes where `M to work` = 0 and `hooks` > `accepted` (i.e. there are unseeded approved hooks)

### Seed prompts

For each target outcome:

1. **Click the outcome row** in the main list. Match by regex `^OutcomeName\d+ hooks` (e.g. `^Calm\d+ hooks`).

2. **Wait ~1500ms** for the side panel to render. The inner controls aren't queryable until then.

3. **(Optional)** change `batch size` (number input, default 5). The seed button text updates: `seed N for Outcome`.

4. **Click `seed N for Outcome`**:
   ```js
   Array.from(document.querySelectorAll('button'))
     .find(b => b.textContent.trim().match(/^seed \d+ for OutcomeName$/))
     ?.click()
   ```

5. **Wait 30–90s.** Verify completion by either:
   - Outcome row updates from `0 to work` to `N to work`, OR
   - Status line under the seed button reads `last batch: N / N produced · complete`

6. **Repeat for next outcome.** Each seed is independent; no batch-across-outcomes affordance exists.

### Verify

Click `Song Creation Queue` in the nav. Confirm the new prompts appear with title + reference track + outcome label. They are immediately ready for `populate-songs`.

## Proven JS patterns

```js
// Hook Writing — select an outcome card (cards are divs, not buttons).
// First child of the card is the title row; first child of THAT is the name.
Array.from(document.querySelectorAll('div'))
  .find(d => {
    const titleRow = d.children[0];
    if (!titleRow || !titleRow.children[0]) return false;
    return (titleRow.children[0].textContent || '').trim() === 'OutcomeName';
  })
  ?.click();

// Hook Writing — click Draft (inside the active card)
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'Draft')
  ?.click();

// Hook Writing — accept all visible drafts (skips already-accepted rows)
Array.from(document.querySelectorAll('button'))
  .filter(b => b.textContent.trim() === 'Accept' && !b.disabled)
  .forEach(b => b.click());

// Hook Writing — read all draft texts
Array.from(document.querySelectorAll('textarea')).map(t => t.value);

// Hook → Prompt — switch outcome (then setTimeout 1500ms before next click)
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.startsWith('OutcomeName') && b.textContent.includes(' hooks'))
  ?.click();

// Hook → Prompt — seed prompts for active outcome
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim().match(/^seed \d+ for OutcomeName$/))
  ?.click();

// Hook → Prompt — read all outcome states
Array.from(document.querySelectorAll('button'))
  .filter(b => b.textContent.match(/^[A-Z][a-zA-Z ]+\d+ hooks/))
  .map(b => b.textContent.trim());
```

## Async wait pattern

UI transitions need explicit waits. Wrap actions that depend on prior state changes:

```js
target.click();
new Promise(r => setTimeout(() => {
  // do follow-up action here
  r('result');
}, 1500));
```

For longer waits (AI generation, 30–90s), use `ScheduleWakeup` instead of in-page `setTimeout` — saves tokens and keeps the cache warm if you stay under 270s.

## Failure logging — DO NOT SKIP

Append a dated section (newest at top) to:
`/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/seed-hooks/RUN_LOG.md`

Include:
- How many hooks approved, by outcome
- How many prompts seeded, by outcome
- Any UI that didn't match this skill (the skill was ground-truthed in run 1; subsequent UI changes should update it)
- Any AI-generated drafts that were noticeably bad (so the prompt template can be refined)

## Done condition

Song Creation Queue has at least 5 prompts (or as many as the operator targeted). Hand off to `populate-songs`.

When done, output to chat:
1. N hooks approved across M outcomes
2. P prompts now queued in Song Creation Queue
3. Path to RUN_LOG
