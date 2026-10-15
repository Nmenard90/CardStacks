-- Migration 017: price fallbacks so every card has a price.
--
-- TCGplayer (via TCGTracking) has no market price for some cards — no recent
-- sales. For TCGTracking-sourced games those cards now fall back to
-- Cardmarket's public price guide (converted to the TCGplayer scale), and
-- failing that to an estimate from similar cards in the same set.
--
--   cards.cardmarket_id      — Cardmarket product id (TCGTracking provides it)
--   card_prices.price_source — NULL = TCGplayer market price;
--                              'cardmarket' or 'estimate' for fallbacks
--   games.cardmarket_game    — Cardmarket's game id for its price-guide file
--
-- Purely additive and safe to re-run. Run manually in Railway's SQL editor
-- BEFORE pushing the backend that writes these columns.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS cardmarket_id INTEGER;
ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS price_source TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS cardmarket_game INTEGER;

UPDATE games SET cardmarket_game = CASE id
    WHEN 'pokemon'    THEN 6
    WHEN 'pokemon-jp' THEN 6
    WHEN 'onepiece'   THEN 18
    WHEN 'lorcana'    THEN 19
    WHEN 'mtg'        THEN 1
    WHEN 'yugioh'     THEN 3
  END
WHERE cardmarket_game IS NULL;
