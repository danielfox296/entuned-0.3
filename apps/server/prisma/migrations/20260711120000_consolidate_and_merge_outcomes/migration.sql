-- Outcome catalog consolidation (product decision 2026-07-11).
--
-- Two problems, one migration:
--
-- 1. VERSION CONSOLIDATION. Copy-on-write Outcome version bumps left FK rows
--    (lineage_rows, hooks, song_seeds, schedule_slots, store defaults)
--    pointing at superseded versions. Those rows are invisible to every
--    picker/pool query that filters superseded_at IS NULL — e.g. 86 active
--    LineageRows pinned to Upbeat v4 while the picker counts only v5.
--    Fix: re-point every FK from a superseded version to the active outcome
--    with the same outcome_key. Keys with no active successor are untouched.
--
-- 2. MERGE 8 PAID OUTCOMES -> 5. The catalog collapsed into ~4 acoustic
--    clusters (identical tempo/mode specs) with pools too thin to
--    differentiate. Merge along the clusters so each surviving outcome
--    inherits its siblings' pools and future generation depth:
--      Swagger Spend    -> Trade Them Up   (both premium-spend, 74/108 same family)
--      Help Them Decide -> Trade Them Up   (72 vs 74 BPM, both minor)
--      Fill the Basket  -> Grab It Now     (both more-items-in-basket)
--    Surviving paid catalog: Stay & Browse, Keep It Moving, Trade Them Up,
--    Grab It Now, Our Sound (+ free modes Chill, Steady, Upbeat).
--
-- Names are resolved from live COALESCE(display_title, title) — never
-- hardcoded ids — so this no-ops cleanly on databases without these rows.
-- PlaybackEvents keep their historical outcome ids (analytics history).

-- ============================================================
-- Step 1 — version consolidation: superseded version -> active same-key
-- ============================================================

UPDATE lineage_rows lr SET outcome_id = act.id
FROM outcomes old, outcomes act
WHERE lr.outcome_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

UPDATE hooks h SET outcome_id = act.id
FROM outcomes old, outcomes act
WHERE h.outcome_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

UPDATE song_seeds ss SET outcome_id = act.id
FROM outcomes old, outcomes act
WHERE ss.outcome_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

UPDATE song_seed_batches sb SET outcome_id = act.id
FROM outcomes old, outcomes act
WHERE sb.outcome_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

UPDATE schedule_slots s SET outcome_id = act.id
FROM outcomes old, outcomes act
WHERE s.outcome_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

UPDATE stores st SET default_outcome_id = act.id
FROM outcomes old, outcomes act
WHERE st.default_outcome_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

UPDATE stores st SET outcome_selection_id = act.id
FROM outcomes old, outcomes act
WHERE st.outcome_selection_id = old.id
  AND old.superseded_at IS NOT NULL
  AND act.outcome_key = old.outcome_key
  AND act.superseded_at IS NULL;

-- ============================================================
-- Step 2 — merge absorbed outcomes into absorbers (all versions, by key)
-- ============================================================

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE lineage_rows lr SET outcome_id = a.absorber_id
FROM absorbed_ids a WHERE lr.outcome_id = a.absorbed_id;

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE hooks h SET outcome_id = a.absorber_id
FROM absorbed_ids a WHERE h.outcome_id = a.absorbed_id;

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE song_seeds ss SET outcome_id = a.absorber_id
FROM absorbed_ids a WHERE ss.outcome_id = a.absorbed_id;

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE song_seed_batches sb SET outcome_id = a.absorber_id
FROM absorbed_ids a WHERE sb.outcome_id = a.absorbed_id;

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE schedule_slots s SET outcome_id = a.absorber_id
FROM absorbed_ids a WHERE s.outcome_id = a.absorbed_id;

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE stores st SET default_outcome_id = a.absorber_id
FROM absorbed_ids a WHERE st.default_outcome_id = a.absorbed_id;

WITH pairs AS (
  SELECT absorbed_active.outcome_key AS absorbed_key, absorber_active.id AS absorber_id
  FROM (VALUES
    ('Swagger Spend',    'Trade Them Up'),
    ('Help Them Decide', 'Trade Them Up'),
    ('Fill the Basket',  'Grab It Now')
  ) AS m(absorbed_name, absorber_name)
  JOIN outcomes absorbed_active
    ON absorbed_active.superseded_at IS NULL
   AND COALESCE(absorbed_active.display_title, absorbed_active.title) = m.absorbed_name
  JOIN outcomes absorber_active
    ON absorber_active.superseded_at IS NULL
   AND COALESCE(absorber_active.display_title, absorber_active.title) = m.absorber_name
), absorbed_ids AS (
  SELECT o.id AS absorbed_id, p.absorber_id
  FROM outcomes o JOIN pairs p ON o.outcome_key = p.absorbed_key
)
UPDATE stores st SET outcome_selection_id = a.absorber_id
FROM absorbed_ids a WHERE st.outcome_selection_id = a.absorbed_id;

-- ============================================================
-- Step 3 — retire the absorbed outcomes (all remaining active versions)
-- ============================================================

UPDATE outcomes SET superseded_at = now()
WHERE superseded_at IS NULL
  AND COALESCE(display_title, title) IN ('Swagger Spend', 'Help Them Decide', 'Fill the Basket');

-- ============================================================
-- Step 4 — allowlist hygiene: drop entries whose key has no active outcome
-- ============================================================

DELETE FROM free_tier_outcomes
WHERE outcome_key NOT IN (
  SELECT outcome_key FROM outcomes WHERE superseded_at IS NULL
);
