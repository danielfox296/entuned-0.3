-- Drop Command Center tables (scrapped 2026-05-19, same day shipped).
--
-- The Command Center morning-ritual concept didn't survive contact with
-- reality — Reddit signal density is structurally too low for the scanner
-- thesis to work, and the other surfaces depend on inputs Daniel doesn't
-- have time to feed manually. Tables and code removed in full; migration
-- history kept (per the immutable-history convention) so the create
-- migration above this one is the historical record of what was tried.
--
-- Drop in FK order: content_pieces references proof_points.

DROP TABLE IF EXISTS "content_pieces";
DROP TABLE IF EXISTS "daily_digests";
DROP TABLE IF EXISTS "proof_points";
DROP TABLE IF EXISTS "queue_items";
