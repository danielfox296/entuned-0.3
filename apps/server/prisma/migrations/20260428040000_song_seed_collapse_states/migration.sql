-- Collapse SongSeed lifecycle:
--   * 'skipped' and 'abandoned' are gone — operator workflow is accept-or-delete.
--   * claimed_by / claimed_at are gone — single-operator system.
-- 'failed' (Eno error) and 'assembling' (Eno pre-validation) remain.

DELETE FROM song_seeds WHERE status IN ('skipped', 'abandoned');

ALTER TABLE song_seeds DROP COLUMN claimed_by;
ALTER TABLE song_seeds DROP COLUMN claimed_at;
