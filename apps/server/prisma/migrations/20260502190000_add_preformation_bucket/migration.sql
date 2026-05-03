-- Add PreFormation to TasteCategory enum.
-- New bucket sibling to FormationEra/Subculture/Aspirational/Adjacent — canonical
-- pre-formation classics that fit the ICP's socio-economic strata growing up.

ALTER TYPE "TasteCategory" ADD VALUE 'PreFormation' BEFORE 'FormationEra';
