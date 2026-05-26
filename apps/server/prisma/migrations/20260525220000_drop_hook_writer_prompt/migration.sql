-- Drop the orphaned HookWriterPrompt + HookWriterPromptVersion tables.
-- These were per-ICP customization that was never wired into the live hook
-- drafter; the live drafter prompt has lived in HookDrafterPrompt since
-- 2026-05-25. 12 hook_writer_prompts rows + 3 hook_writer_prompt_versions rows
-- are stale and will be removed by the drop.

DROP TABLE IF EXISTS "hook_writer_prompt_versions";
DROP TABLE IF EXISTS "hook_writer_prompts";
