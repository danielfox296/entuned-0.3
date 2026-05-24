-- StyleAnchorPrompt and StyleRouterPrompt: DB-backed system prompts for
-- the Mars LLM-driven style builders, mirroring the LyricDraftPrompt /
-- LyricEditPrompt pattern. Operators iterate via Dash → Prompts & Rules →
-- Mars Prompts without code deploys.
--
-- Schema SSOT: ../../../../entune v0.3/schema/light-cards.md (Card 12 — Mars,
-- "StyleAnchorPrompt and StyleRouterPrompt" section).
--
-- Cold-start: getOrSeed*Prompt() in lib/mars/style-{anchor,router}.ts inserts
-- v1 from a TS const seed when each table is empty. After v1 exists, the TS
-- const is NEVER consulted at runtime.

CREATE TABLE "style_anchor_prompts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "version"     INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"  UUID
);

CREATE UNIQUE INDEX "style_anchor_prompts_version_key" ON "style_anchor_prompts" ("version");

CREATE TABLE "style_router_prompts" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "version"     INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "notes"       TEXT,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"  UUID
);

CREATE UNIQUE INDEX "style_router_prompts_version_key" ON "style_router_prompts" ("version");
