-- canonical_renames: apply locked terminology across all tables/columns/enums

-- 1. Rename enums
ALTER TYPE "AudioEventType" RENAME TO "PlaybackEventType";
ALTER TYPE "Bucket" RENAME TO "TasteCategory";

-- 2. Rename enum values
ALTER TYPE "PlaybackEventType" RENAME VALUE 'outcome_override' TO 'outcome_selection';
ALTER TYPE "PlaybackEventType" RENAME VALUE 'outcome_override_cleared' TO 'outcome_selection_cleared';

-- 3. Rename tables
ALTER TABLE "submissions" RENAME TO "song_seeds";
ALTER TABLE "eno_runs" RENAME TO "song_seed_batches";
ALTER TABLE "era_references" RENAME TO "production_eras";
ALTER TABLE "musicological_rules" RENAME TO "style_analyzer_instructions";
ALTER TABLE "decompositions" RENAME TO "style_analyses";
ALTER TABLE "failure_rules" RENAME TO "style_exclusion_rules";
ALTER TABLE "outcome_prepend_templates" RENAME TO "outcome_factor_prompts";
ALTER TABLE "hook_drafter_prompts" RENAME TO "hook_writer_prompts";
ALTER TABLE "rotation_rules" RENAME TO "playback_rules";
ALTER TABLE "audio_events" RENAME TO "playback_events";
ALTER TABLE "schedule_rows" RENAME TO "schedule_slots";

-- hook_drafter_prompt_versions may or may not exist; rename if it does
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hook_drafter_prompt_versions') THEN
    ALTER TABLE "hook_drafter_prompt_versions" RENAME TO "hook_writer_prompt_versions";
  END IF;
END $$;

-- 4. Drop goals table
DROP TABLE IF EXISTS "goals";

-- 5. Rename columns on stores
ALTER TABLE "stores" RENAME COLUMN "manual_override_outcome_id" TO "outcome_selection_id";
ALTER TABLE "stores" RENAME COLUMN "manual_override_expires_at" TO "outcome_selection_expires_at";

-- 6. Rename columns on song_seeds (was submissions)
ALTER TABLE "song_seeds" RENAME COLUMN "eno_run_id" TO "song_seed_batch_id";
ALTER TABLE "song_seeds" RENAME COLUMN "outcome_prepend_template_version" TO "outcome_factor_prompt_version";
ALTER TABLE "song_seeds" RENAME COLUMN "mars_prompt_version" TO "style_template_version";
ALTER TABLE "song_seeds" RENAME COLUMN "bernie_draft_prompt_version" TO "lyric_draft_prompt_version";
ALTER TABLE "song_seeds" RENAME COLUMN "bernie_edit_prompt_version" TO "lyric_edit_prompt_version";
ALTER TABLE "song_seeds" RENAME COLUMN "fired_failure_rule_ids" TO "fired_exclusion_rule_ids";

-- 7. Rename columns on style_analyses (was decompositions)
ALTER TABLE "style_analyses" RENAME COLUMN "musicological_rules_version" TO "style_analyzer_instructions_version";

-- 8. Rename columns on lineage_rows
ALTER TABLE "lineage_rows" RENAME COLUMN "submission_id" TO "song_seed_id";
