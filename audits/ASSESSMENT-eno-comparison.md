# Eno-1 vs Eno-2 — read-only comparison

Deep-read pass on the parallel-orchestrator pair flagged by `ASSESSMENT.md` §2.5
and the three `generateLyrics` variants flagged in §2.4. Read-only: no source
files were modified. File:line citations are from a single pass on 2026-05-17.

Confidence tier convention used below: **HIGH** = verified by reading the
complete function body in both files. **MEDIUM** = grep-based or partial-read
inference. **LOW** = interpretive judgement, not a measured fact.

---

## 1. File-level diff inventory

### `apps/server/src/lib/eno/eno.ts` (Eno-1) — 300 LOC

Exported symbols:

| Name | Signature | Line |
|---|---|---|
| `PipelineName` (type) | `'eno-1' \| 'eno-2'` | `eno.ts:16` |
| `OUTCOME_FACTOR_PROMPT_SEED` (const) | `string` | `eno.ts:18` |
| `getOrSeedOutcomeFactorPrompt()` | `() => Promise<{ id: string; version: number; templateText: string }>` | `eno.ts:20` |
| `applyOutcomeFactorPrompt()` | `(stylePortion: string, outcome: {tempoBpm, mode, mood, dynamics, instrumentation}, templateText: string) => string` | `eno.ts:28` |
| `SeedBuilderOptions` (interface) | 6 fields incl. `pipeline?: PipelineName` | `eno.ts:39` |
| `SeedBuilderResult` (interface) | `{ songSeedBatchId, requestedN, producedN, reason, errors }` | `eno.ts:51` |
| `runEno()` | `(opts: SeedBuilderOptions) => Promise<SeedBuilderResult>` | `eno.ts:59` |
| `CreateSongSeedResult` (interface) | `{ ok, songSeedId?, reason? }` | `eno.ts:110` |
| `HookVocalGender` (type) | `'male' \| 'female' \| 'duet' \| null` | `eno.ts:226` |
| `pickAvailableHook()` | `(icpId, outcomeId) => Promise<{id, text, vocalGender} \| null>` | `eno.ts:228` |
| `RefTrackWithAnalysis` (type) | derived `prisma.referenceTrack.findFirstOrThrow` shape | `eno.ts:247` |
| `vocalGenderCompatible()` | `(refGender: VocalGender, hookGender: HookVocalGender) => boolean` | `eno.ts:252` |
| `pickReferenceTrack()` | `(icpId, hookGender) => Promise<RefTrackWithAnalysis \| null>` | `eno.ts:260` |

Non-exported (internal):

- `createSongSeed()` — `eno.ts:116`. The Eno-1 per-seed orchestrator.

### `apps/server/src/lib/eno/eno-v2.ts` (Eno-2) — 211 LOC

Exported symbols:

| Name | Signature | Line |
|---|---|---|
| `extractGenreBrief()` | `(styleAnalysis, refTrackYear, anchorTag?) => GenreBrief` | `eno-v2.ts:26` |
| `createSongSeedV2()` | `(songSeedBatchId, icpId, outcomeId, styleBuilder?) => Promise<CreateSongSeedResult>` | `eno-v2.ts:100` |

Non-exported helpers (private to Eno-2):

- `GROOVE_TERMS` (Set) — `eno-v2.ts:57`
- `splitHarmonicAndGroove()` — `eno-v2.ts:63`
- `extractLeadingGenre()` — `eno-v2.ts:79`
- `REGISTER_TERMS` (array) — `eno-v2.ts:87`
- `extractVocalRegister()` — `eno-v2.ts:92`

### Symbols in one but not the other

Symbols **only in Eno-1**: `PipelineName`, `OUTCOME_FACTOR_PROMPT_SEED`,
`getOrSeedOutcomeFactorPrompt`, `applyOutcomeFactorPrompt`,
`SeedBuilderOptions`, `SeedBuilderResult`, `runEno`, `CreateSongSeedResult`,
`HookVocalGender`, `pickAvailableHook`, `RefTrackWithAnalysis`,
`vocalGenderCompatible`, `pickReferenceTrack`.

Rationale: Eno-1 is the **module root**. Eno-2 imports every shared helper
from it (`eno-v2.ts:17-23`): `getOrSeedOutcomeFactorPrompt`,
`applyOutcomeFactorPrompt`, `pickAvailableHook`, `pickReferenceTrack`,
`CreateSongSeedResult`. There is no symmetry to break — the entry point
(`runEno`), the shared library functions, and the dispatch live in `eno.ts`;
Eno-2 only contributes one alternate per-seed function plus its
genre-brief-extractor.

Symbols **only in Eno-2**: `extractGenreBrief`, `createSongSeedV2`, plus
five internal helpers for parsing the StyleAnalysis into a `GenreBrief`.
Rationale: these implement the one piece of new logic Eno-2 actually adds
(genre extraction from the StyleAnalysis to feed Bernie-v2).

### Symbols in both: are signatures identical?

No symbols are exported with the same name from both files. The only
near-twin is `createSongSeed` (`eno.ts:116`, non-exported, default
visibility) vs `createSongSeedV2` (`eno-v2.ts:100`, exported). Their
parameter lists are identical:

```
(songSeedBatchId: string, icpId: string, outcomeId: string,
 styleBuilder?: StyleBuilderName) => Promise<CreateSongSeedResult>
```

Confidence: HIGH (read both signatures verbatim).

---

## 2. Pipeline-flag dispatch

### Where `opts.pipeline` is read

**Single read site:** `eno.ts:60`
```
const pipeline = opts.pipeline ?? 'eno-1'
```
Default is `'eno-1'`. The flag is then consumed at two places downstream
within the same function:

- `eno.ts:68` — stamped onto the `SongSeedBatch` row (`pipeline` column).
- `eno.ts:84-86` — dispatch:
  ```
  const result = pipeline === 'eno-2'
    ? await createSongSeedV2(...)
    : await createSongSeed(...)
  ```

No other source-tree file reads `opts.pipeline`. (Verified with
`grep -rn "opts.pipeline\|pipeline:" apps/server/src` —
no other `opts.pipeline` references; the only other `pipeline:` literals
are the Eno-2 writes to `SongSeed`/`SongSeedBatch` Prisma rows and the Zod
schema at `admin.ts:3046`.)

### Where the flag is set

| Site | File:line | Value(s) it can take | What it does |
|---|---|---|---|
| Admin run endpoint (Zod body) | `routes/admin.ts:3046` | `'eno-1' \| 'eno-2'` (optional) | Validates body; `parsed.data.pipeline` is forwarded to `runEno` |
| Admin run endpoint (call) | `routes/admin.ts:3054-3062` | as parsed | The only production source of `opts.pipeline` |
| Dash UI toggle (state) | `apps/admin/src/panels/seeding/SongSeedQueue.tsx:66-70` | `'eno-1' \| 'eno-2'`, persisted in `localStorage.songSeedQueue.pipeline`, default `'eno-1'` | UI control wired to the Generate buttons |
| Dash UI POST body | `SongSeedQueue.tsx:107` | as state | `api.runSeedBuilder({ ..., pipeline }, token)` |
| Dash API helper signature | `apps/admin/src/api.ts:1311-1312` | `'eno-1' \| 'eno-2'` (optional) | Mirror of the server Zod |

### Default in production

**`eno.ts:60` falls back to `'eno-1'` if `opts.pipeline` is undefined.** That
fallback fires whenever a caller omits the flag — i.e. when an admin clicks
"Generate" with the localStorage pipeline state unset. The Dash UI default
state at `SongSeedQueue.tsx:69` is also `'eno-1'`. So:

- **Default production path = Eno-1** → `createSongSeed` (`eno.ts:116`) →
  `generateLyrics` from `bernie/bernie.ts:100`.
- **Eno-2 fires only when** an operator has the Dash toggle set to "Eno-2"
  (persisted per browser in `localStorage`).

### Cron / non-script production callers of `runEno`

**None.** `grep -rn "runEno" apps/server/src apps/admin/src apps/dashboard/src`
yields exactly one production caller: `routes/admin.ts:3054`
(`POST /admin/eno/run`). The two `cron.schedule` registrations in
`apps/server/src/index.ts:100, 142` (daily 9am, playback heartbeat every 5
min) do **not** call `runEno` — they fire `runPauseAutoResume`,
`runBoostTrialClockActivation`, `runLifecycleEmails`, `runCompExpiryCron`,
and `runPlaybackHeartbeat`. There is no scheduled seed generation in this
codebase; generation is always operator-triggered via Dash.

Confidence on "Eno-1 is the production default": **HIGH** (two independent
default fallbacks both point to it; no other entry point exists).

---

## 3. Function-by-function comparison

The Eno-1 vs Eno-2 per-seed orchestrators are structurally near-twins. I
read both bodies in full. The line-range mapping:

| Concern | Eno-1 | Eno-2 |
|---|---|---|
| Hook pick | `eno.ts:117-118` | `eno-v2.ts:106-107` |
| Ref track pick + null branch | `eno.ts:120-128` | `eno-v2.ts:109-117` |
| SongSeed insert (status='assembling') | `eno.ts:130-134` | `eno-v2.ts:119-124` (adds `pipeline:'eno-2'`) |
| Outcome fetch | `eno.ts:137` | `eno-v2.ts:127` |
| `marsAssemble` call | `eno.ts:139` | `eno-v2.ts:129` |
| `resolveOutcomeParams` (variance) | `eno.ts:143-148` | `eno-v2.ts:131-136` |
| `getOrSeedOutcomeFactorPrompt` | `eno.ts:150` | `eno-v2.ts:138` (imported from Eno-1) |
| `applyOutcomeFactorPrompt` wrap | `eno.ts:151-155` | `eno-v2.ts:139-143` |
| ICP → Client lookup (for `brandLyricGuidelines`) | `eno.ts:157-158` | `eno-v2.ts:145-146` |
| Arrangement extraction | `eno.ts:167-171` | `eno-v2.ts:148-152` |
| `pickFormArchetype` | `eno.ts:177-181` | `eno-v2.ts:154-158` |
| Genre brief extraction | — (absent) | `eno-v2.ts:163-167` (**Eno-2-only**) |
| Lyric generation call | `eno.ts:183-188` (`generateLyrics`) | `eno-v2.ts:169-175` (`generateLyricsV2`, with `genreBrief`) |
| `injectArrangement` | `eno.ts:193` | `eno-v2.ts:177` |
| SongSeed update on success | `eno.ts:195-214` | `eno-v2.ts:179-200` (adds `pipeline:'eno-2'`, adds `genreBrief: JSON.stringify(...)`) |
| Failure branch | `eno.ts:217-223` | `eno-v2.ts:203-209` (adds `pipeline:'eno-2'`) |

### Specific behavioral differences

Reading the diff line-by-line, the **only output-visible differences** are:

1. **Lyric generation strategy.** Eno-1 calls `bernie.ts::generateLyrics`
   with `{ hookText, brandLyricGuidelines, arrangementSections,
   formArchetype }`. Eno-2 calls `bernie-v2.ts::generateLyricsV2` with the
   same four plus `genreBrief`. See §5 for the resulting lyric-prompt diff.

2. **`SongSeed.pipeline` column.** Eno-1 leaves it null/default (no write).
   Eno-2 sets `pipeline: 'eno-2'` on the initial insert (`eno-v2.ts:122`),
   on the success update (`eno-v2.ts:183`), and on the failure update
   (`eno-v2.ts:206`). The SongSeedBatch row is stamped from the wrapper
   `runEno()` for both pipelines (`eno.ts:68`).

3. **`SongSeed.genreBrief` column.** Eno-2 persists the GenreBrief as
   JSON (`eno-v2.ts:198`). Eno-1 has no equivalent field write — that
   column simply stays null for Eno-1 seeds.

### Things that are byte-for-byte equivalent

- The hook picker, ref picker, Mars call (same `marsAssemble` invocation
  with identical args), variance resolver, outcome-factor wrap, archetype
  selector, `injectArrangement` — all use the **same imports** in both
  files (`pickAvailableHook`, `pickReferenceTrack`,
  `applyOutcomeFactorPrompt`, `getOrSeedOutcomeFactorPrompt` are all
  imported in `eno-v2.ts:17-23` from `./eno.js`).
- The error handling shape (`try { ... } catch (e: any) { update status to
  'failed' }`) is identical.
- Field list written on success is identical for every column except the
  two Eno-2 additions noted above.

Confidence: HIGH that everything except the lyric call, the
`pipeline` column write, and the `genreBrief` column write is byte-equivalent
between the two per-seed functions. Verified by side-by-side read of
`eno.ts:116-224` and `eno-v2.ts:100-210`.

### Superset relation

**Eno-2 is a strict superset of Eno-1's behavior** at the orchestration
layer: every Eno-1 side-effect occurs in Eno-2, plus two more SongSeed
column writes, plus the lyric prompt receives a `genreBrief`. The
*outputs* are not a superset (a different lyric generator runs — see §5),
so the user-visible music may differ, but the orchestration shape
is. Confidence: HIGH.

---

## 4. `applyOutcomeFactorPrompt` enforcement

### What the invariant requires

Per Daniel's memory note (`feedback_outcome_factor_prompt_load_bearing.md`):
> Every Mars style builder MUST let eno's applyOutcomeFactorPrompt wrap its
> output. Tempo/mode/mood live on the prepend; don't inline them or skip the
> wrap.

### Where the wrap actually lives

`applyOutcomeFactorPrompt` is **defined once** at `eno.ts:28-37`. It is
called at exactly **two** places in the entire source tree:

- `eno.ts:151-155` (Eno-1 path)
- `eno-v2.ts:139-143` (Eno-2 path)

Both wrap `mars.style` (the builder's raw output) with the same prepend
template (`OutcomeFactorPrompt`). Both call sites are reachable only via
`runEno()`. So **every production seed goes through the wrap.**

### Mars style builders (all three)

| Builder | Defined in | Called from | Receives Outcome? | Inlines tempo/mood? |
|---|---|---|---|---|
| `routeStylePortion` (router, default) | `mars/style-router.ts:172` | `mars/mars.ts:85` | No (`(decomposition, ctx)`, ctx = `{ year, decade }`) | No |
| `buildAnchorStyle` (anchor) | `mars/style-anchor.ts:140` | `mars/mars.ts:89` | No (`(decomposition, ctx)`, ctx = `{ year, decade }`) | No |
| `assembleStylePortion` (legacy) | `mars/style-template-v1.ts:52` | `mars/mars.ts:77, 99` | No (`({ decomposition })`) | No (header comment at `style-template-v1.ts:5-7,22` explicitly forbids it) |

`marsAssemble` itself (`mars/mars.ts:71`) takes `_outcome?: Outcome` with
an underscore prefix indicating it is intentionally unused
(`mars.ts:73`). The Outcome is **structurally not forwarded** to any
builder — invariant is enforced by Mars's own signature.

The three builders are called regardless of which Eno path runs (both
Eno-1 and Eno-2 call the same `marsAssemble`). No builder is gated by
pipeline.

### Subtlety: the router has its own "mood" slot

The router (`style-router.ts:88, 152`) produces a `mood` slot it stuffs
into the style string. Reading `style-router.ts:62-92`, that slot is
**extractive from the StyleAnalysis source decomposition**, not from the
Outcome — the system prompt requires "EXTRACTIVE OR DEMOTE … Every content
word you emit must either appear in the source decomposition or Track
metadata" (`style-router.ts:68`). Confidence: HIGH that the router's
`mood` is the reference-track's mood, not the Outcome's. The Outcome's
`mood` field still arrives only via the `applyOutcomeFactorPrompt`
prepend.

### Verdict

**No builder bypasses the wrap. No builder inlines tempo/mode/mood.** The
invariant is structurally upheld by:
1. The builders not having access to the Outcome.
2. The wrap being called in both per-seed orchestrators, with no other
   entry into the seed-building flow.

Confidence: HIGH. (This matches the earlier ASSESSMENT.md §4 finding.)

---

## 5. Bernie variants

Three `generateLyrics`-named functions exist. I read all three bodies in
full.

### `bernie/bernie.ts:100` — `generateLyrics(input: BernieInput)`

- **Architecture:** two-pass (draft → edit).
- **Prompts:** DB-backed; `getOrSeedDraftPrompt` (`bernie.ts:62`) +
  `getOrSeedEditPrompt` (`bernie.ts:71`) read from `LyricDraftPrompt` /
  `LyricEditPrompt` tables, cold-start from `proto-bernie/lyrics.ts`'s
  `DRAFT_PROMPT_SEED` / `EDIT_PROMPT_SEED` constants.
- **Model:** `process.env.LYRICIST_MODEL ?? 'claude-sonnet-4-5'`
  (`bernie.ts:14`).
- **Inputs:** `hookText`, `brandLyricGuidelines?`, `arrangementSections?`,
  `formArchetype?`.
- **Post-processing:** hook-preservation invariant
  (`bernie.ts:160-173`) — count hook occurrences in draft vs final; if
  the editor dropped any, return draft as the final output.
- **Caching:** system prompts marked `cache_control: { type: 'ephemeral' }`
  (`bernie.ts:127, 149`).
- **Consumers (production tree only, dist/ excluded):**
  - `apps/server/src/lib/eno/eno.ts:9` (production import) →
    `eno.ts:183`.
  - `apps/server/prisma/seed/test-arranger-eno.ts:7,72` (test script).
  - `apps/server/prisma/seed/test-variance.ts:9,63` (test script).
  - `apps/server/prisma/seed/test-form-archetype.ts:13,67` (test script).

### `bernie/bernie-v2.ts:113` — `generateLyricsV2(input: BernieV2Input)`

- **Architecture:** two-pass (draft → edit). Same as Bernie-1.
- **Prompts:** **Reads from the same DB tables** (`LyricDraftPrompt`,
  `LyricEditPrompt`) via locally-duplicated `getOrSeedDraftPrompt`
  (`bernie-v2.ts:75`) / `getOrSeedEditPrompt` (`bernie-v2.ts:84`). These
  helpers are functionally identical to Bernie-1's same-named private
  helpers — verified by reading both bodies. Cold-start uses the same
  `DRAFT_PROMPT_SEED` / `EDIT_PROMPT_SEED` constants from
  `proto-bernie/lyrics.ts`.
- **Model:** same env var, same default (`bernie-v2.ts:23`).
- **Inputs:** same four as Bernie-1, plus `genreBrief?: GenreBrief | null`
  (`bernie-v2.ts:33-39`).
- **Post-processing:** hook-preservation invariant identical to Bernie-1
  (`bernie-v2.ts:176-187`).
- **Prompt-structure diff (the actual behavioral delta):**
  - Bernie-1 draft user message
    (`bernie.ts:119-122`): hook + formBrief + brandLyricGuidelines +
    arrangementBrief.
  - Bernie-2 draft user message
    (`bernie-v2.ts:139-142`): hook + formBrief + **genreContext** +
    brandLyricGuidelines + arrangementBrief + **genreCraftBlock**.
  - Both edit user messages are **identical** (`bernie.ts:135-144` vs
    `bernie-v2.ts:155-164`). The header comment at `bernie-v2.ts:13`
    declares this explicitly: "The edit pass is identical to Eno-1 —
    genre awareness lives in the draft." Confidence: HIGH (read both).
- **`genreContext`:** built by `formatGenreContext`
  (`bernie-v2.ts:63-73`); prepends "Genre / Era / Groove / Harmonic
  character / Vocal register" lines from the GenreBrief.
- **`genreCraftBlock`:** built by `getGenreCraftOverrides` +
  `formatGenreCraftBlock` from
  `bernie/genre-craft-rules.ts`. Maps genre tags (hip-hop, country, EDM,
  R&B, latin, etc.) to per-family density/rhyme/line-structure/voice/
  typography guidance. Returns null for unknown tags →
  `genreCraftBlock = ''` and Bernie-v2 collapses to the same shape as
  Bernie-1 for that draft.
- **Consumers (production tree only):**
  - `apps/server/src/lib/eno/eno-v2.ts:13,169` — the only caller.

### `proto-bernie/lyrics.ts:84` — `generateLyrics(input: LyricInput)`

- **Architecture:** **single-pass.** Only the draft is run; no edit pass.
- **Prompts:** DB-backed (same `LyricDraftPrompt` table; reads via
  local `getDraftPrompt` at `proto-bernie/lyrics.ts:75-82`). No edit-prompt
  read.
- **Model:** same env var, same default
  (`proto-bernie/lyrics.ts:12`).
- **Inputs:** `hookText`, `brandLyricGuidelines?` only — no arrangement,
  no formArchetype, no genreBrief.
- **Post-processing:** none beyond JSON parsing.
- **Consumers (production tree only):**
  - `apps/server/scripts/compare-modes.ts:17, 86`. Sole consumer. The
    script's top-of-file comment (`compare-modes.ts:1-12`) frames it as a
    dev CLI (`pnpm tsx scripts/compare-modes.ts --artist ...`). It is
    invoked manually — not from any cron, route, or other code path.

### Is `proto-bernie` dead?

The `generateLyrics` function in `proto-bernie/lyrics.ts:84` is **dev-only**:
its sole production-tree consumer is `scripts/compare-modes.ts`, which has
no other importers and is documented as a one-off CLI. Removing that script
would orphan the function entirely.

**But `proto-bernie/lyrics.ts` itself is not dead.** Its other exports
`DRAFT_PROMPT_SEED` (line 26) and `EDIT_PROMPT_SEED` (line 53) are imported
by both `bernie/bernie.ts:10` and `bernie/bernie-v2.ts:17` as the cold-start
seed text for the DB-backed prompts. So the file stays in source; only the
`generateLyrics` function inside it is unreferenced from production.

Confidence: HIGH (verified by grepping every importer of every export).

### Are `scripts/compare-modes.ts` and the `test-*` prisma seed files run
in production?

No evidence of it. None are imported by any route, lib, or cron registration
(`grep -rn "compare-modes\|test-arranger-eno\|test-variance\|test-form-archetype"
apps/server/src apps/admin/src apps/dashboard/src` yields zero hits). They
are all `pnpm tsx`-runnable CLIs from the comment headers. **Confidence:
MEDIUM** that they are truly never run by anything Daniel cares about —
they could still be invoked by hand or by a process the codebase doesn't
encode.

---

## 6. Risk map for consolidating

If Eno-1 were deleted and everything routed through Eno-2 (or vice versa),
the following would have to be reconciled. **No proposal — just an
inventory.**

### HIGH risk — behavioral diffs that would change generated music quality

1. **Lyric generation: Bernie-1 vs Bernie-2 produce different draft
   prompts.** Bernie-2's draft user message adds a `genreContext` block
   (`bernie-v2.ts:132, 142`) and, when the genre tag is in
   `genre-craft-rules.ts`'s family table, a `genreCraftBlock` of
   override guidance. For tracks whose extracted genre tag matches a
   family (hip-hop/country/EDM/R&B/latin per the file header), the draft
   prompt's craft rules differ materially — that's the point of Eno-2.
   For unrecognized genre tags, Bernie-2's `genreCraftBlock` is empty
   string and the only remaining diff is the `genreContext` lines (Genre
   / Era / Groove / Harmonic character / Vocal register) preceding
   brandLyricGuidelines.
   - If Eno-2 became default: every seed gets the genreContext block,
     and seeds for genres in the family table also get craft overrides.
     This is the intended behavior of Eno-2 — but it's a non-trivial
     change to the lyric prompt for every Eno-1-generated track today.
   - If Eno-1 became default (i.e., delete Eno-2): we lose the genre-aware
     craft rules entirely, plus the `genreContext` lines. Tracks
     generated through Eno-2 today would, post-consolidation, get
     pop-default lyric craft.
   Confidence: HIGH.

2. **The Eno-2 draft prompt has an asymmetric edit pass.** Bernie-2's
   edit pass (`bernie-v2.ts:155-164`) does **not** include the
   `genreContext` or `genreCraftBlock` — only the draft does. That's by
   design (`bernie-v2.ts:13`, "The edit pass is identical to Eno-1 —
   genre awareness lives in the draft"). If consolidation tried to make
   Eno-2 fully replace Eno-1, this asymmetry should be preserved or
   explicitly revisited. Confidence: HIGH.

3. **Prompt-cache hit rate.** Both Bernie-1 and Bernie-2 mark the system
   prompt `cache_control: { type: 'ephemeral' }`
   (`bernie.ts:127,149`; `bernie-v2.ts:147,169`). Because Bernie-2's
   *user* message includes per-track genre context (varies per seed),
   the user message cache key is more variable in Bernie-2. The system
   prompt cache is unaffected — the per-genre overrides live in the
   user block specifically to preserve system-prompt caching
   (`bernie-v2.ts:9` comment). Risk: LOW-to-MEDIUM on prompt-cost
   regression; the design already anticipates this.
   Confidence: MEDIUM (cache behavior depends on Anthropic SDK billing
   semantics we'd need to verify against the current claude-api skill
   guidance).

### MEDIUM risk — behavioral diffs in metadata/logging

4. **`SongSeed.pipeline` column.** Eno-2 writes `'eno-2'` on insert,
   success, and failure (`eno-v2.ts:122, 183, 206`). Eno-1 never writes
   it. If we removed Eno-1, every new seed gets `pipeline='eno-2'`. If
   we removed Eno-2, the column on existing Eno-2 seeds remains `'eno-2'`
   forever — historical, and consumers (admin panels, retention queries)
   may or may not still depend on filtering by it.
   - `SongSeedBatch.pipeline` is written by `runEno()` itself
     (`eno.ts:68`) — both pipelines populate that one.
   - Confidence: HIGH on the column-write diff; MEDIUM on whether
     downstream surfaces query/display it (didn't audit admin panel
     usage exhaustively).

5. **`SongSeed.genreBrief` column.** Eno-2 persists the GenreBrief JSON
   (`eno-v2.ts:198`). Eno-1 leaves it null. If Eno-1 were removed,
   every seed gets a `genreBrief`. If Eno-2 were removed, the column
   stays in the schema and the historical rows keep their JSON, but
   new seeds never populate it. Confidence: HIGH on the diff. Whether
   any UI/analytics reads it is unknown without a follow-up grep.

6. **Telemetry text in error paths.** Bernie-1's draft/edit failure
   throws `Bernie draft pass returned no text` /
   `Bernie edit pass returned no text` (`bernie.ts:131, 153`).
   Bernie-2's throws `Bernie-v2 draft pass returned no text` /
   `Bernie-v2 edit pass returned no text` (`bernie-v2.ts:151, 173`).
   No log-grep regression in either direction matters unless someone
   has an alert filter on the literal string. Confidence: HIGH (read
   both).

### LOW risk — pure code duplication, no behavior diff

7. **`getOrSeedDraftPrompt` / `getOrSeedEditPrompt` duplicated.**
   Bernie-1 (`bernie.ts:62-78`) and Bernie-2 (`bernie-v2.ts:75-91`)
   declare these privately. The bodies are byte-identical. Removing
   either file removes one copy; merging them removes the duplication.
   Confidence: HIGH.

8. **`formatArrangementBrief`, `SECTION_ORDER`, `countOccurrences`,
   `parseLyricJson` duplicated** between `bernie.ts:27,34,80,91` and
   `bernie-v2.ts:41,43,93,104`. Byte-identical bodies. Confidence: HIGH.

9. **The shared orchestration scaffold (ref pick, mars call, variance,
   wrap, archetype, injectArrangement, prisma writes).** Already deduped
   via imports (`eno-v2.ts:17-23`) — there is no actual scaffold
   duplication, only the per-seed function shell. Risk of "consolidating"
   here is the lowest: the parallel functions are 95% imports of the
   same code. Confidence: HIGH.

### What does **not** change under consolidation

- Mars (both pipelines call the same `marsAssemble`).
- Variance resolution.
- `applyOutcomeFactorPrompt` semantics (single definition, two call
  sites that pass identical args).
- Hook picker, ref-track picker, archetype picker, arranger — all
  shared imports.
- Schema (the relevant columns — `pipeline`, `genreBrief` — already
  exist on `SongSeed`; the question is whether they get populated).

---

## 7. Open questions for Daniel

1. **Default pipeline strategy.** Today, Eno-1 is the default by *two*
   independent fallbacks (`eno.ts:60` server-side and
   `SongSeedQueue.tsx:69` UI-side). Is the long-term plan to flip the
   default to Eno-2, or to keep Eno-2 as an opt-in lane while Eno-1
   stays the primary path? The answer determines whether consolidation
   is a "delete Eno-1" or a "delete Eno-2" exercise.

2. **Is the asymmetric edit pass (Bernie-2 sees no genre context in
   pass 2) load-bearing?** The header comment at `bernie-v2.ts:13`
   says yes ("genre awareness lives in the draft"). If we collapsed
   onto a single Bernie that always passes the genreBrief to both
   passes, does that change anything you care about?

3. **`SongSeed.pipeline` and `SongSeed.genreBrief` — do any
   non-orchestrator surfaces read these?** I didn't grep every admin
   panel. If Dash or analytics queries filter on
   `pipeline='eno-2'`/`genreBrief NOT NULL`, that constrains
   consolidation.

4. **`proto-bernie/lyrics.ts::generateLyrics` and
   `scripts/compare-modes.ts` — still useful dev tools, or
   prune?** Both were flagged in `ASSESSMENT.md` §6 as zero-importer.
   The seed constants in proto-bernie are load-bearing for Bernie-1 and
   Bernie-2 cold-start; the function and the script are not.

5. **`prisma/seed/test-*.ts` (`test-arranger-eno.ts`,
   `test-variance.ts`, `test-form-archetype.ts`) — are these run by hand
   when validating Bernie changes, or abandoned?** If kept, they are the
   only consumers of `bernie/bernie.ts::generateLyrics` outside Eno-1
   itself and become a pin against deleting Bernie-1.

6. **Genre-tag fall-through.** Bernie-2's `getGenreCraftOverrides` returns
   `null` for any genre tag not in the family table
   (`bernie-v2.ts:133-135`). Should the fall-through behavior (no craft
   overrides, only `genreContext`) be considered a feature, or do we
   want a `pop`-default override row registered as the family for
   unknowns?

7. **Cache-cost regression risk in Bernie-2.** The Bernie-2 draft user
   message varies per seed (genreContext + craft block), which weakens
   user-block reuse across seeds. Has the prompt-cache hit rate been
   measured under Eno-2 traffic, or is it still small enough not to
   matter?

---

## Executive summary

1. Eno-1 (`eno.ts:116`, `createSongSeed`) is the production default; Eno-2
   (`eno-v2.ts:100`, `createSongSeedV2`) is opt-in via a Dash toggle that
   defaults to Eno-1 on both the server (`eno.ts:60`) and the UI
   (`SongSeedQueue.tsx:69`). There is no cron-triggered generation; the
   only entry point is `POST /admin/eno/run` (`routes/admin.ts:3054`).
2. The two per-seed orchestrators are 95% byte-equivalent — Eno-2 imports
   the hook picker, ref picker, outcome-factor wrap, and archetype selector
   directly from Eno-1 (`eno-v2.ts:17-23`). The substantive diffs are
   (a) `generateLyricsV2` vs `generateLyrics`, (b) two extra Prisma column
   writes (`pipeline`, `genreBrief`), and (c) the Eno-2-only
   `extractGenreBrief` helper.
3. Bernie-1 and Bernie-2 are two-pass (draft → edit) and use the same DB-
   backed prompts and same `claude-sonnet-4-5` model. Bernie-2's draft
   user message adds genre context + genre-family craft overrides; its
   edit pass is identical to Bernie-1's. Proto-bernie is single-pass and
   dev-only (sole consumer: `scripts/compare-modes.ts`).
4. The `applyOutcomeFactorPrompt` invariant is structurally upheld: it is
   defined once and called once per pipeline (`eno.ts:151`,
   `eno-v2.ts:139`); none of the three Mars builders receive the Outcome
   at all, so they cannot inline tempo/mode/mood. Confidence HIGH.
5. HIGH-risk consolidation issues live in the lyric prompt diff (genre
   context + craft overrides change every Eno-2 draft); MEDIUM issues
   are the two SongSeed column writes; LOW issues are pure duplication
   in Bernie-1/Bernie-2 helper functions (`getOrSeedDraftPrompt`,
   `formatArrangementBrief`, `parseLyricJson`, etc., all byte-identical).
6. Open questions for Daniel concentrate on (a) which pipeline becomes
   the long-term default, (b) whether downstream Dash surfaces read
   `SongSeed.pipeline`/`genreBrief`, and (c) whether the Bernie-2 cache
   regression has been measured.

Absolute path: `/Users/fox296/Desktop/entuned/entuned-0.3/ASSESSMENT-eno-comparison.md`
