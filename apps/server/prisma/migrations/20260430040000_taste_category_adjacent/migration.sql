-- Adds the fourth TasteCategory: 'Adjacent'.
-- Tracks the ICP would unexpectedly enjoy — slightly off-axis from core taste.
-- Drives playlist-level texture variation; ~1-in-5 plays come from this bucket.

ALTER TYPE "TasteCategory" ADD VALUE IF NOT EXISTS 'Adjacent';
