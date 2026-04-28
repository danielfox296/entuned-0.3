-- Add operator-facing display label, decoupled from the LLM-prompt-load-bearing `title`.
ALTER TABLE "outcomes" ADD COLUMN "display_title" TEXT;
