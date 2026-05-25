-- Two new global versioned prompt tables, mirroring LyricDraftPrompt /
-- StyleAnchorPrompt shape. E1 + E3 of the no-prompt-content-in-code migration:
--   - hook_drafter_prompts: replaces hardcoded HOOK_SYSTEM_PROMPT in lib/hooks/drafter.ts
--   - bpm_lookup_prompts:   replaces hardcoded SYSTEM_PROMPT in lib/decomposer/bpm-lookup.ts
--
-- Cold-start: getOrSeed* loaders in each lib file insert v1 from a TS const
-- seed when the table is empty. After v1 exists, the const is NEVER read.

CREATE TABLE "hook_drafter_prompts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "version"     INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"  UUID
);

CREATE UNIQUE INDEX "hook_drafter_prompts_version_key" ON "hook_drafter_prompts" ("version");

CREATE TABLE "bpm_lookup_prompts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "version"     INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"  UUID
);

CREATE UNIQUE INDEX "bpm_lookup_prompts_version_key" ON "bpm_lookup_prompts" ("version");
