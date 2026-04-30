---
name: run-pipeline
description: Full music generation pipeline for a Gary @ UNTUCKit Park Meadows library — from empty pool to songs in Dash. Orchestrates seed-hooks → populate-songs in sequence. Use when Daniel says "fill the library", "run the pipeline", or "generate songs for Gary".
---

# run-pipeline

Runs the complete music generation pipeline end-to-end:

```
Hook Writing → Hook→Prompt → Suno generation → Dash library
     (seed-hooks)                 (populate-songs)
```

## When to use this vs. the sub-skills

| Situation | Use |
|---|---|
| Starting from scratch (no hooks, empty queue) | `run-pipeline` |
| Queue has prompts but no songs yet | `populate-songs` directly |
| Hooks exist but none accepted | `seed-hooks` directly, then `populate-songs` |
| Just checking pool depth / status | Neither — check Library → Pool Depth manually |

## Setup

- **Client:** Untuckit / **Location:** Park Meadows / **ICP:** Gary
- **Dash tab:** dash.entuned.co (pre-logged-in)
- **Suno tab:** suno.com/create (pre-logged-in)
- **Tool:** Chrome MCP — load via ToolSearch at start of each context segment

## Step 1 — Assess current state

Before doing anything, read the dashboard to know where you are:

1. **Library → Pool Depth** — which outcomes are CRITICAL (< 5 songs)?
2. **Workflows → Song Creation Queue** (Gary filter) — are there prompts already queued?
3. **Workflows → Hook → Prompt** (Gary filter) — are there accepted hooks not yet converted?

Then pick your entry point:

- Queue has items → skip to Step 3 (populate-songs)
- Accepted hooks exist but queue is empty → skip to Step 2b (run Hook→Prompt)
- No accepted hooks → start at Step 2a (Hook Writing)

## Step 2a — Hook Writing

Run the **seed-hooks** skill:
`/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/seed-hooks/SKILL.md`

Focus on CRITICAL outcomes first (pool = 0 before outcomes with pool = 1–4).
Target: at least 2 accepted hooks per CRITICAL outcome.

When done: confirm Song Creation Queue has prompts, then continue to Step 3.

## Step 2b — Hook→Prompt only (if hooks already accepted)

Navigate to Workflows → Hook → Prompt. Run for each outcome that has accepted hooks but no queue items. Verify prompts appear in Song Creation Queue before continuing.

## Step 3 — Suno generation

Run the **populate-songs** skill:
`/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/populate-songs/SKILL.md`

This handles the entire Suno loop — inject prompts, wait for generation, accept takes back into Dash — until the queue is empty.

## Step 4 — Verify and report

After populate-songs completes:
1. Check Library → Pool Depth — confirm CRITICAL counts improved
2. Check Library → Song Browser (Gary filter) — confirm new songs appear with play buttons
3. Note any outcomes still at 0 (may need another seed-hooks run)

## Failure modes

| What you see | What it means |
|---|---|
| Song Creation Queue: "No Song Prompts" | Hooks not accepted upstream — go to seed-hooks |
| Hook → Prompt: "0 to work / 0 accepted" for an outcome | Hooks exist but none accepted — go to Hook Writing and accept some |
| Suno captcha | Stop populate-songs, log it, come back when Daniel is awake |
| Pool Depth still CRITICAL after run | Not enough hooks accepted — run seed-hooks again for that outcome |

## Logging

Each sub-skill writes its own log:
- `seed-hooks`: `/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/seed-hooks/RUN_LOG.md`
- `populate-songs`: `/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/populate-songs/RUN_LOG.md`

No separate run-pipeline log needed — the sub-skill logs tell the full story.

## Done condition

Library → Pool Depth shows no CRITICAL outcomes at 0, OR all available prompts have been generated and the queue is empty. Report to Daniel with pool depth before/after.
