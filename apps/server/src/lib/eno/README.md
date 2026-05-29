# `lib/eno/` — Eno pipeline

Per-seed orchestrator. Turns one queued `SongSeed` into a fully-resolved Suno payload (style + lyric + arrangement + outcome-factor prepend). Called once per song the operator generates from Dash; no cron triggers it.

This README is the canonical map of the **per-seed generation pipeline** — the cast, their boundaries, the flow, and the naming. Read it instead of re-deriving the flow from code. Subsystem internals live in each component's own file; this doc owns how they fit together.

---

## Component cast & boundaries

The pipeline has two tracks — **style** (the Suno style string) and **lyric** (what the singer sings) — plus one annotation pass. Each component does exactly one job and is forbidden from the next column.

| Component | Job (the one thing it does) | Boundary (what it must NOT do) | File / entrypoint | DB rule tables | Harness |
|---|---|---|---|---|---|
| **Eno** | Orchestrate the per-seed flow and persist the `SongSeed` | Hold no rule/prompt text; never write lyric or style strings itself | `eno/eno.ts` · `runEno` / `createSongSeed` | — | `eno.test.ts` |
| **Mars** | Build the Suno style string (anchor-and-carve) | Never receives Outcome; never inlines tempo/mode/mood | `mars/mars.ts` · `marsAssemble` | `MarsContaminationTerm`, `MarsAxisRule`, `GenreGravityRule` | `mars.test.ts` |
| **Music Professor** | Polish the **style** string | Style-only; never touches lyrics; must preserve Mars's genre anchor | `music-professor/music-professor.ts` · `runMusicProfessor` | `MusicProfessorPersona`, `MusicProfessorModule` | `music-professor.test.ts` |
| **Outcome wrap** | Prepend tempo/mode/mood onto the style | The *only* place tempo/mode/mood enter the prompt | `eno/eno.ts` · `applyOutcomeFactorPrompt` | `OutcomeFactorPrompt` | `eno.test.ts` |
| **Song Form** | Pick the song's **shape + per-section arcs** (intention), upstream of the lyric | Structure + intention only — not words, not instruments | `eno/form-archetype.ts` · `pickFormArchetype` | `FormArchetype` (`form_archetypes`) | `form-archetype.test.ts` |
| **Bernie** | Write the lyric draft against the form + hook + briefs | Words only; respects the section structure it's handed, doesn't invent it | `bernie/bernie.ts` · `generateLyrics` | `LyricDraftPrompt`, `GenreCraftRule`, `LyricBanEntry`, `OutcomeLyricFactor` | `bernie.test.ts` |
| **Lyric Professor** | Polish the **lyric** (specificity, inanimate-agency, density, etc.) | Polish, not re-architecture; preserves the hook and section markers verbatim | `professor/professor.ts` · `runProfessor` | `ProfessorPersona`, `ProfessorModule` | `professor.test.ts` |
| **Stager** | Staple per-section instrument / dynamic / vocal tags onto the finished lyric | Annotation only — never changes words or structure | `arranger/arranger.ts` · `injectArrangement` *(rename pending — see below)* | — (reads `StyleAnalysis.arrangementSections`) | `arranger.test.ts` |

**All rule/prompt TEXT lives in the DB**, editable in Dash → Prompts & Rules / Engine. Code holds schemas, loaders, formatters — never rule strings. (See `../../CLAUDE.md` → "Load-bearing rules".)

---

## The "arrangement" disambiguation

The word *arrangement* was overloaded across three unrelated things. It now means exactly one thing — instrumentation — and the other two are renamed:

| Concept | What it is | Side | Canonical name |
|---|---|---|---|
| `FormArchetype` | Song **shape + per-section arcs**; chosen upstream, shapes the lyric | lyric | **Song Form** (Dash label was "Arrangement Formats") |
| `injectArrangement` | Stamps per-section instrument/dynamic/vocal tags onto finished lyrics | annotation | **Stager** (was "the arranger") |
| `StyleAnalysis.arrangementSections` | Decomposer's per-section sonic map from the reference track | data | unchanged — legitimately *arrangement* (instrumentation); it is the Stager's input |

---

## Flow (`createSongSeed`)

1. Pick an approved hook (`pickAvailableHook`) and a compatible reference track (`pickReferenceTrack`).
2. Resolve outcome variance (tempo / mode), then `marsAssemble` builds the style.
3. **Music Professor** polishes the style; `applyOutcomeFactorPrompt` wraps it with the tempo/mode/mood prepend.
4. Build a `GenreBrief` from the reference track's `StyleAnalysis` (+ the Mars anchor tag).
5. **Song Form** picks the shape (and per-section arcs).
6. **Bernie** writes the lyric (`generateLyrics`) from the hook, brand guidelines, genre + outcome briefs, and the Song Form.
7. **Lyric Professor** polishes the lyric.
8. **Stager** injects per-section markers + chorus escalation.
9. Persist everything on the `SongSeed` row (style, lyric, prompt versions, resolved tempo/mode, fired exclusion rules, genre brief, change logs).

Only production entry point: `POST /admin/eno/run` ([routes/admin.ts](../../routes/admin.ts)). Batch driver `runEno` loops `createSongSeed` for `n`, breaks on pool exhaustion, writes the `SongSeedBatch` summary.

---

## Genre awareness

Signal flow: `StyleAnalysis.vibePitch` + `mars.anchor.tag` → `extractGenreBrief` → `BernieInput.genreBrief` → Bernie's draft pass, where `genre-craft-rules.ts` substitutes hip-hop / country / EDM / R&B / latin / indie craft guidance for the pop default.

The Lyric Professor pass is intentionally genre-agnostic: the draft already encoded section structure and genre craft; the editor polishes, it doesn't re-architect. Re-injecting genre context there would pay tokens for input the editor doesn't act on.

---

## Invariants

- **`applyOutcomeFactorPrompt` wraps every Mars style output.** Tempo / mode / mood live on the prepend; Mars never receives Outcome and cannot inline these fields. The most load-bearing rule in the pipeline.
- **Hook preservation.** Bernie falls back to the draft if the editor drops any chorus hook instance. Verified in [`../bernie/bernie.test.ts`](../bernie/bernie.test.ts).
- **Lyric repetition is upstream.** Phrase-level ruts come from thin factor prompts, not ban-list failure. Fix the prompt/rule, not a post-hoc filter.

---

## Song Form arcs — SHIPPED 2026-05-28 · Stager rename + density — pending

Arcs are live. The Stager rename and the density/markup workstream below are still pending.

**The problem (solved by arcs).** Song Form hands Bernie only section *names* (`[Verse 1], [Chorus], …`) + a prose `shapeNote`. Nothing tells a stanza what it should *do*, so verses become texture, not argument. Density and "fractured scene" complaints trace back to this absence of per-stanza intention.

**The fix — arcs, inline on the Song Form row.** Each section carries an **arc**: a one-line directive for what that stanza does and its space/density character ("zoom to one detail," "state then contradict," "address someone," "refrain — repetition is the meaning"). The arc is **subject to the arrangement** — a loop form only ever carries refrain/mantra arcs; a sparse verse carries single-image arcs. That falls out naturally because arcs are authored *per Song Form row*.

**Data model (deliberately minimal — no arc dictionary, no second table, no second surface):**
- `FormArchetype.sectionList` changes from a flat comma-joined **string** to a **structured array** of `{ label, flavor?, arc }`. *(This is the one real schema change. Update `../../../../entune v0.3/schema/` SSOT first, then mirror to `schema.prisma`, then migrate — per `../../CLAUDE.md`.)*
- The arc is plain text **written into each section, per row**. One place to manage it: the Song Form entry.
- **Variety comes from multiple rows per shape** — several `VCVCB` rows, each a different arc coloring on its V's and C's. The existing weighted-random pick across rows provides the variance; no runtime arc-assembly engine. Each row is a human-authored, coherent whole (avoids the machine-glued incoherence that flattened `draft-hooks`).

**Shipped 2026-05-28 (arcs):**
- ✅ Schema: `FormArchetype.sectionList` (flat string) → `sections` JSON — ordered array of `{ label, optional?, arc }`. Migration `20260528000000_form_archetype_section_arcs`.
- ✅ Picker (`form-archetype.ts`): copies `sections`; **skips archetypes with empty `sections`** (migrate→seed safety net); `LEGACY_DEFAULT` carries arcs.
- ✅ Bernie: `formatFormBrief()` renders a per-section brief (each `[Section]` + its arc + restraint note); `stripFlavorAnnotations` deleted (structured fields don't leak parens into lyrics).
- ✅ Dash `FormArchetypes.tsx`: `SectionsEditor` (label · optional · arc, add/remove/reorder) replaces the flat textarea.
- ✅ Seed: 6 forms re-seeded with arcs (weights/era gates unchanged, so shape distribution is preserved). Run via `railway ssh` after deploy.
- Arc content authored from `rules_of_modern_lyricism.md` (serve-the-hook, verse-2-develops, leave-room, restraint, POV). ~18-arc vocabulary + alternate colorings for vcvcbc/vcvc are drafted but **not yet seeded** — add as extra rows when desired.

**Still pending:**
- Rename `arranger/` → `stager/` (dir + entrypoint). Record both renames (Song Form, Stager) in `../../../../NAMES.md` and update `../README.md`'s index row **when that code lands**.
- Density/space workstream: the density/space fixes — keep our existing tempo-derived syllable counts (fewer than the 6–12 the external research suggests), and add the Suno markup levers (hyphens to stretch, matched syllable pairs, blank lines between sections, literal chorus repetition). These are DB rule edits to Bernie's craft rules + possibly Stager formatting — *not* new architecture.
