# `lib/eno/` — Eno pipeline

Per-seed orchestrator. Turns one queued `SongSeed` into a fully-resolved Suno payload (style + lyric + arrangement + outcome-factor prepend). Called once per song the operator generates from Dash; no cron triggers it.

## Entrypoint

[`runEno`](./eno.ts) at the top of [`eno.ts`](./eno.ts) is the only public batch entry point. It loops `createSongSeed` for the requested `n`, breaks on pool exhaustion, and writes the `SongSeedBatch` summary.

`createSongSeed` does the per-seed work:

1. Pick an approved hook (`pickAvailableHook`) and a compatible reference track (`pickReferenceTrack`).
2. Resolve outcome variance, then call `marsAssemble` for the style portion.
3. Wrap the Mars output with `applyOutcomeFactorPrompt` (the load-bearing tempo / mode / mood prepend).
4. Build a `GenreBrief` from the reference track's `StyleAnalysis` (plus the Mars anchor tag when present).
5. Pick a form archetype.
6. Call `generateLyrics` from [`../bernie/bernie.ts`](../bernie/bernie.ts) with the hook, brand guidelines, arrangement, form, and genre brief.
7. Inject arrangement section markers + chorus escalation.
8. Persist everything on the `SongSeed` row (style, lyrics, prompt versions, resolved tempo/mode, fired exclusion rules, genre brief).

Only entry point in production is `POST /admin/eno/run` ([routes/admin.ts](../../routes/admin.ts)).

## Genre awareness

The genre signal flows: `StyleAnalysis.vibePitch` + `mars.anchor.tag` → `extractGenreBrief` → `BernieInput.genreBrief` → Bernie's draft pass, where `genre-craft-rules.ts` substitutes hip-hop / country / EDM / R&B / latin / indie craft guidance for the pop default.

The edit pass is intentionally genre-agnostic. The draft already encoded section structure and genre craft into the lyrics; the editor's job is polish, not re-architecture. Re-injecting genre context there would pay tokens for input the editor doesn't act on.

## Invariants

- **`applyOutcomeFactorPrompt` wraps every Mars style output.** Tempo / mode / mood live on the prepend; Mars style builders never receive Outcome and cannot inline these fields. This is the most load-bearing rule in the pipeline.
- **Hook preservation.** Bernie falls back to the draft if the editor drops any chorus hook instance. Verified in [`../bernie/bernie.test.ts`](../bernie/bernie.test.ts).
