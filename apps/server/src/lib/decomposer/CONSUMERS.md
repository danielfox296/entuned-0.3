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
| `verifiable_facts` | v2+ | nobody (audit only — never persisted) | Nothing | **Keep** — it forces web-search fact-finding, which is what makes `confidence` trustworthy. Removing it removes the honesty signal the gate depends on. |
| `vibePitch` | v1–v12 | Mars + Bernie (pre-v13 rows only; superseded by `genreAnchor`) | Leading clause → genre, rest dropped | **Legacy** (retained for old rows) |
| `harmonicAndGroove` | v1–v12 | split into harmonic/groove for pre-v13 rows; populated by normalization for v13 | as above | **Legacy / normalization target** |
| `eraProductionSignature` | v1–v12 | Mars (context, pre-v13) | **Zero** of the 10 audited seeds; decade reaches Suno from the track year instead | **Retired in v13** |
| `vocalArrangement` | v1–v12 | Mars (context) + vocal-gender inference fallback | Almost never landed | **Retired in v13** (folded into `vocalCharacter`) |
| `arrangementShape`, `dynamicCurve` | v1–v7 | nobody | Nothing (null since v8) | **Dead** |

---

## Rules for changing the contract

1. **Adding a field consumed by Mars's exclusion/axis subsystem?** Either feed it through `normalizeStyleAnalysis` into an existing legacy field name, or update `negative-style-axes.ts` (the haystack) and any DB `StyleExclusionRule.triggerField`. The subsystem keys off field *names*.
2. **Removing a field?** Check the "Read by" column. If it's `nobody` or `Context`, it's safe. If `Core`, find the consumer first.
3. **Renaming?** Don't, on existing columns — pre-v13 rows still hold data under the old name. Add a new column and normalize.
4. **No data backfill on version bumps** ("lazy backfill on re-decompose"). New columns are null on old rows; consumers fall back. This is intentional — see schema SSOT Card 05.
