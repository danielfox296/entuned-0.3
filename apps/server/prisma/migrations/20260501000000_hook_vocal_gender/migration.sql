-- Hook vocal-gender constraint for Eno's hook-to-ref-track matching.
-- Null = unconstrained (default for all 83 existing hooks). Eno only enforces
-- the vocal-gender match when this field is set.

ALTER TABLE "hooks" ADD COLUMN "vocal_gender" TEXT;
