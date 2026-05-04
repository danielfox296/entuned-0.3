-- General catalogue support: a LineageRow with icp_id IS NULL belongs to the
-- general pool (free-tier stores with no ICPs play from this). hook_id also
-- becomes nullable because Hooks FK to ICPs and general songs have no Hook.
--
-- Daniel hand-curates the general pool by inserting LineageRows with
-- icp_id=NULL, hook_id=NULL pointing at existing songs + outcomes.

ALTER TABLE lineage_rows ALTER COLUMN icp_id DROP NOT NULL;
ALTER TABLE lineage_rows ALTER COLUMN hook_id DROP NOT NULL;
