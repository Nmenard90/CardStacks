-- FILE: schema.sql
-- LOCATION: sql/schema.sql
--
-- PURPOSE:
--   Creates all tables in our PostgreSQL database.
--   Run this once when setting up a new database.
--   Safe to run multiple times — "IF NOT EXISTS" prevents errors
--   if tables already exist.
--
-- HOW TO RUN:
--   In Railway: open your PostgreSQL service → Data tab → SQL Editor
--   Paste this entire file and click Run.
--
-- TABLE ORDER MATTERS:
--   Tables that reference other tables (via foreign keys) must be
--   created after the tables they reference. For example, cards
--   references sets, so sets must be created first.
--   Order here: sets → cards → users → collections → binders → trades → reputation

-- ── Enable UUID generation ───────────────────────────────────────────────────
-- PostgreSQL needs this extension to generate UUID primary keys automatically.
-- UUIDs are 128-bit identifiers that are globally unique — no two rows anywhere
-- will ever have the same UUID. Better than auto-increment integers because:
--   1. IDs can be generated on the client without a database round-trip
--   2. IDs don't reveal how many records exist (security)
--   3. Safe to merge data from multiple databases
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── card_sets ────────────────────────────────────────────────────────────────
-- Stores every Pokémon TCG set (Base Set, Scarlet & Violet, etc.)
-- Data comes from the Pokémon TCG API and is refreshed when new sets release.
CREATE TABLE IF NOT EXISTS card_sets (
  -- Primary key: the set ID from the Pokémon TCG API e.g. "sv1", "base1"
  id            TEXT        PRIMARY KEY,

  -- Full set name e.g. "Scarlet & Violet" or "Base Set"
  name          TEXT        NOT NULL,

  -- Series this set belongs to e.g. "Scarlet & Violet", "Sun & Moon"
  -- Used to group sets in the UI dropdown
  series        TEXT        NOT NULL,

  -- The number printed on cards as the denominator e.g. 165 for "4/165"
  -- Secret rares have collector numbers higher than this
  printed_total INTEGER     NOT NULL,

  -- Actual total including secret rares. Always >= printed_total
  total         INTEGER     NOT NULL,

  -- When this set was released. Used to sort sets newest-first
  release_date  DATE        NOT NULL,

  -- URL to the small symbol image shown next to cards
  symbol_url    TEXT        NOT NULL,

  -- URL to the full set logo image
  logo_url      TEXT        NOT NULL,

  -- Code used in Pokémon TCG Online e.g. "SVI"
  -- Used to match sets with TCGTracking price data
  ptcgo_code    TEXT
);

-- ── cards ────────────────────────────────────────────────────────────────────
-- Stores every card from every set.
-- Populated from the Pokémon TCG API.
-- Prices are stored separately and updated more frequently.
CREATE TABLE IF NOT EXISTS cards (
  -- Primary key: card ID from the Pokémon TCG API e.g. "sv1-1", "base1-4"
  id            TEXT        PRIMARY KEY,

  -- Which set this card belongs to
  -- REFERENCES means this must match an id in card_sets — enforced by the DB
  -- ON DELETE CASCADE means if the set is deleted, all its cards are too
  set_id        TEXT        NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,

  -- Card name as printed e.g. "Charizard ex", "Professor's Research"
  name          TEXT        NOT NULL,

  -- Collector number within the set e.g. "4", "251", "TG01"
  -- Stored as TEXT not INTEGER because some numbers are non-numeric
  number        TEXT        NOT NULL,

  -- Rarity as printed e.g. "Common", "Rare Holo", "Special Illustration Rare"
  -- NULL for cards without a rarity (some Energy cards)
  rarity        TEXT,

  -- Illustrator's name. NULL if not listed on the card
  artist        TEXT,

  -- Image URL for the small version (~245×342px). Used in card grids
  image_small   TEXT        NOT NULL,

  -- Image URL for the large version (~745×1040px). Used in card detail view
  image_large   TEXT        NOT NULL,

  -- When this card record was last updated from the API
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on set_id because we frequently query "all cards in set X"
-- Without this index, PostgreSQL would scan every row in the table
-- With it, it jumps directly to the right rows — much faster for large tables
CREATE INDEX IF NOT EXISTS idx_cards_set_id ON cards(set_id);

-- Index on name for search queries
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards USING gin(to_tsvector('english', name));

-- ── card_prices ──────────────────────────────────────────────────────────────
-- Stores per-condition prices for each card, updated from TCGTracking.
-- Separate from cards because prices change frequently (daily/weekly)
-- while card metadata almost never changes.
-- Keeping them separate means we can update prices without rewriting card data.
CREATE TABLE IF NOT EXISTS card_prices (
  id        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  card_id   TEXT        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,

  -- All prices are in USD. NULL means no price data available for that condition.
  -- NM = Near Mint, LP = Lightly Played, MP = Moderately Played,
  -- HP = Heavily Played, DMG = Damaged
  price_nm  NUMERIC(10,2),
  price_lp  NUMERIC(10,2),
  price_mp  NUMERIC(10,2),
  price_hp  NUMERIC(10,2),
  price_dmg NUMERIC(10,2),

  -- When these prices were fetched from TCGTracking
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One price record per card — unique constraint prevents duplicates
  UNIQUE(card_id)
);

CREATE INDEX IF NOT EXISTS idx_card_prices_card_id ON card_prices(card_id);

-- ── users ────────────────────────────────────────────────────────────────────
-- Registered users of PokéTracker.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username   TEXT        NOT NULL UNIQUE,
  email      TEXT        NOT NULL UNIQUE,

  -- 'Collector', 'Vendor', or 'Admin'
  role       TEXT        NOT NULL DEFAULT 'Collector',

  -- Running reputation score. Starts at 0, increases with positive trade ratings
  reputation INTEGER     NOT NULL DEFAULT 0,

  -- City-level location for proximity trade matching e.g. "Austin, TX"
  -- NULL if user has not set a location
  location   TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── collection_entries ───────────────────────────────────────────────────────
-- Each row represents one card in one user's collection.
-- Per-condition quantities are stored as JSONB for flexibility.
-- JSONB is PostgreSQL's binary JSON type — stored efficiently and queryable.
CREATE TABLE IF NOT EXISTS collection_entries (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id       TEXT        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,

  -- JSON array of {condition, quantity, price} objects
  -- e.g. [{"condition":"NM","quantity":2,"price":12.50},
  --        {"condition":"LP","quantity":1,"price":10.62}]
  conditions    JSONB       NOT NULL DEFAULT '[]',

  -- Which condition tab is currently selected in the UI
  -- Persisted so the UI remembers your last selection per card
  selected_cond TEXT        NOT NULL DEFAULT 'NM',

  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One entry per user per card — prevents duplicate rows
  UNIQUE(user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_user_id ON collection_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_card_id ON collection_entries(card_id);

-- ── binders ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS binders (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,

  -- 'Four', 'Nine', or 'Twelve' — cards per page
  pocket_size TEXT        NOT NULL DEFAULT 'Nine',

  -- Optional cover image URL. Set by user, usually a card image they own
  cover_image TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_binders_user_id ON binders(user_id);

-- ── binder_slots ─────────────────────────────────────────────────────────────
-- Individual slots within a binder. Each slot can hold one card.
-- Separate table from binders because a binder can have hundreds of slots
-- and we need to query individual slots efficiently.
CREATE TABLE IF NOT EXISTS binder_slots (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  binder_id   TEXT        NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
  slot_index  INTEGER     NOT NULL,

  -- NULL means this slot is empty
  card_id     TEXT        REFERENCES cards(id) ON DELETE SET NULL,

  -- Cached for display without joining to cards table
  card_name   TEXT,
  image_url   TEXT,

  -- One slot per position per binder
  UNIQUE(binder_id, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_binder_slots_binder_id ON binder_slots(binder_id);

-- ── trade_listings ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_listings (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which card game. 'pokemon' initially, designed to support others later
  game        TEXT        NOT NULL DEFAULT 'pokemon',

  -- Cards being offered — JSON array of TradeCard objects
  offering    JSONB       NOT NULL DEFAULT '[]',

  -- Cards wanted in return. NULL means "make me an offer"
  wants       JSONB,

  -- Whether the lister would accept cash
  cash_ok     BOOLEAN     NOT NULL DEFAULT FALSE,

  -- City-level location e.g. "Austin, TX"
  location    TEXT        NOT NULL,

  -- Optional notes from the lister
  description TEXT,

  -- 'Open', 'Pending', 'Completed', 'Cancelled'
  status      TEXT        NOT NULL DEFAULT 'Open',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_listings_user_id  ON trade_listings(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_listings_status   ON trade_listings(status);
CREATE INDEX IF NOT EXISTS idx_trade_listings_location ON trade_listings(location);

-- ── trade_offers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_offers (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id   TEXT        NOT NULL REFERENCES trade_listings(id) ON DELETE CASCADE,
  from_user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Cards being offered in exchange
  cards        JSONB       NOT NULL DEFAULT '[]',

  -- Optional cash component in USD
  cash_amount  NUMERIC(10,2),

  -- Optional message to the listing owner
  message      TEXT,

  -- 'Pending', 'Accepted', 'Declined', 'Withdrawn'
  status       TEXT        NOT NULL DEFAULT 'Pending',

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_offers_listing_id   ON trade_offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_trade_offers_from_user_id ON trade_offers(from_user_id);

-- ── trade_ratings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_ratings (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  trade_id     TEXT        NOT NULL REFERENCES trade_listings(id) ON DELETE CASCADE,
  from_user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  for_user_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'Positive', 'Neutral', 'Negative'
  rating       TEXT        NOT NULL,

  -- Required for Negative ratings, optional otherwise
  comment      TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One rating per user per trade — prevents rating the same trade twice
  UNIQUE(trade_id, from_user_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_ratings_for_user_id ON trade_ratings(for_user_id);

-- ── user_reports ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_reports (
  id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reported_user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_by_id   TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'FakeCards', 'Misrepresented', 'NoShow', 'Scam', 'Other'
  reason           TEXT        NOT NULL,

  -- Required explanation of what happened
  description      TEXT        NOT NULL,

  -- The trade where this happened, if applicable
  trade_id         TEXT        REFERENCES trade_listings(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_reports_reported_user_id ON user_reports(reported_user_id);

-- ── Migrations ────────────────────────────────────────────────────────────────
-- Additive changes applied after initial setup. Run these in the Railway
-- PostgreSQL service → Data tab → SQL Editor, then redeploy the backend.

-- Migration 001 (BUG-019): Track when prices were last fetched per set.
-- Prevents the backend from calling TCGTracking on every page load when a
-- set has some cards with no TCGTracking data (promos, newer sets, etc.).
-- The Scala code uses this to skip re-fetches that happened < 6 hours ago.
ALTER TABLE card_sets ADD COLUMN IF NOT EXISTS prices_fetched_at TIMESTAMPTZ;
