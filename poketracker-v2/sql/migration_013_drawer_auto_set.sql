-- ════════════════════════════════════════════════════════════
-- Migration 013 — auto-filing follows the compartment, not the box
-- ════════════════════════════════════════════════════════════
-- Auto-filing used to find "this set's destination" by looking for a BOX
-- with box_type='auto_set:<setId>'. That made it impossible to merge set
-- boxes into one big box as compartments: the moment the set's box was
-- gone, the next card from that set would create a brand-new set box.
--
-- Tagging the compartment (storage_drawers) instead means the tag travels
-- with the compartment wherever it's moved. Existing auto-filed boxes are
-- backfilled below by tagging their first compartment, which is the one
-- auto-filing has always used.
--
-- Run BEFORE deploying backend code that reads auto_set_id. Safe to re-run.

ALTER TABLE storage_drawers ADD COLUMN IF NOT EXISTS auto_set_id TEXT;

UPDATE storage_drawers d
SET auto_set_id = substring(b.box_type FROM 10)   -- strips the 'auto_set:' prefix
FROM storage_boxes b
WHERE b.id = d.box_id
  AND b.box_type LIKE 'auto_set:%'
  AND d.auto_set_id IS NULL
  AND d.id = (SELECT d2.id FROM storage_drawers d2 WHERE d2.box_id = b.id ORDER BY d2.created_at LIMIT 1);

CREATE INDEX IF NOT EXISTS idx_storage_drawers_auto_set ON storage_drawers(auto_set_id) WHERE auto_set_id IS NOT NULL;
