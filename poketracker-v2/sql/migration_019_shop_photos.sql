-- Migration 019: seller photos of the actual cards in their shop (front + back, per condition).
-- Run manually in Railway's SQL editor BEFORE deploying the code that reads/writes
-- shop_photos (see AGENTS.md: migrations are not applied on deploy).
-- Every statement is IF NOT EXISTS, so running it twice is harmless.

CREATE TABLE IF NOT EXISTS shop_photos (
  user_id      TEXT        NOT NULL,
  card_id      TEXT        NOT NULL,
  condition    TEXT        NOT NULL,   -- condition key of the copy photographed (NM, LP, "NM · reverse", ...)
  side         TEXT        NOT NULL CHECK (side IN ('front', 'back')),
  image        BYTEA       NOT NULL,   -- JPEG, checked and size-capped by the API (<= 1.5 MB)
  content_type TEXT        NOT NULL DEFAULT 'image/jpeg',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, card_id, condition, side)
);
