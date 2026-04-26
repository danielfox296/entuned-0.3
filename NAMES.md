# Canonical Name Log — entuned-0.3

Locked 2026-04-26. These are the final names across schema, server, admin, and player.
Old names listed for grep/blame reference only.

---

## Prisma models

| Canonical model | Old name |
|---|---|
| `StyleAnalyzerInstructions` | `MusicologicalRules` |
| `StyleExclusionRule` | `FailureRule` |
| `StyleAnalysis` | `Decomposition` |
| `SongSeed` | `Submission` |
| `SongSeedBatch` | `EnoRun` |
| `HookWriterPrompt` | `HookDrafterPrompt` |
| `OutcomeFactorPrompt` | `OutcomePrependTemplate` |
| `PlaybackEvent` | `AudioEvent` |
| `ScheduleSlot` | `ScheduleRow` |

---

## Prisma fields

| Model | Canonical field | Old field |
|---|---|---|
| `Store` | `outcomeSelectionId` | `manualOverrideOutcomeId` |
| `Store` | `outcomeSelectionExpiresAt` | `manualOverrideExpiresAt` |
| `StyleAnalysis` | `styleAnalyzerInstructionsVersion` | `musicologicalRulesVersion` |
| `ReferenceTrack` | `bucket` → value type `TasteCategory` | `bucket` → `Bucket` enum |
| `SongSeedBatch` | `songSeedBatchId` (PK field) | `enoRunId` |

---

## Prisma enums

| Canonical enum | Old enum |
|---|---|
| `TasteCategory` (`FormationEra \| Subculture \| Aspirational`) | `Bucket` |
| `SongSeedStatus` (`queued \| assembling \| accepted \| abandoned \| skipped \| failed`) | `SubmissionStatus` |

---

## HTTP routes (server)

| Canonical route | Old route |
|---|---|
| `GET/POST /admin/musicological-rules` | same — unchanged |
| `GET/POST/PUT/DELETE /admin/style-exclusion-rules[/:id]` | `/admin/failure-rules[/:id]` |
| `GET/POST /admin/style-template` | same — unchanged |
| `GET/POST /admin/outcome-factor-prompt` | `/admin/outcome-prepend-template` |
| `GET/PUT /admin/icps/:id/hook-writer-prompt` | `/admin/icps/:id/hook-drafter-prompt` |
| `POST /admin/icps/:id/hook-writer/run` | `/admin/icps/:id/hook-drafter/run` |
| `GET /admin/song-seeds` | `/admin/submissions` |
| `GET /admin/song-seeds/:id` | `/admin/submissions/:id` |
| `POST /admin/song-seeds/:id/claim` | `/admin/submissions/:id/claim` |
| `POST /admin/song-seeds/:id/accept` | `/admin/submissions/:id/accept` |
| `POST /admin/song-seeds/:id/abandon` | `/admin/submissions/:id/abandon` |
| `POST /admin/song-seeds/:id/skip` | `/admin/submissions/:id/skip` |
| `POST /admin/stores/:id/outcome-selection` | `/admin/stores/:id/override` |
| `POST /admin/stores/:id/outcome-selection/clear` | `/admin/stores/:id/override/clear` |
| `POST /hendrix/outcome-selection` | `/hendrix/override` |
| `POST /hendrix/outcome-selection/clear` | `/hendrix/override/clear` |

---

## PlaybackEvent types (eventType column + zod enum)

| Canonical | Old |
|---|---|
| `outcome_selection` | `outcome_override` |
| `outcome_selection_cleared` | `outcome_override_cleared` |

---

## R2 key paths

| Canonical prefix | Old prefix |
|---|---|
| `song-seeds/${id}/take-...` | `submissions/${id}/take-...` |

---

## TypeScript types (admin api.ts)

| Canonical type | Old type |
|---|---|
| `StyleExclusionRuleRow` | `FailureRuleRow` |
| `StyleAnalysisRow` | `DecompositionRow` |
| `OutcomeFactorPromptRow` | `OutcomePrependTemplateRow` |
| `SongSeedRow` | `SubmissionRow` |
| `SongSeedDetail` | `SubmissionDetail` |
| `SongSeedStatus` | `SubmissionStatus` |
| `SeedBuilderResult` | `EnoRunResult` |
| `TasteCategory` | `Bucket` |
| `ScheduleSlot` / `ScheduleSlotInput` | `ScheduleRow` / `ScheduleRowInput` |
| `PlaybackEventRow` | `AudioEventRow` |
| `LiveStoreView.active.source: 'selection'` | `source: 'override'` |

---

## TypeScript types (player api.ts)

| Canonical | Old |
|---|---|
| `ActiveOutcome.source: 'selection'` | `source: 'override'` |
| `AudioEventType: 'outcome_selection'` | `'outcome_override'` |
| `AudioEventType: 'outcome_selection_cleared'` | `'outcome_override_cleared'` |
| `api.outcomeSelection(...)` | `api.override(...)` |
| `api.clearOutcomeSelection(...)` | `api.clearOverride(...)` |

---

## Admin API methods (api.ts)

| Canonical method | Old method |
|---|---|
| `styleExclusionRules()` | `failureRules()` |
| `createStyleExclusionRule()` | `createFailureRule()` |
| `updateStyleExclusionRule()` | `updateFailureRule()` |
| `deleteStyleExclusionRule()` | `deleteFailureRule()` |
| `outcomeFactorPrompt()` | `outcomePrependTemplate()` |
| `saveOutcomeFactorPrompt()` | `saveOutcomePrependTemplate()` |
| `hookWriterPrompt()` | `hookDrafterPrompt()` |
| `saveHookWriterPrompt()` | `saveHookDrafterPrompt()` |
| `songSeeds()` | `submissions()` |
| `songSeedDetail()` | `submissionDetail()` |
| `claimSongSeed()` | `claimSubmission()` |
| `acceptSongSeed()` | `acceptSubmission()` |
| `abandonSongSeed()` | `abandonSubmission()` |
| `skipSongSeed()` | `skipSubmission()` |
| `runSeedBuilder()` | `runEno()` |
| `setOutcomeSelection()` | `setOverride()` |
| `clearOutcomeSelection()` | `clearOverride()` |
| `updateStyleAnalysis()` | `updateDecomposition()` |

---

## Source files renamed

| Canonical path | Old path |
|---|---|
| `apps/server/src/lib/mars/style-exclusion-rules.ts` | `failure-rules.ts` |
| `apps/admin/src/panels/seeding/SongSeedQueue.tsx` | `IntentQueue.tsx` |
| `apps/admin/src/panels/seeding/SongSeed.tsx` | `IntentDetail.tsx` |
| `apps/admin/src/panels/seeding/ClosedSongSeeds.tsx` | `AbandonedLog.tsx` |
| `apps/admin/src/panels/engine/OutcomeFactorPrompt.tsx` | `OutcomePrependTemplate.tsx` |

---

## Internal Zod schema vars (admin.ts) — cosmetic only

| Canonical | Old |
|---|---|
| `StyleExclusionRuleBody` | `FailureRuleBody` |
| `HookWriterPromptBody` | `HookDrafterPromptBody` |
| `SongSeedsListQuery` | `SubmissionsListQuery` |
| `SeedBuilderRunBody` | `EnoRunBody` |

---

## UI display strings

| Component | Canonical label | Old label |
|---|---|---|
| `FailureRules.tsx` | "Style Exclusion Rules" | "Failure Rules" |
| `App.tsx` sidebar | "Song Creation" | "Seeding" |
| `App.tsx` sidebar | "Song Seed Queue" | "Intent Queue" |
| `App.tsx` sidebar | "Song Seed" | "Intent Detail" |
| `App.tsx` sidebar | "Closed Song Seeds" | "Abandoned Log" |
| `App.tsx` sidebar | "Outcome Factor Prompt" | "Outcome Prepend Template" |
| `player App.tsx` | "Clear selection" | "Clear override" |
