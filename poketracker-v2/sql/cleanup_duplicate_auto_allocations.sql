-- One-time cleanup: merges card_allocations rows split by the
-- protection NULL-vs-'raw' mismatch fixed in
-- fix/auto-allocation-protection-mismatch. Only drawer placements are
-- affected (binder/display slots were never touched by that bug).
--
-- Run in Railway's SQL editor, same as a normal migration. Wrapped in a
-- transaction so it's all-or-nothing.

-- 1) PREVIEW ONLY — run this by itself first to see what will change.
--    Safe, read-only.
SELECT lot_id, drawer_id, COUNT(*) AS row_count, SUM(quantity) AS total_qty,
       array_agg(id ORDER BY created_at) AS allocation_ids,
       array_agg(protection ORDER BY created_at) AS protections
FROM card_allocations
WHERE drawer_id IS NOT NULL
GROUP BY lot_id, drawer_id
HAVING COUNT(*) > 1;

-- 2) ACTUAL MERGE — once the preview looks right, run this block.
BEGIN;

-- Keep the oldest row per (lot_id, drawer_id); give it the summed
-- quantity and a definite 'raw' protection.
WITH dupes AS (
  SELECT lot_id, drawer_id,
         (array_agg(id ORDER BY created_at))[1] AS keep_id,
         SUM(quantity) AS total_qty
  FROM card_allocations
  WHERE drawer_id IS NOT NULL
  GROUP BY lot_id, drawer_id
  HAVING COUNT(*) > 1
)
UPDATE card_allocations ca
SET quantity = d.total_qty, protection = 'raw', updated_at = NOW()
FROM dupes d
WHERE ca.id = d.keep_id;

-- Delete every other row in each duplicated group.
WITH dupes AS (
  SELECT lot_id, drawer_id,
         (array_agg(id ORDER BY created_at))[1] AS keep_id
  FROM card_allocations
  WHERE drawer_id IS NOT NULL
  GROUP BY lot_id, drawer_id
  HAVING COUNT(*) > 1
)
DELETE FROM card_allocations ca
USING dupes d
WHERE ca.lot_id = d.lot_id AND ca.drawer_id = d.drawer_id AND ca.id <> d.keep_id;

COMMIT;

-- 3) VERIFY — should return zero rows.
SELECT lot_id, drawer_id, COUNT(*)
FROM card_allocations
WHERE drawer_id IS NOT NULL
GROUP BY lot_id, drawer_id
HAVING COUNT(*) > 1;
