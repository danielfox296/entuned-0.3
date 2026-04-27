-- AlterTable
ALTER TABLE "hook_writer_prompt_versions" RENAME CONSTRAINT "hook_drafter_prompt_versions_pkey" TO "hook_writer_prompt_versions_pkey";

-- AlterTable
ALTER TABLE "hook_writer_prompts" RENAME CONSTRAINT "hook_drafter_prompts_pkey" TO "hook_writer_prompts_pkey";

-- AlterTable
ALTER TABLE "outcome_factor_prompts" RENAME CONSTRAINT "outcome_prepend_templates_pkey" TO "outcome_factor_prompts_pkey";

-- AlterTable
ALTER TABLE "outcomes" ADD COLUMN     "cultural_category_prime" TEXT,
ADD COLUMN     "familiarity" TEXT,
ADD COLUMN     "pleasure_target" TEXT,
ADD COLUMN     "production_era" TEXT;

-- AlterTable
ALTER TABLE "playback_events" RENAME CONSTRAINT "audio_events_pkey" TO "playback_events_pkey";

-- AlterTable
ALTER TABLE "playback_rules" RENAME CONSTRAINT "rotation_rules_pkey" TO "playback_rules_pkey";

-- AlterTable
ALTER TABLE "production_eras" RENAME CONSTRAINT "era_references_pkey" TO "production_eras_pkey";

-- AlterTable
ALTER TABLE "schedule_slots" RENAME CONSTRAINT "schedule_rows_pkey" TO "schedule_slots_pkey";

-- AlterTable
ALTER TABLE "song_seed_batches" RENAME CONSTRAINT "eno_runs_pkey" TO "song_seed_batches_pkey";

-- AlterTable
ALTER TABLE "song_seeds" RENAME CONSTRAINT "submissions_pkey" TO "song_seeds_pkey";

-- AlterTable
ALTER TABLE "style_analyses" RENAME CONSTRAINT "decompositions_pkey" TO "style_analyses_pkey";

-- AlterTable
ALTER TABLE "style_analyzer_instructions" RENAME CONSTRAINT "musicological_rules_pkey" TO "style_analyzer_instructions_pkey";

-- AlterTable
ALTER TABLE "style_exclusion_rules" RENAME CONSTRAINT "failure_rules_pkey" TO "style_exclusion_rules_pkey";

-- RenameForeignKey
ALTER TABLE "hook_writer_prompts" RENAME CONSTRAINT "hook_drafter_prompts_icp_id_fkey" TO "hook_writer_prompts_icp_id_fkey";

-- RenameForeignKey
ALTER TABLE "lineage_rows" RENAME CONSTRAINT "lineage_rows_submission_id_fkey" TO "lineage_rows_song_seed_id_fkey";

-- RenameForeignKey
ALTER TABLE "playback_events" RENAME CONSTRAINT "audio_events_operator_id_fkey" TO "playback_events_operator_id_fkey";

-- RenameForeignKey
ALTER TABLE "playback_events" RENAME CONSTRAINT "audio_events_song_id_fkey" TO "playback_events_song_id_fkey";

-- RenameForeignKey
ALTER TABLE "playback_events" RENAME CONSTRAINT "audio_events_store_id_fkey" TO "playback_events_store_id_fkey";

-- RenameForeignKey
ALTER TABLE "schedule_slots" RENAME CONSTRAINT "schedule_rows_outcome_id_fkey" TO "schedule_slots_outcome_id_fkey";

-- RenameForeignKey
ALTER TABLE "schedule_slots" RENAME CONSTRAINT "schedule_rows_store_id_fkey" TO "schedule_slots_store_id_fkey";

-- RenameForeignKey
ALTER TABLE "song_seeds" RENAME CONSTRAINT "submissions_eno_run_id_fkey" TO "song_seeds_song_seed_batch_id_fkey";

-- RenameForeignKey
ALTER TABLE "song_seeds" RENAME CONSTRAINT "submissions_hook_id_fkey" TO "song_seeds_hook_id_fkey";

-- RenameForeignKey
ALTER TABLE "song_seeds" RENAME CONSTRAINT "submissions_outcome_id_fkey" TO "song_seeds_outcome_id_fkey";

-- RenameForeignKey
ALTER TABLE "song_seeds" RENAME CONSTRAINT "submissions_reference_track_id_fkey" TO "song_seeds_reference_track_id_fkey";

-- RenameForeignKey
ALTER TABLE "stores" RENAME CONSTRAINT "stores_manual_override_outcome_id_fkey" TO "stores_outcome_selection_id_fkey";

-- RenameForeignKey
ALTER TABLE "style_analyses" RENAME CONSTRAINT "decompositions_musicological_rules_version_fkey" TO "style_analyses_style_analyzer_instructions_version_fkey";

-- RenameForeignKey
ALTER TABLE "style_analyses" RENAME CONSTRAINT "decompositions_reference_track_id_fkey" TO "style_analyses_reference_track_id_fkey";

-- RenameIndex
ALTER INDEX "hook_drafter_prompt_versions_icp_id_version_idx" RENAME TO "hook_writer_prompt_versions_icp_id_version_idx";

-- RenameIndex
ALTER INDEX "hook_drafter_prompt_versions_icp_id_version_key" RENAME TO "hook_writer_prompt_versions_icp_id_version_key";

-- RenameIndex
ALTER INDEX "hook_drafter_prompts_icp_id_key" RENAME TO "hook_writer_prompts_icp_id_key";

-- RenameIndex
ALTER INDEX "outcome_prepend_templates_version_key" RENAME TO "outcome_factor_prompts_version_key";

-- RenameIndex
ALTER INDEX "audio_events_store_id_event_type_occurred_at_idx" RENAME TO "playback_events_store_id_event_type_occurred_at_idx";

-- RenameIndex
ALTER INDEX "audio_events_store_id_hook_id_occurred_at_idx" RENAME TO "playback_events_store_id_hook_id_occurred_at_idx";

-- RenameIndex
ALTER INDEX "audio_events_store_id_occurred_at_idx" RENAME TO "playback_events_store_id_occurred_at_idx";

-- RenameIndex
ALTER INDEX "audio_events_store_id_song_id_occurred_at_idx" RENAME TO "playback_events_store_id_song_id_occurred_at_idx";

-- RenameIndex
ALTER INDEX "era_references_decade_genre_slug_key" RENAME TO "production_eras_decade_genre_slug_key";

-- RenameIndex
ALTER INDEX "era_references_decade_idx" RENAME TO "production_eras_decade_idx";

-- RenameIndex
ALTER INDEX "schedule_rows_store_id_day_of_week_idx" RENAME TO "schedule_slots_store_id_day_of_week_idx";

-- RenameIndex
ALTER INDEX "eno_runs_icp_id_started_at_idx" RENAME TO "song_seed_batches_icp_id_started_at_idx";

-- RenameIndex
ALTER INDEX "submissions_eno_run_id_idx" RENAME TO "song_seeds_song_seed_batch_id_idx";

-- RenameIndex
ALTER INDEX "submissions_hook_id_idx" RENAME TO "song_seeds_hook_id_idx";

-- RenameIndex
ALTER INDEX "submissions_icp_id_status_idx" RENAME TO "song_seeds_icp_id_status_idx";

-- RenameIndex
ALTER INDEX "submissions_status_idx" RENAME TO "song_seeds_status_idx";

-- RenameIndex
ALTER INDEX "decompositions_reference_track_id_key" RENAME TO "style_analyses_reference_track_id_key";

-- RenameIndex
ALTER INDEX "decompositions_status_idx" RENAME TO "style_analyses_status_idx";

-- RenameIndex
ALTER INDEX "musicological_rules_version_key" RENAME TO "style_analyzer_instructions_version_key";

-- RenameIndex
ALTER INDEX "failure_rules_trigger_field_idx" RENAME TO "style_exclusion_rules_trigger_field_idx";
