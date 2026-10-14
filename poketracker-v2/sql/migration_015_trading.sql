-- Migration 015: Share links, trade lists, offers and offer message threads.
--
-- Purely additive (four new tables, nothing existing is altered) and safe to
-- re-run. Run manually in Railway's SQL editor BEFORE pushing the backend
-- code that reads/writes these tables (TradingRepository).
--
-- The older trade_listings / trade_offers tables (location-based listings,
-- never wired to any route) are left untouched — this feature is built
-- around a per-user share link instead of standalone listings.

BEGIN;

-- One share link per user. `slug` is a random, unguessable token — it's the
-- only thing that grants read access to a user's trade list (and, when
-- collection_public is on, their whole collection). Regenerating it revokes
-- every old link.
CREATE TABLE IF NOT EXISTS share_profiles (
  user_id           TEXT        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slug              TEXT        NOT NULL UNIQUE,
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  collection_public BOOLEAN     NOT NULL DEFAULT FALSE,
  bio               TEXT        CHECK (bio IS NULL OR length(bio) <= 500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cards a user has hand-picked as available for trade/sale.
-- `condition` is a collection condition key, e.g. 'NM' or 'LP 1st Ed'.
CREATE TABLE IF NOT EXISTS trade_list_items (
  id           TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id      TEXT          NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  condition    TEXT          NOT NULL,
  quantity     INTEGER       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- NULL = "make me an offer"
  asking_price NUMERIC(10,2) CHECK (asking_price IS NULL OR asking_price >= 0),
  note         TEXT          CHECK (note IS NULL OR length(note) <= 300),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, card_id, condition)
);
CREATE INDEX IF NOT EXISTS idx_trade_list_items_user ON trade_list_items(user_id);

-- An offer from a buyer on a seller's cards. `wants` = cards the buyer wants
-- from the seller; `gives` = cards the buyer puts up from their own
-- collection. Both are JSON arrays of OfferCard snapshots (name, image and
-- market price captured at offer time). No money moves through the app —
-- cash_amount is what the buyer proposes to pay, settled off-platform.
CREATE TABLE IF NOT EXISTS card_offers (
  id             TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id      TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_id       TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wants          JSONB         NOT NULL DEFAULT '[]',
  gives          JSONB         NOT NULL DEFAULT '[]',
  cash_amount    NUMERIC(10,2) CHECK (cash_amount IS NULL OR cash_amount >= 0),
  status         TEXT          NOT NULL DEFAULT 'Pending'
                 CHECK (status IN ('Pending','Accepted','Declined','Withdrawn','Cancelled','Completed')),
  -- Unread tracking: an offer is unread for a side when updated_at is newer
  -- than that side's read marker.
  seller_read_at TIMESTAMPTZ,
  buyer_read_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (seller_id <> buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_card_offers_seller ON card_offers(seller_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_offers_buyer  ON card_offers(buyer_id, updated_at DESC);

-- The chat thread attached to each offer.
CREATE TABLE IF NOT EXISTS offer_messages (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  offer_id   TEXT        NOT NULL REFERENCES card_offers(id) ON DELETE CASCADE,
  sender_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offer_messages_offer ON offer_messages(offer_id, created_at);

COMMIT;
