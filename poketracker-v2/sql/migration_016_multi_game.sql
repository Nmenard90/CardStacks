-- Migration 016: multiple card games.
--
-- Adds a `games` table and tags the catalog (card_sets, cards) and every
-- top-level user container (collection_spaces, storage_boxes, binders,
-- card_offers) with the game it belongs to. Each game is its own world:
-- a user's Pokémon collection, boxes, binders, Spaces and offers are
-- separate from their Japanese-Pokémon (or Magic, ...) ones.
--
-- Purely additive. Every existing row becomes game 'pokemon' via the column
-- default, so the current app keeps working unchanged. Safe to re-run.
-- Run manually in Railway's SQL editor BEFORE pushing the backend that
-- reads these columns.
--
-- Shelf units, display cases, drawers, slots and allocations hang off a
-- Space/box/binder, and collection_entries / inventory_lots /
-- trade_list_items hang off a card — they inherit the game through those
-- and need no column of their own.

BEGIN;

CREATE TABLE IF NOT EXISTS games (
  -- Stable slug used everywhere in the API: 'pokemon', 'pokemon-jp', 'mtg'
  id                   TEXT        PRIMARY KEY,
  name                 TEXT        NOT NULL,
  short_name           TEXT        NOT NULL,
  -- Where the card catalog comes from. 'pokemontcg' = pokemontcg.io (English
  -- Pokémon only, priced via TCGTracking name matching); 'tcgtracking' =
  -- TCGTracking for cards, images and prices alike.
  catalog_source       TEXT        NOT NULL CHECK (catalog_source IN ('pokemontcg','tcgtracking')),
  -- TCGTracking's category id (3 = Pokemon, 85 = Pokemon Japan, 1 = Magic...)
  tcgtracking_category INTEGER     NOT NULL UNIQUE,
  -- Only enabled games are offered in the app.
  enabled              BOOLEAN     NOT NULL DEFAULT FALSE,
  position             INTEGER     NOT NULL DEFAULT 0,
  -- Which printing's price is a card's "default" price, first match wins
  -- (e.g. Normal before Holofoil; Magic: Normal before Foil).
  print_preference     TEXT[]      NOT NULL DEFAULT ARRAY['Normal','Holofoil'],
  -- Whether condition keys may carry a " 1st Ed" suffix for this game.
  has_first_edition    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO games (id, name, short_name, catalog_source, tcgtracking_category, enabled, position, print_preference, has_first_edition) VALUES
  ('pokemon',    'Pokémon',                'Pokémon',    'pokemontcg',  3,  TRUE,  0, ARRAY['Normal','Holofoil'], TRUE),
  ('pokemon-jp', 'Pokémon (Japanese)',     'Pokémon JP', 'tcgtracking', 85, TRUE,  1, ARRAY['Normal','Holofoil'], FALSE),
  ('mtg',        'Magic: The Gathering',   'Magic',      'tcgtracking', 1,  FALSE, 2, ARRAY['Normal','Foil'],     FALSE),
  ('yugioh',     'Yu-Gi-Oh!',              'Yu-Gi-Oh!',  'tcgtracking', 2,  FALSE, 3, ARRAY['Unlimited','1st Edition','Normal'], FALSE),
  ('onepiece',   'One Piece Card Game',    'One Piece',  'tcgtracking', 68, FALSE, 4, ARRAY['Normal','Foil'],     FALSE),
  ('lorcana',    'Disney Lorcana',         'Lorcana',    'tcgtracking', 71, FALSE, 5, ARRAY['Normal','Foil','Cold Foil'], FALSE)
ON CONFLICT (id) DO NOTHING;

-- Catalog -------------------------------------------------------------------
ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS game_id     TEXT NOT NULL DEFAULT 'pokemon' REFERENCES games(id);
-- The source's own set id (TCGTracking set id) for tcgtracking games.
ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE INDEX IF NOT EXISTS idx_card_sets_game ON card_sets(game_id, release_date DESC);

-- Denormalized from the set so searches/collections can filter by game
-- without a join on every query.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'pokemon' REFERENCES games(id);
CREATE INDEX IF NOT EXISTS idx_cards_game ON cards(game_id);

-- User containers -----------------------------------------------------------
ALTER TABLE collection_spaces ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'pokemon' REFERENCES games(id);
ALTER TABLE storage_boxes     ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'pokemon' REFERENCES games(id);
ALTER TABLE binders           ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'pokemon' REFERENCES games(id);
ALTER TABLE card_offers       ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'pokemon' REFERENCES games(id);

CREATE INDEX IF NOT EXISTS idx_collection_spaces_user_game ON collection_spaces(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_storage_boxes_user_game     ON storage_boxes(user_id, game_id);
CREATE INDEX IF NOT EXISTS idx_binders_user_game           ON binders(user_id, game_id);

-- NOTE: uq_collection_spaces_default (one is_default Space per user) is
-- deliberately left alone — the backend running when this migration is
-- applied names it in an ON CONFLICT clause, and dropping it would break
-- the Spaces landing page until the new backend deploys. The new backend
-- marks only the 'pokemon' Space is_default and treats each other game's
-- first Space as that game's home (creation serialized by an advisory lock).

COMMIT;
