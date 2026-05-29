# Decomposition field → consumer contract map

**What this is.** The authoritative map of which decomposition field is read by which downstream pipeline stage, and what actually reaches the final Suno output. Use it before adding, removing, or renaming a `StyleAnalysis` field — it tells you what will break and what is safe to drop.

**Why it exists.** An audit (2026-05-28, 10 most-recent seeds) found that of a ~250-word v8–v12 decomposition, ~5 tokens reached the final Suno style. Most prose was generated, stored, fed to Mars as context, and then discarded by Mars's anchor-and-carve compression. v13 (2026-05-29) restructured the contract to emit only what is consumed, discretely. This doc records the contract so the next person doesn't have to re-derive it.

---

## The pipeline path

```
decompose() ──► StyleAnalysis row ──► normalizeStyleAnalysis() ──► Mars (style) ─┐
                                                              └──► extractGenreBrief() ──► Bernie (lyrics)
                                                              └──► Arranger ([Instrument] tags)
                                       pickReferenceTrack() ──► tempo gate + confidence gate
```

`normalizeStyleAnalysis()` (`lib/eno/eno.ts`) runs once as a StyleAnalysis enters the seed builder. For v13 rows it back-fills the legacy prose field names (`vibePitch`, `harmonicAndGroove`) from the v13 columns, so the entire Mars subsystem reads v13 rows unchanged.

---

## Field-by-field

| Field (v13 column) | Emitted by | Read by | What reaches Suno | Status |
|---|---|---|---|---|
| `genreAnchor` | v13 | Mars anchor builder (via normalized `vibePitch`), Bernie `genreBrief.genreTag` | **The genre tag** — the dominant Suno signal. Most load-bearing field. | **Core** |
| `harmonicCharacter` | v13 | Bernie `genreBrief.harmonicCharacter`; Mars (via normalized `harmonicAndGroove`) for anchor corrections + negative-style scan | Occasionally one cadence as a Mars correction; steers Bernie's lyric craft | **Core** |
| `grooveCharacter` | v13 | Bernie `genreBrief.grooveCharacter`; Mars (via normalized `harmonicAndGroove`) | Steers Bernie groove-aware craft; Mars context | **Core** |
| `vocalGender` | v13 | Mars (`marsAssemble` reads it directly) → `SongSeed.vocalGender` → populate-songs vocal toggle | **The vocal-gender toggle in Suno.** Load-bearing. | **Core** |
| `vocalRegister` | v13 | Bernie `genreBrief.vocalRegister` | Bernie lyric craft (range-aware phrasing) | **Core** |
| `vocalCharacter` | all | Mars anchor builder (carve hints: mic/technique/affect) | 0–2 carve tokens (e.g. "close-mic, breathy") | **Core** |
| `instrumentationPalette` | all | Mars anchor builder | Usually one lead instrument as a correction (e.g. "harpsichord lead") | **Core** |
| `standoutElement` | all | Mars anchor builder (context) | Rarely surfaces directly; overlaps the lead instrument | **Context** |
| `arrangementSections` | v6+ | Arranger (`injectArrangement`) | `[Instrument: …]` tags stapled onto lyric section headers | **Core (separate consumer)** |
| `bpm` | v10+ | `pickReferenceTrack` tempo gate (±7 of outcome tempo) | **Nothing rendered** — selection gate only; outcome owns the rendered tempo | **Core (picker only)** |
| `confidence` | v2+ | `pickReferenceTrack` usability gate (`isDecompositionUsable`) | Nothing rendered; **gates** failed decompositions out of picking | **Core (gate)** |
| `eraProductionSignature` | all | **Negative-style production axis** (`negative-style-axes.ts` haystack); **DB `StyleExclusionRule` rows** (4 live, keyed `triggerField=era_production_signature`); Mars anchor message (context) | **Nothing in positive style** — but feeds the *exclude* box (carving). The positive-style audit missed this; adversarial review (2026-05-29) caught it. **Kept in v13** (compact form). | **Core (carving)** |
| `verifiable_facts` | v2+ | nobody — **grounding device, never persisted** | Nothing | **Keep** — forcing the model to write 3 facts pressures it to actually web-search and identify the track, which is what makes `confidence` honest (the gate depends on it). NOT an audit trail — it isn't stored. Persist it only if you want real audit value. |
| `vibePitch` | v1–v12 | Mars + Bernie (pre-v13 rows only; superseded by `genreAnchor`) | Leading clause → genre, rest dropped | **Legacy** (retained for old rows; normalization fills it from `genreAnchor` for v13) |
| `harmonicAndGroove` | v1–v12 | split into harmonic/groove for pre-v13 rows; populated by normalization for v13 | as above | **Legacy / normalization target** |
| `vocalArrangement` | v1–v12 | Mars (context); 0 DB exclusion rules key on it; vocal staging now lives in `vocalCharacter` (v13 prompt instructs doubling/stacking there) | Almost never landed | **Retired in v13** (folded into `vocalCharacter`) |
| `arrangementShape`, `dynamicCurve` | v1–v7 | nobody | Nothing (null since v8) | **Dead** |

---

## Rules for changing the contract

1. **Adding a field consumed by Mars's exclusion/axis subsystem?** Either feed it through `normalizeStyleAnalysis` into an existing legacy field name, or update `negative-style-axes.ts` (the haystack) and any DB `StyleExclusionRule.triggerField`. The subsystem keys off field *names*.
2. **Removing a field?** Check the "Read by" column. If it's `nobody` or `Context`, it's safe. If `Core`, find the consumer first.
3. **Renaming?** Don't, on existing columns — pre-v13 rows still hold data under the old name. Add a new column and normalize.
4. **No data backfill on version bumps** ("lazy backfill on re-decompose"). New columns are null on old rows; consumers fall back. This is intentional — see schema SSOT Card 05.

---

## Operational notes (lazy decompose + confidence gate)

- **Confidence-gate recovery.** `pickReferenceTrack` excludes `confidence:'low'` rows from both picking and lazy re-decompose (a re-run usually fails the same way and burns a call). This is **not** a permanent strand: the operator route `POST /admin/reference-tracks/:id/decompose` overwrites regardless of confidence, so a track whose metadata gets fixed can be re-decomposed manually and re-enters the pool. Auto-retry in the picker is deliberately omitted.
- **Confidence gate is coarse.** It only catches `'low'`. A confident-but-wrong decomposition (hallucinated genre at `'high'`) still seeds. `verifiable_facts` is the upstream pressure against that, but it isn't stored, so there's no post-hoc catch. Acceptable for now; revisit if confident-wrong shows up in QA.
- **Lazy cross-batch race.** Two concurrent batches for the same ICP can both lazily decompose the same undecomposed track. The `StyleAnalysis.referenceTrackId` unique + `upsert` means no DB corruption (last-writer-wins), but it's a wasted duplicate LLM+web-search call. `runEno` is sequential within a batch, so this only bites concurrent batches for one ICP — operationally rare. No in-flight guard today; add a `decomposing` status if it becomes a cost problem.

## Pre-existing issues surfaced during the v13 review (NOT introduced by v13)

- **2 `StyleExclusionRule` rows key on `dynamic_curve`**, which has been null since decomposer v8. These rules already never fire (on v8–v12 rows too). v13 doesn't change that. Clean up or re-key them.
- **The 4 `era_production_signature` rules use `triggerValue` "196"/"197"/"198"** — written for an older prose era-signature format. The compact v8+ form is "late-90s, polished" (contains "90s", not "196"), so these rules likely under-match on v8–v12 rows already. v13 keeps the field alive (so the *production axis* still works) but does not fix the rule triggerValues. Re-key them to the compact decade-prefix vocabulary ("late-90s", etc.) if they're meant to fire.
