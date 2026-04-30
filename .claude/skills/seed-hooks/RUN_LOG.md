# seed-hooks — Run Log

Append a dated section per run. Newest at the top.

---

## 2026-04-30 — Terrell ICP, Park Meadows / Untuckit (run 2)

**ICP:** Terrell (`781505a1-220f-4894-a350-9a4344af1319`)
**Goal:** 20+ songs for fresh ICP — neo-soul/jazz-rap/Black excellence palette

### Result

**40 hooks approved · 40 Suno prompts queued · all 15 reference tracks decomposed**

### Hooks approved

| Outcome | Approved |
|---|---|
| Calm | 5 |
| Convert Browsers | 5 |
| Impulse Buy | 5 |
| Increase Order Value | 5 |
| Lift Energy | 5 |
| Linger | 5 |
| Move Through | 5 |
| Reinforce Brand | 5 |
| **Total** | **40** |

### Prompts seeded

All 8 outcomes seeded 5 each = **40 queued** in Song Creation Queue.

### Reference tracks decomposed (this run)

All 15 Terrell reference tracks decomposed from scratch — none were pre-decomposed. All saved as `draft`. Quality was high across all three buckets:
- **Formation Era (5):** ATCQ Electric Relaxation, D'Angelo Brown Sugar, Erykah Badu On & On, Maxwell Ascension, Outkast Elevators
- **Subculture (5):** Anderson .Paak Come Down, Hiatus Kaiyote Nakamarra, Kamasi Washington The Rhythm Changes, Kendrick Lamar King Kunta, Robert Glasper Afro Blue
- **Aspirational (5):** Leon Bridges River, Moses Sumney Plastic, Sault Wildfires, Tom Misch It Runs Through Me, Yebba Evergreen

### Standout hook/ref pairings

- "Earned the Quiet" → Outkast Elevators (Reinforce Brand) — exact Terrell register
- "Nowhere Else to Be" → Kendrick King Kunta (Linger) — bold, energetic tension
- "Nothing Left to Prove" → Sault Wildfires (Calm) — meditative defiance
- "Maybe I Don't Need a Reason" → ATCQ Electric Relaxation (Impulse Buy) — laid-back swagger
- "The Room I Keep" → D'Angelo Brown Sugar (Reinforce Brand) — intimacy + self-possession
- "Worth the Investment" → Kendrick King Kunta (Increase Order Value) — unexpected funk anchor

### UI observations

- No UI changes since run 1. All patterns from ground-truth run held.
- Outcome switch async delay (~1.5s) still required — setTimeout(1500) pattern works.
- Decompose takes ~60s per track consistently. Save must be clicked before opening next track.
- "no decomposed ref tracks" warning in Hook → Prompt clears immediately after all tracks saved — no reload needed.
- One near-duplicate hook: "This Is the One I Keep" appeared in both Convert Browsers and Increase Order Value (different outcomes, both contextually valid — left as-is).

### Next step

Hand off to `populate-songs` — 40 prompts ready in Song Creation Queue for Terrell.

---

## 2026-04-29 (run 1 — ground-truth)

**Goal:** verify the Hook Writing → Hook → Prompt UI and update the skill from skeleton to working spec.

### Result

**14 new hooks approved · 10 new Suno prompts queued · full pipeline ground-truthed**

State after run:
- Add More Items: 8 approved hooks · 5 queued prompts
- Calm: 14 approved hooks · 5 queued prompts
- Convert Browsers: 9 approved hooks · 0 queued (just approved 5 more, didn't seed)
- Impulse Buy: 8 approved hooks · 0 queued (just approved 5 more, didn't seed)
- Other outcomes: untouched

### What I learned (UI ground-truth)

**Hook Writing page** (`/#workflows/Hook Writing`)

- Outcome list at top: each shows `OutcomeName{count} approved` or `OutcomeName{count} approved · {N} drafts`. Click to switch.
- Right pane shows the active outcome's `GENERATE` (single) and `generate 5 drafts` (bulk) buttons, then **Drafts (N)** section, then **Approved (N)** section.
- Each draft has `approve` and `remove` buttons.
- AI generation takes 30–60s. No spinner — you just wait and re-read `Drafts (N)` count.
- Approving emits a `hook approved` toast; the draft moves to Approved section.

**Hook → Prompt page** (`/#workflows/Hook → Prompt`)

- "Select outcomes to use" header.
- Each outcome row: `OutcomeName{N} hooks·{M} to work·{K} accepted`
  - `hooks` = total approved in Hook Writing (input pool)
  - `to work` = generated Suno prompts currently `queued` in Song Creation Queue
  - `accepted` = prompts that have completed populate-songs (URLs accepted)
- Click an outcome row to expand a panel below:
  - Outcome name header
  - `batch size` label + number input (defaults to 5)
  - `seed {N} for {Outcome}` button (button text reflects the batch input)
  - After seed: `last batch: X / Y produced · complete` status line
  - `Recent Song Prompts ({count})` list with status badge (`accepted` / `queued`), prompt title, `ref: Artist — Song`, timestamp.
- Seeding takes 30–90s (5 prompts). Each "seed N" call deterministically picks N approved-but-not-yet-seeded hooks.

**Song Creation Queue page**: prompts appear immediately with title, reference track, and outcome label. This is `populate-songs`'s input.

### Failures / surprises

1. **Outcome switch is async; need ~1.5s wait before clicking inner controls.** Clicking an outcome row in either page changes the side panel but the inner buttons are not immediately queryable. Pattern: `click outcome → setTimeout(1500) → query inner button`. Without the wait, follow-up clicks land on stale DOM.

2. **Two button groups share the same outcome names.** On Hook Writing, both the main outcome list (`OutcomeName8 approved`) and a condensed nav row (`OutcomeName · 5`) match by name. To target the main list, use a regex like `^OutcomeName\d` (digit immediately after name = main row with count) — the condensed row has a space and `·` instead.

3. **Approve-all on the wrong outcome.** I clicked `generate 5 drafts` after switching to Convert Browsers, but the actual click landed before the panel had switched, so it generated 5 *additional* drafts on Calm by accident. Lesson: always verify the active panel via page text before clicking action buttons. I approved both batches anyway (no harm done).

4. **No undo on `seed N` once clicked.** The button fires immediately. If you click it twice, you get 2N prompts (each an independent batch). Be deliberate.

5. **The number input next to `batch size` lets you change N before seeding.** Default 5. Useful if you want to seed less (e.g. 2 to validate flow with low cost) — but I didn't test < 5 in this run.

6. **`Drafts (N)` count badge in the outcome list lags behind actual state by ~1s.** After approving, the count drops, but the list of buttons (`Calm9 approved · 5 drafts`) updates a beat later than the right-pane Drafts section.

### UX papercuts observed

1. **No batch action across outcomes.** To seed 5 prompts each across 9 outcomes, you must click into each one and run `seed 5` individually. A "seed N for all CRITICAL outcomes" button would save 9 round trips when filling a fresh library.

2. **No way to see which approved hooks have been seeded vs unseeded.** You can see `to work` and `accepted` counts, but not which specific hooks have been used. If you re-run `seed 5`, it picks new ones (presumably) but there's no UI that shows which.

3. **Hook Writing's Drafts → Approved transition has no animation or confirmation other than a transient toast.** Easy to lose track of which drafts you've already approved during a click sequence. A persistent "approved this session" badge would help.

4. **The condensed outcome nav row at the bottom of the panel duplicates the main outcome list above it.** Unclear what its purpose is; the click target overlap with the main list creates ambiguity (see Failure #2).

5. **No visible loading state during AI generation (drafts or prompts).** No spinner, no progress bar, no disabled button. The only feedback is the count changing 30–90s later. A clear "generating…" indicator on the active button would prevent double-clicks.

### Path

`/Users/fox296/Desktop/entuned/entuned-0.3/.claude/skills/seed-hooks/RUN_LOG.md`
