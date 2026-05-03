-- Add Outcome.mood (required free-text affect phrase, leads OutcomeFactorPrompt prefix).
-- Three-step pattern so existing rows aren't rejected by NOT NULL:
--   1. add nullable column
--   2. backfill the 9 existing active rows + any superseded rows
--   3. set NOT NULL

ALTER TABLE "outcomes" ADD COLUMN "mood" TEXT;

UPDATE "outcomes" SET "mood" = CASE outcome_key
  WHEN 'b434800e-08b7-4bda-ab3a-04a2d9153506' THEN 'tender, hushed'           -- Arousal Down
  WHEN '5bf57ce8-f4d1-4011-9b54-7e28d65e7d36' THEN 'excited, energized'       -- Arousal Up
  WHEN '33333333-3333-3333-3333-333333333333' THEN 'confident, solid'         -- Brand Reinforcement
  WHEN 'e50bb3ae-dc63-44eb-8d03-ae9acaede0ee' THEN 'inviting, easygoing'      -- Conversion
  WHEN '0ffa6e2e-6c09-48e1-8aae-a431636ee799' THEN 'urgent, propulsive'       -- Dwell Compression
  WHEN 'dc8f550d-9330-4c97-8a9f-91670f05b50b' THEN 'thoughtful, reflective'   -- Dwell Extension
  WHEN '6bee45e6-911c-4ea0-899f-bb6668e672ee' THEN 'playful, optimistic'      -- Impulse
  WHEN '5b24bf95-95ed-402f-aa0d-3003448bac99' THEN 'classic, refined'         -- Transaction Value
  WHEN 'e318387a-1294-4cbb-9c3c-ebb30e16b741' THEN 'ecstatic, energetic'      -- Unit Addition
  ELSE 'neutral'  -- safety default for any superseded rows we missed; visible in audit
END;

ALTER TABLE "outcomes" ALTER COLUMN "mood" SET NOT NULL;
