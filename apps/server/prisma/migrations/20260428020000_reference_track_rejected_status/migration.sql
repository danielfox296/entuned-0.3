-- Adds 'rejected' to ReferenceTrackStatus so operators can soft-discard
-- pending suggestions. The suggester pulls all existing rows (including
-- rejected) when building its "do not repeat" exclusion list, so the LLM
-- learns from rejections.
ALTER TYPE "ReferenceTrackStatus" ADD VALUE IF NOT EXISTS 'rejected';
