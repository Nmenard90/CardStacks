-- One-time cleanup: merges inventory_lots rows that were mistakenly
-- tagged edition='first_edition' by the sticky "1st Ed" toggle bug fixed
-- in fix/bulk-add-first-edition-sticky-toggle (BUG-023) — the toggle is
-- one persistent checkbox for a whole Add & File session and doesn't
-- reset per card, so leaving it on (or hitting "." by accident) silently
-- split a card already owned as 'unlimited' into a second, separate
-- first_edition lot for any set that never had a real 1st Edition print
-- run (everything after Neo Destiny, 2002-02-28).
--
-- This only targets lots whose card's set releaseDate is on/after
-- 2002-03-01 — genuine vintage 1st Edition holdings (Base Set through
-- Neo Destiny) are left untouched.
--
-- Run in Railway's SQL editor (or via a real psql/pg client), one
-- statement at a time. Read every PREVIEW output before running the
-- matching merge step.

-- ============================================================
-- 1) PREVIEW — affected lots. Safe, read-only.
-- ============================================================
SELECT il.id AS mistaken_lot_id, il.user_id, c.name AS card_name, cs.name AS set_name,
       cs.release_date, il.condition, il.quantity AS mistaken_qty,
       sibling.id AS sibling_unlimited_lot_id, sibling.quantity AS sibling_qty
FROM inventory_lots il
JOIN cards c ON c.id = il.card_id
JOIN card_sets cs ON cs.id = c.set_id
LEFT JOIN inventory_lots sibling
  ON sibling.user_id = il.user_id AND sibling.card_id = il.card_id
 AND sibling.variant_key = il.variant_key AND sibling.language = il.language
 AND sibling.condition = il.condition AND sibling.edition = 'unlimited'
WHERE il.edition = 'first_edition'
  AND cs.release_date >= '2002-03-01'
  AND il.quantity > 0
ORDER BY il.user_id, c.name;

-- ============================================================
-- 2) MERGE card_allocations — re-home each mistaken lot's placements
--    onto the sibling unlimited lot, combining with any allocation
--    already sitting in the same drawer/binder slot/display slot.
-- ============================================================
BEGIN;

-- 2a. Ensure every mistaken lot has a sibling unlimited lot to merge into
--     (creates one with quantity 0 if the card was never owned unlimited).
INSERT INTO inventory_lots (user_id, card_id, variant_key, edition, language, condition, quantity)
SELECT DISTINCT il.user_id, il.card_id, il.variant_key, 'unlimited', il.language, il.condition, 0
FROM inventory_lots il
JOIN cards c ON c.id = il.card_id
JOIN card_sets cs ON cs.id = c.set_id
WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0
ON CONFLICT (user_id, card_id, variant_key, edition, language, condition) DO NOTHING;

-- 2b. For allocations that would collide (same sibling lot + same
--     drawer/binder_slot/display_slot already allocated), add the
--     mistaken allocation's quantity onto the existing one.
WITH mistaken AS (
  SELECT il.id AS mistaken_lot_id, sibling.id AS sibling_lot_id
  FROM inventory_lots il
  JOIN cards c ON c.id = il.card_id
  JOIN card_sets cs ON cs.id = c.set_id
  JOIN inventory_lots sibling
    ON sibling.user_id = il.user_id AND sibling.card_id = il.card_id
   AND sibling.variant_key = il.variant_key AND sibling.language = il.language
   AND sibling.condition = il.condition AND sibling.edition = 'unlimited'
  WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0
),
colliding AS (
  SELECT ca.id AS mistaken_alloc_id, existing.id AS existing_alloc_id, ca.quantity AS move_qty
  FROM card_allocations ca
  JOIN mistaken m ON m.mistaken_lot_id = ca.lot_id
  JOIN card_allocations existing
    ON existing.lot_id = m.sibling_lot_id
   AND existing.drawer_id IS NOT DISTINCT FROM ca.drawer_id
   AND existing.binder_slot_id IS NOT DISTINCT FROM ca.binder_slot_id
   AND existing.display_slot_id IS NOT DISTINCT FROM ca.display_slot_id
)
UPDATE card_allocations existing
SET quantity = existing.quantity + colliding.move_qty, updated_at = NOW()
FROM colliding
WHERE existing.id = colliding.existing_alloc_id;

WITH mistaken AS (
  SELECT il.id AS mistaken_lot_id, sibling.id AS sibling_lot_id
  FROM inventory_lots il
  JOIN cards c ON c.id = il.card_id
  JOIN card_sets cs ON cs.id = c.set_id
  JOIN inventory_lots sibling
    ON sibling.user_id = il.user_id AND sibling.card_id = il.card_id
   AND sibling.variant_key = il.variant_key AND sibling.language = il.language
   AND sibling.condition = il.condition AND sibling.edition = 'unlimited'
  WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0
),
colliding_ids AS (
  SELECT ca.id AS mistaken_alloc_id
  FROM card_allocations ca
  JOIN mistaken m ON m.mistaken_lot_id = ca.lot_id
  JOIN card_allocations existing
    ON existing.lot_id = m.sibling_lot_id
   AND existing.drawer_id IS NOT DISTINCT FROM ca.drawer_id
   AND existing.binder_slot_id IS NOT DISTINCT FROM ca.binder_slot_id
   AND existing.display_slot_id IS NOT DISTINCT FROM ca.display_slot_id
)
DELETE FROM card_allocations WHERE id IN (SELECT mistaken_alloc_id FROM colliding_ids);

-- 2c. Any remaining mistaken allocations (no collision) just move onto
--     the sibling lot directly.
WITH mistaken AS (
  SELECT il.id AS mistaken_lot_id, sibling.id AS sibling_lot_id
  FROM inventory_lots il
  JOIN cards c ON c.id = il.card_id
  JOIN card_sets cs ON cs.id = c.set_id
  JOIN inventory_lots sibling
    ON sibling.user_id = il.user_id AND sibling.card_id = il.card_id
   AND sibling.variant_key = il.variant_key AND sibling.language = il.language
   AND sibling.condition = il.condition AND sibling.edition = 'unlimited'
  WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0
)
UPDATE card_allocations ca
SET lot_id = m.sibling_lot_id, updated_at = NOW()
FROM mistaken m
WHERE ca.lot_id = m.mistaken_lot_id;

-- 2d. Fold the mistaken lot's quantity into the sibling, then zero the
--     mistaken lot (matches this app's existing "remove" convention —
--     inventory_lots rows are zeroed, not deleted).
WITH mistaken AS (
  SELECT il.id AS mistaken_lot_id, sibling.id AS sibling_lot_id, il.quantity AS mistaken_qty
  FROM inventory_lots il
  JOIN cards c ON c.id = il.card_id
  JOIN card_sets cs ON cs.id = c.set_id
  JOIN inventory_lots sibling
    ON sibling.user_id = il.user_id AND sibling.card_id = il.card_id
   AND sibling.variant_key = il.variant_key AND sibling.language = il.language
   AND sibling.condition = il.condition AND sibling.edition = 'unlimited'
  WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0
)
UPDATE inventory_lots sibling
SET quantity = sibling.quantity + m.mistaken_qty, updated_at = NOW()
FROM mistaken m
WHERE sibling.id = m.sibling_lot_id;

WITH mistaken AS (
  SELECT il.id AS mistaken_lot_id
  FROM inventory_lots il
  JOIN cards c ON c.id = il.card_id
  JOIN card_sets cs ON cs.id = c.set_id
  WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0
)
UPDATE inventory_lots
SET quantity = 0, updated_at = NOW()
WHERE id IN (SELECT mistaken_lot_id FROM mistaken);

COMMIT;

-- ============================================================
-- 3) VERIFY — should return zero rows.
-- ============================================================
SELECT il.id, c.name, cs.release_date, il.quantity
FROM inventory_lots il
JOIN cards c ON c.id = il.card_id
JOIN card_sets cs ON cs.id = c.set_id
WHERE il.edition = 'first_edition' AND cs.release_date >= '2002-03-01' AND il.quantity > 0;
