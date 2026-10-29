-- Migration 021: bring an existing shop_photos table up to what the shop code reads and writes.
-- Production's shop_photos was created with only user_id, card_id, condition, side, image, and migration 019's
-- CREATE TABLE IF NOT EXISTS leaves an existing table alone. The shop reads updated_at on every public shop page
-- (GET /api/shop/:slug) and writes content_type + updated_at with ON CONFLICT (user_id, card_id, condition, side).
-- Run manually in Railway's SQL editor BEFORE deploying that code (see AGENTS.md; nothing runs migrations on deploy).
--
-- All or nothing (one transaction), safe to run twice, and it never changes or removes an image:
--   1. adds content_type and updated_at (existing rows get the defaults);
--   2. labels any existing PNG/WebP photo as such in the new content_type column (the API only accepts JPEG, so
--      normally there are none; nothing reads content_type today — photos are served as image/jpeg);
--   3. makes sure the primary key is exactly (user_id, card_id, condition, side): adds it when the table has none,
--      keeps it when it is already that, and STOPS (rolling everything back) if a different primary key exists,
--      because dropping someone's key is a decision for a person. Duplicate photo keys also stop it.

BEGIN;

ALTER TABLE shop_photos ADD COLUMN IF NOT EXISTS content_type TEXT        NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE shop_photos ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Only the label column is written; image is not touched. JPEG = FF D8 FF, PNG = 89 50 4E 47, WebP = "RIFF"…"WEBP".
UPDATE shop_photos SET content_type = 'image/png'
 WHERE content_type = 'image/jpeg' AND substring(image FROM 1 FOR 4) = '\x89504e47'::bytea;
UPDATE shop_photos SET content_type = 'image/webp'
 WHERE content_type = 'image/jpeg' AND substring(image FROM 1 FOR 4) = '\x52494646'::bytea AND substring(image FROM 9 FOR 4) = '\x57454250'::bytea;

DO $$
DECLARE
  key_columns TEXT[];  -- the existing primary key's columns, alphabetical (column order doesn't matter to ON CONFLICT)
BEGIN
  SELECT array_agg(a.attname::TEXT ORDER BY a.attname::TEXT) INTO key_columns
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'shop_photos'::regclass AND c.contype = 'p';
  IF key_columns IS NULL THEN
    ALTER TABLE shop_photos ADD PRIMARY KEY (user_id, card_id, condition, side);
  ELSIF key_columns <> ARRAY['card_id', 'condition', 'side', 'user_id'] THEN
    RAISE EXCEPTION 'shop_photos already has a different primary key (%). Nothing was changed. Send this to the developer.', array_to_string(key_columns, ', ');
  END IF;
END $$;

COMMIT;

-- Check afterwards (read-only): 7 columns, and the primary key on (user_id, card_id, condition, side).
-- SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
--   WHERE table_name = 'shop_photos' ORDER BY ordinal_position;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'shop_photos'::regclass;
-- SELECT content_type, count(*) FROM shop_photos GROUP BY content_type;
