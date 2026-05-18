# `lib/eno/` — Eno pipeline (Eno-1 + Eno-2)

**Status: experiment surface.** The shape of these files may continue to change while Eno-2 is being evaluated. Do not treat the parallel structure as cleanup debt.

## What's in here

`eno/` is the per-seed orchestrator that turns one queued `SongSeed` into a fully-resolved Suno payload (style + lyric + arrangement + outcome-factor prepend). It is called once per song the operator generates from Dash; no cron triggers it.

Two pipeline variants live side-by-side:

| File | Pipeline | Status |
|---|---|---|
| [`eno.ts`](./eno.ts) | Eno-1 (`createSongSeed`) | **Production default** |
| [`eno-v2.ts`](./eno-v2.ts) | Eno-2 (`createSongSeedV2`) | Opt-in — adds genre-aware lyric path |

## Default + dispatch

`runEno` ([eno.ts:60](./eno.ts)) reads `opts.pipeline`. Default is `'eno-1'`. Dispatch happens at [eno.ts:84–86](./eno.ts):

```ts
if (opts.pipeline === 'eno-2') return createSongSeedV2(...)
return createSongSeed(...)
```

The Dash UI toggle ([`apps/admin/src/panels/seeding/SongSeedQueue.tsx:69`](../../../../admin/src/panels/seeding/SongSeedQueue.tsx)) also defaults to Eno-1, so the user explicitly opts in to Eno-2 per generation batch.

Only entry point in production is `POST /admin/eno/run` ([routes/admin.ts:3054](../../routes/admin.ts)).

## Eno-2 is not a parallel rewrite

Eno-2 imports the shared helpers from Eno-1 — `getOrSeedOutcomeFactorPrompt`, `applyOutcomeFactorPrompt`, `pickAvailableHook`, `pickReferenceTrack`, `CreateSongSeedResult`. The two orchestrators are ~95% byte-equivalent. Substantive diffs:

1. **Lyric path.** Eno-1 calls `generateLyrics` ([bernie/bernie.ts](../bernie/bernie.ts)); Eno-2 calls `generateLyricsV2` ([bernie/bernie-v2.ts](../bernie/bernie-v2.ts)). The Bernie-2 draft pass adds genre context + genre-family craft overrides. The edit pass is byte-identical between Bernie-1 and Bernie-2.
2. **Two extra Prisma writes.** Eno-2 records `pipeline` and `genreBrief` on the `SongSeed` row.
3. **`extractGenreBrief` helper.** Eno-2-only; pulls the genre brief from the reference track.

See [`ASSESSMENT-eno-comparison.md`](../../../../../ASSESSMENT-eno-comparison.md) at the repo root for the full diff inventory.

## Invariants

- **`applyOutcomeFactorPrompt` wraps every Mars style output.** Tempo / mode / mood live on the prepend; Mars style builders never receive Outcome and cannot inline these fields. This is the most load-bearing rule in the pipeline. Verified upheld for both Eno-1 and Eno-2.
- **`BernieOutput` shape is shared.** Bernie-2 re-uses `BernieOutput` from `bernie.ts`. Hook-preservation check, `draft`/`final` shape, prompt-version fields all match.
- **Bernie-1/2 share byte-identical helpers** via [`bernie/_helpers.ts`](../bernie/_helpers.ts): `getOrSeedDraftPrompt`, `formatArrangementBrief`, `parseLyricJson`. The remaining Bernie internals (`getOrSeedEditPrompt`, `countOccurrences`) stay local to each file.

## If you're considering consolidating Eno-1 and Eno-2

Don't, yet. Daniel is actively testing whether Eno-2's genre-aware path produces better lyrics than Eno-1's general path. Until that question is answered, both stay. The consolidation decision (which becomes the long-term default) is a product decision, not a code-hygiene one.

When the time comes, the only behavioral surface that materially differs is the Bernie draft prompt. Everything else either trivially merges or is already shared.
