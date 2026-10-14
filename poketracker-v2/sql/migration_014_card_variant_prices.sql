-- Migration 014: Per-print prices (Normal / Holo / Reverse Holo /
-- Poké Ball Pattern / Master Ball Pattern).
--
-- A separate table, NOT a change to card_prices: card_prices keeps exactly one
-- row per card (the default print) so every existing query and the
-- ON CONFLICT (card_id) upsert keep working untouched. See Migration 003 /
-- 013 for what went wrong the last time card_prices itself was widened.
--
-- Purely additive and safe to re-run. Run manually in Railway's SQL editor
-- BEFORE pushing the backend code that reads/writes this table.

CREATE TABLE IF NOT EXISTS card_variant_prices (
  card_id    TEXT        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  -- normal | holo | reverse | pokeball | masterball
  variant    TEXT        NOT NULL,
  price_nm   NUMERIC(10,2),
  price_lp   NUMERIC(10,2),
  price_mp   NUMERIC(10,2),
  price_hp   NUMERIC(10,2),
  price_dmg  NUMERIC(10,2),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (card_id, variant)
);

-- Check: should return one row, card_variant_prices.
SELECT table_name FROM information_schema.tables WHERE table_name = 'card_variant_prices';
