# Handoff: Fix lyric repetition at the outcome factor prompt level

## Context

Analyzed all 149 generated songs. The ban list works fine (only 20 word-level violations). The real problem is **phrase-level ruts** driven by thin outcome lyric factor prompts.

## The chain

1. Outcome lyric factor prompts are 1-2 sentences of abstract word-clouds
2. Hook drafter collapses these to 2-3 hook shapes per outcome
3. Hooks become chorus verbatim → entire songs share the same trigram signature
4. Some duplicate hooks are approved (e.g. "Everything I need is right here" appears twice in Convert Browsers)

## Data (top repeated trigrams by outcome)

| Outcome | Songs | Dominant phrase | Hits | Root cause |
|---|---|---|---|---|
| Calm | 18 | "i'm learning how to" | 26x | Factor: "slowness, consideration, stroll, ease" → 2 hooks with same skeleton |
| Add More Items | 18 | "take one more" / "might as well add it" | 28x/25x | Factor: "grab it, get it, take it, one more" → literal echo |
| Convert Browsers | 17 | "everything I need is right here" | 21x | Factor: "choice, confidence, decision making" + duplicate hooks approved |
| Move Through | 13 | "out the door" | 25x | Factor: "movement, going, taking off" → single image |
| Reinforce Brand | 15 | "nothing left to prove" | 14x | Factor prompt not in DB yet (uses code default) |
| Linger | 34 | "before you think about it" | 18x | Largest outcome, hooks cluster around "take my time" |

## What to fix

### 1. Rewrite outcome lyric factor prompts (DB-editable in Dash → Outcomes → Lyric Rules)

Current prompts are at `apps/server/scripts/analyze-lyrics-by-outcome.ts` output, or live in DB table `outcome_lyric_factors`. They all follow the same thin pattern:
```
hooks designed to subtly evoke [abstract words]. First Person, inner voice (I, me, my)
```

Each needs:
- **3-5 concrete sensory seeds** instead of abstract word-clouds (e.g. for Calm: "morning fog on a lake, bare feet on cool tile, a dog asleep on the porch" not "slowness, consideration, stroll, ease")
- **Anti-clustering directive**: "Each hook must use a different physical setting, verb tense, and sentence structure than every other hook for this outcome"
- **Explicit spread vectors**: verb type (imperative vs declarative vs question), tense, POV, physical location
- **Negative examples**: "Do NOT use 'learning how to', 'nothing left to prove', or any phrase already approved for this outcome"

### 2. Add hook deduplication check

Before approving a hook, check semantic similarity against existing approved hooks for that outcome. At minimum, substring overlap check. The hook drafter's `buildHookDrafterContext()` in `apps/server/src/lib/hooks/drafter.ts` already passes existing hooks to Claude — but the model still generates near-duplicates.

Options:
- Post-generation programmatic filter: reject hooks that share 3+ consecutive words with an existing approved hook
- Add a "similar to existing" warning in the Dash hook approval UI

### 3. Post-generation lyric scan (from prior conversation)

After `generateLyrics()` returns, scan output for the top repeated trigrams. If found, re-prompt with targeted rewrite instructions. This is the `formatNoGoBlock` approach but applied to the model's own clichés, not generic AI clichés.

## Files involved

- `apps/server/src/lib/hooks/drafter.ts` — hook generation, prompt assembly
- `apps/server/src/routes/admin.ts` — outcome lyric factor CRUD (search "outcome-lyric-factors")
- `apps/admin/src/panels/engine/OutcomeLyricFactor.tsx` — Dash UI for editing factor prompts
- `apps/server/src/lib/bernie/lyric-craft-rules.ts` — ban list (now DB-backed via `lyric_ban_entries`)
- `apps/server/src/lib/proto-bernie/lyrics.ts` — lyric generation
- `apps/server/src/lib/bernie/bernie.ts` — two-pass lyric generation (draft → edit)

## Analysis scripts (disposable)

- `apps/server/scripts/analyze-lyrics-by-outcome.ts` — full breakdown by outcome
- `apps/server/scripts/dump-lyrics.ts` — raw lyrics dump to /tmp
