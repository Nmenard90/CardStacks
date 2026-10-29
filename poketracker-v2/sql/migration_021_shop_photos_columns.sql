-- Migration 021: bring an existing shop_photos table up to what the shop code reads and writes.
-- Production's shop_photos was created with only user_id, card_id, condition, side, image, and migration 019's
-- CREATE TABLE IF NOT EXISTS leaves an existing table alone. The shop reads updated_at on every public shop page
-- (GET /api/shop/:slug) and writes content_type + updated_at with ON CONFLICT (user_id, card_id, condition, side).
-- Run manually in Railway's SQL editor BEFORE deploying that code (see AGENTS.md).
--
-- Additive only: adds the two missing columns (existing rows get the defaults) and, if the table has no primary
-- key, the one the upsert needs. Nothing is changed or removed. Safe to run twice. If two existing rows share the
-- same user/card/condition/side, adding the key fails and the whole migration rolls back — tell the developer.

BEGIN;

ALTER TABLE shop_photos ADD COLUMN IF NOT EXISTS content_type TEXT        NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE shop_photos ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'shop_photos'::regclass AND contype = 'p') THEN
    ALTER TABLE shop_photos ADD PRIMARY KEY (user_id, card_id, condition, side);
  END IF;
END $$;

COMMIT;

-- Check afterwards (read-only): expect 7 columns and a primary key on (user_id, card_id, condition, side).
-- SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
--   WHERE table_name = 'shop_photos' ORDER BY ordinal_position;
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'shop_photos'::regclass;
