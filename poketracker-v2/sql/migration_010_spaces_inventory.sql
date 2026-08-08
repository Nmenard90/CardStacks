-- Migration 010: Spaces, physical storage placement, display cases, and
-- condition/variant-aware copy allocation.
--
-- Run this manually in Railway's SQL editor BEFORE deploying backend code
-- that reads these tables/columns. This migration is additive and preserves
-- all legacy collection, storage, and binder data.

BEGIN;

-- A user may own several independently organized rooms/spaces.
CREATE TABLE IF NOT EXISTS collection_spaces (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  space_type  TEXT NOT NULL DEFAULT 'collection_room'
              CHECK (space_type IN ('collection_room','archive','trade_station','showcase','custom')),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_spaces_user
  ON collection_spaces(user_id, position, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_spaces_default
  ON collection_spaces(user_id) WHERE is_default;

INSERT INTO collection_spaces (user_id, name, space_type, is_default, position)
SELECT u.id, 'My Collection Room', 'collection_room', TRUE, 0
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM collection_spaces s WHERE s.user_id = u.id);

-- Ensure users imported from an earlier draft have one default space.
UPDATE collection_spaces s
SET is_default = TRUE, updated_at = NOW()
WHERE s.id = (
  SELECT s2.id FROM collection_spaces s2
  WHERE s2.user_id = s.user_id
  ORDER BY s2.position, s2.created_at, s2.id
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM collection_spaces d
  WHERE d.user_id = s.user_id AND d.is_default
);

-- Furniture is deliberately separate from boxes. A shelf/cabinet owns fixed
-- row and stack coordinates; boxes never float at arbitrary pixel positions.
CREATE TABLE IF NOT EXISTS storage_units (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  space_id              TEXT NOT NULL REFERENCES collection_spaces(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  unit_type             TEXT NOT NULL DEFAULT 'shelf'
                        CHECK (unit_type IN ('shelf','rack','cabinet','closet','custom')),
  preset                TEXT NOT NULL DEFAULT 'custom',
  color                 TEXT NOT NULL DEFAULT '#76533A',
  shelf_count           INTEGER NOT NULL DEFAULT 4 CHECK (shelf_count > 0),
  positions_per_shelf   INTEGER NOT NULL DEFAULT 5 CHECK (positions_per_shelf > 0),
  max_stack_height      INTEGER NOT NULL DEFAULT 3 CHECK (max_stack_height > 0),
  position              INTEGER NOT NULL DEFAULT 0,
  config                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_storage_units_space
  ON storage_units(space_id, position, created_at);

ALTER TABLE storage_boxes
  ADD COLUMN IF NOT EXISTS space_id TEXT REFERENCES collection_spaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_unit_id TEXT REFERENCES storage_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shelf_index INTEGER,
  ADD COLUMN IF NOT EXISTS stack_index INTEGER,
  ADD COLUMN IF NOT EXISTS stack_level INTEGER;

ALTER TABLE binders
  ADD COLUMN IF NOT EXISTS space_id TEXT REFERENCES collection_spaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_unit_id TEXT REFERENCES storage_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shelf_index INTEGER,
  ADD COLUMN IF NOT EXISTS shelf_position INTEGER;

DO $$ BEGIN
  ALTER TABLE storage_boxes ADD CONSTRAINT ck_storage_box_shelf_index CHECK (shelf_index IS NULL OR shelf_index >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE storage_boxes ADD CONSTRAINT ck_storage_box_stack_index CHECK (stack_index IS NULL OR stack_index >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE storage_boxes ADD CONSTRAINT ck_storage_box_stack_level CHECK (stack_level IS NULL OR stack_level >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE binders ADD CONSTRAINT ck_binder_shelf_index CHECK (shelf_index IS NULL OR shelf_index >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE binders ADD CONSTRAINT ck_binder_shelf_position CHECK (shelf_position IS NULL OR shelf_position >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_storage_boxes_space ON storage_boxes(space_id);
CREATE INDEX IF NOT EXISTS idx_storage_boxes_unit ON storage_boxes(storage_unit_id);
CREATE INDEX IF NOT EXISTS idx_binders_space ON binders(space_id);
CREATE INDEX IF NOT EXISTS idx_binders_unit ON binders(storage_unit_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_box_stack_position
  ON storage_boxes(storage_unit_id, shelf_index, stack_index, stack_level)
  WHERE storage_unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_binder_shelf_position
  ON binders(storage_unit_id, shelf_index, shelf_position)
  WHERE storage_unit_id IS NOT NULL;

-- Give every existing user one physical shelf and place their existing items
-- deterministically. Five columns x three boxes high scales without overlap.
INSERT INTO storage_units (space_id, name, unit_type, preset, shelf_count, positions_per_shelf, max_stack_height)
SELECT s.id, 'Main Storage', 'shelf', 'collector_shelf',
       GREATEST(4, CEIL(COUNT(b.id)::numeric / 15.0)::integer), 5, 3
FROM collection_spaces s
LEFT JOIN storage_boxes b ON b.user_id = s.user_id
WHERE s.is_default
  AND NOT EXISTS (SELECT 1 FROM storage_units su WHERE su.space_id = s.id)
GROUP BY s.id;

WITH ranked AS (
  SELECT b.id, s.id AS space_id, su.id AS unit_id,
         ROW_NUMBER() OVER (PARTITION BY b.user_id ORDER BY b.position, b.created_at, b.id) - 1 AS n
  FROM storage_boxes b
  JOIN collection_spaces s ON s.user_id = b.user_id AND s.is_default
  JOIN LATERAL (
    SELECT id FROM storage_units WHERE space_id = s.id ORDER BY position, created_at, id LIMIT 1
  ) su ON TRUE
  WHERE b.space_id IS NULL
)
UPDATE storage_boxes b
SET space_id = r.space_id,
    storage_unit_id = r.unit_id,
    shelf_index = (r.n / 15)::integer,
    stack_index = ((r.n % 15) / 3)::integer,
    stack_level = (r.n % 3)::integer
FROM ranked r WHERE b.id = r.id;

WITH ranked AS (
  SELECT b.id, s.id AS space_id, su.id AS unit_id,
         ROW_NUMBER() OVER (PARTITION BY b.user_id ORDER BY b.updated_at, b.created_at, b.id) - 1 AS n
  FROM binders b
  JOIN collection_spaces s ON s.user_id = b.user_id AND s.is_default
  JOIN LATERAL (
    SELECT id FROM storage_units WHERE space_id = s.id ORDER BY position, created_at, id LIMIT 1
  ) su ON TRUE
  WHERE b.space_id IS NULL
)
UPDATE binders b
SET space_id = r.space_id,
    storage_unit_id = r.unit_id,
    shelf_index = (r.n / 12)::integer,
    shelf_position = (r.n % 12)::integer
FROM ranked r WHERE b.id = r.id;

-- Display cases are first-class furniture, not storage boxes with a new skin.
CREATE TABLE IF NOT EXISTS display_cases (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  space_id        TEXT NOT NULL REFERENCES collection_spaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  case_type       TEXT NOT NULL DEFAULT 'lit_cabinet'
                  CHECK (case_type IN ('wall_case','lit_cabinet','museum_vitrine','floating_shelf','pedestal','custom')),
  preset          TEXT NOT NULL DEFAULT 'custom',
  frame_color     TEXT NOT NULL DEFAULT '#17141F',
  light_color     TEXT NOT NULL DEFAULT '#FFF1B8',
  light_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  shelf_count     INTEGER NOT NULL DEFAULT 3 CHECK (shelf_count > 0),
  slots_per_shelf INTEGER NOT NULL DEFAULT 4 CHECK (slots_per_shelf > 0),
  position        INTEGER NOT NULL DEFAULT 0,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_display_cases_space
  ON display_cases(space_id, position, created_at);

CREATE TABLE IF NOT EXISTS display_slots (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  display_case_id TEXT NOT NULL REFERENCES display_cases(id) ON DELETE CASCADE,
  shelf_index   INTEGER NOT NULL CHECK (shelf_index >= 0),
  slot_index    INTEGER NOT NULL CHECK (slot_index >= 0),
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (display_case_id, shelf_index, slot_index)
);

-- One lot represents fungible copies with the same printed variant, edition,
-- language and condition. This prevents duplicate ownership rows while still
-- allowing any number of physical copies and conditions.
CREATE TABLE IF NOT EXISTS inventory_lots (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL DEFAULT 'standard',
  edition     TEXT NOT NULL DEFAULT 'unlimited',
  language    TEXT NOT NULL DEFAULT 'en',
  condition   TEXT NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, card_id, variant_key, edition, language, condition)
);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_user ON inventory_lots(user_id);

-- An allocation moves some copies from a lot into exactly one physical target.
-- NULL targets are intentionally disallowed: unfiled copies are represented by
-- lot quantity minus allocated quantity, not by a fake container.
CREATE TABLE IF NOT EXISTS card_allocations (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lot_id          TEXT NOT NULL REFERENCES inventory_lots(id) ON DELETE CASCADE,
  drawer_id       TEXT REFERENCES storage_drawers(id) ON DELETE CASCADE,
  binder_slot_id  TEXT REFERENCES binder_slots(id) ON DELETE CASCADE,
  display_slot_id TEXT REFERENCES display_slots(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  protection      TEXT CHECK (protection IS NULL OR protection IN
                    ('raw','sleeved','double_sleeved','toploader','magnetic_holder','graded_slab')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(drawer_id, binder_slot_id, display_slot_id) = 1),
  CHECK (binder_slot_id IS NULL OR quantity = 1),
  CHECK (display_slot_id IS NULL OR quantity = 1)
);
CREATE INDEX IF NOT EXISTS idx_card_allocations_lot ON card_allocations(lot_id);
CREATE INDEX IF NOT EXISTS idx_card_allocations_drawer ON card_allocations(drawer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_allocation_binder_slot
  ON card_allocations(binder_slot_id) WHERE binder_slot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_allocation_display_slot
  ON card_allocations(display_slot_id) WHERE display_slot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_allocation_quantity() RETURNS TRIGGER AS $$
DECLARE owned_qty INTEGER; used_qty INTEGER;
BEGIN
  SELECT quantity INTO owned_qty FROM inventory_lots WHERE id = NEW.lot_id FOR UPDATE;
  IF owned_qty IS NULL THEN RAISE EXCEPTION 'Inventory lot not found'; END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO used_qty
  FROM card_allocations WHERE lot_id = NEW.lot_id AND id <> NEW.id;
  IF used_qty + NEW.quantity > owned_qty THEN
    RAISE EXCEPTION 'Allocation exceeds owned quantity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_allocation_quantity ON card_allocations;
CREATE TRIGGER trg_enforce_allocation_quantity
  BEFORE INSERT OR UPDATE ON card_allocations
  FOR EACH ROW EXECUTE FUNCTION enforce_allocation_quantity();

CREATE OR REPLACE FUNCTION prevent_inventory_underallocation() RETURNS TRIGGER AS $$
DECLARE used_qty INTEGER;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO used_qty FROM card_allocations WHERE lot_id = NEW.id;
  IF NEW.quantity < used_qty THEN
    RAISE EXCEPTION 'Cannot reduce owned quantity below % allocated copies', used_qty;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_inventory_underallocation ON inventory_lots;
CREATE TRIGGER trg_prevent_inventory_underallocation
  BEFORE UPDATE OF quantity ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_underallocation();

-- Legacy ownership had no printed-variant or language fields, so those values
-- are explicitly marked standard/en rather than guessed. Re-running this
-- migration updates quantities without creating duplicate lots.
INSERT INTO inventory_lots
  (user_id, card_id, variant_key, edition, language, condition, quantity)
SELECT ce.user_id, ce.card_id, 'standard',
       CASE WHEN item->>'condition' ILIKE '%1st Ed%' THEN 'first_edition' ELSE 'unlimited' END,
       'en',
       COALESCE(NULLIF(TRIM(REPLACE(item->>'condition', '1st Ed', '')), ''), 'NM'),
       GREATEST(0, COALESCE(NULLIF(item->>'quantity', '')::INTEGER, 0))
FROM collection_entries ce
CROSS JOIN LATERAL jsonb_array_elements(ce.conditions) item
ON CONFLICT (user_id, card_id, variant_key, edition, language, condition)
DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW();

-- Preserve current drawer filing at the condition-copy level. Binder slots are
-- intentionally not guessed because legacy slots did not record condition or
-- variant; the UI can resolve those copies without corrupting inventory.
INSERT INTO card_allocations (lot_id, drawer_id, quantity)
SELECT l.id, ce.drawer_id, l.quantity
FROM collection_entries ce
JOIN inventory_lots l ON l.user_id = ce.user_id AND l.card_id = ce.card_id
WHERE ce.drawer_id IS NOT NULL AND l.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM card_allocations a WHERE a.lot_id = l.id AND a.drawer_id = ce.drawer_id
  );

COMMIT;

-- Verification (safe, read-only): all four counts should return successfully.
SELECT COUNT(*) AS spaces FROM collection_spaces;
SELECT COUNT(*) AS storage_units FROM storage_units;
SELECT COUNT(*) AS inventory_lots FROM inventory_lots;
SELECT COUNT(*) AS allocations FROM card_allocations;
