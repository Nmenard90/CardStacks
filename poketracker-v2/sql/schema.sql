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

-- Migration 002 (BUG-017 groundwork): Append-only price history.
-- card_prices holds only the latest snapshot (one row per card, overwritten
-- on every fetch). This table keeps every snapshot ever fetched so a
-- price-over-time chart is possible. Populated going forward only — no
-- backfill of past prices is possible since they were never recorded.
CREATE TABLE IF NOT EXISTS card_price_history (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  card_id     TEXT        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  price_nm    NUMERIC(10,2),
  price_lp    NUMERIC(10,2),
  price_mp    NUMERIC(10,2),
  price_hp    NUMERIC(10,2),
  price_dmg   NUMERIC(10,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_price_history_card_id ON card_price_history(card_id, recorded_at);

-- Migration 003: Per-variant prices (Normal / Holofoil / Reverse Holofoil /
-- Poké Ball Pattern / Master Ball Pattern).
-- card_prices held one row per card, so a Reverse Holofoil print's higher
-- price silently overwrote (or was overwritten by) its Normal print's price,
-- and Poké Ball/Master Ball Pattern prices — which live on entirely separate
-- TCGTracking products, not a "printing" flag on the base card — were never
-- fetched at all. Adding `variant` and widening the uniqueness constraint to
-- (card_id, variant) lets every priced print of a card get its own row.
-- Existing rows are backfilled as 'Normal' — the safest assumption, since
-- that's what buildPriceMap was implicitly favoring before this migration
-- for cards that only have one print.
ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'Normal';
ALTER TABLE card_prices DROP CONSTRAINT IF EXISTS card_prices_card_id_key;
ALTER TABLE card_prices DROP CONSTRAINT IF EXISTS card_prices_card_id_variant_key;
ALTER TABLE card_prices ADD CONSTRAINT card_prices_card_id_variant_key UNIQUE (card_id, variant);

-- Migration 004 (Rip Tracker — Agent 1: schema only, no app logic/routes/UI).
-- Data model for sealed products, their contents, published pull rates, and
-- rip (box-opening) sessions, so the Rip-or-Hold EV engine and rip-session
-- API (later work) have something to read/write.
--
-- Design notes:
--   * pack_templates.slots is JSONB (array of {rarity, count}) rather than a
--     normalized slot table — matches the existing JSONB-for-flexible-shape
--     pattern already used by collection_entries.conditions and
--     trade_listings.offering, and a pack's slot structure is read as a
--     whole, never queried by individual slot.
--   * product_inserts.card_id is nullable for non-card inserts (player's
--     guide, code card, etc.) that aren't in the cards catalog — description
--     carries what they are in that case.
--   * product_guarantees rows only exist for products where
--     sealed_products.has_guarantee = true. An ungoverned product (most
--     English booster boxes) has zero rows here — the EV engine must NOT
--     infer a guarantee from the schema; hasGuarantee is the single source
--     of truth, checked explicitly.
--   * pull_rates.sealed_product_id (not set_id) is the odds scope — the same
--     card's pull rate can differ between a booster box and an ETB from the
--     same set, so scoping to the product (not just the set) is required for
--     the EV math to be correct.
--   * pulls.collection_entry_id is the provenance link back to the owned
--     copy this pull created/added to — added later by the rip-session API,
--     nullable until then.
CREATE TABLE IF NOT EXISTS sealed_products (
  id                     TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                   TEXT        NOT NULL,
  set_id                 TEXT        NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,

  -- 'booster_box' | 'etb' | 'blister' | 'tin' | 'premium_collection' | ...
  -- Free text, not an enum — new sealed-product kinds ship faster than this
  -- schema would if it had to be migrated for each one.
  kind                   TEXT        NOT NULL,

  pack_count             INTEGER     NOT NULL,

  -- Most English booster boxes are NOT guaranteed a hit/holo — this defaults
  -- false on purpose. Only set true for products that genuinely guarantee
  -- one (certain premium/special products, Japanese products) — see
  -- product_guarantees below.
  has_guarantee          BOOLEAN     NOT NULL DEFAULT FALSE,

  current_sealed_price   NUMERIC(10,2),
  sealed_price_source    TEXT,
  sealed_price_updated_at TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sealed_products_set_id ON sealed_products(set_id);

-- ── pack_templates ───────────────────────────────────────────────────────────
-- The slot structure of one pack for a product. One product usually has one
-- template; UNIQUE is NOT enforced on sealed_product_id alone so a product
-- with genuinely different pack variants (rare) can have more than one.
CREATE TABLE IF NOT EXISTS pack_templates (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sealed_product_id TEXT        NOT NULL REFERENCES sealed_products(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL DEFAULT 'Standard Pack',

  -- JSON array of {"rarity": "Rare Holo", "count": 1} slot objects.
  slots             JSONB       NOT NULL DEFAULT '[]',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pack_templates_product_id ON pack_templates(sealed_product_id);

-- ── product_inserts ──────────────────────────────────────────────────────────
-- Guaranteed non-pack contents: promos, sealed inserts (code cards, player's
-- guides). Every product's guaranteed extras, whether or not the product as
-- a whole has_guarantee — a booster box's promo card is still guaranteed
-- even though the RARE PULL inside the packs is not.
CREATE TABLE IF NOT EXISTS product_inserts (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sealed_product_id TEXT        NOT NULL REFERENCES sealed_products(id) ON DELETE CASCADE,

  -- NULL for inserts that aren't a priced card (player's guide, code card).
  card_id           TEXT        REFERENCES cards(id) ON DELETE SET NULL,
  -- What this insert is when card_id is NULL, e.g. "Code card", "Player's guide".
  description       TEXT,

  guaranteed        BOOLEAN     NOT NULL DEFAULT TRUE,
  quantity          INTEGER     NOT NULL DEFAULT 1,

  CONSTRAINT product_inserts_identifies_something CHECK (card_id IS NOT NULL OR description IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_product_inserts_product_id ON product_inserts(sealed_product_id);

-- ── product_guarantees ───────────────────────────────────────────────────────
-- What's guaranteed per box, for has_guarantee=true products only. A row
-- here means "this product's packs are constrained to deliver this," which
-- is what licenses the EV engine's "remaining-pack odds" adjustment — an
-- ungoverned product (the default) must never get that treatment.
CREATE TABLE IF NOT EXISTS product_guarantees (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sealed_product_id TEXT        NOT NULL REFERENCES sealed_products(id) ON DELETE CASCADE,

  -- Guarantee is by rarity tier (e.g. "at least one Rare Holo") OR a specific
  -- card — exactly one of these two is set, never both, never neither.
  rarity            TEXT,
  card_id           TEXT        REFERENCES cards(id) ON DELETE CASCADE,

  quantity          INTEGER     NOT NULL DEFAULT 1,

  CONSTRAINT product_guarantees_exactly_one_target CHECK (
    (rarity IS NOT NULL AND card_id IS NULL) OR (rarity IS NULL AND card_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_product_guarantees_product_id ON product_guarantees(sealed_product_id);

-- ── pull_rates ───────────────────────────────────────────────────────────────
-- The odds table: how likely one card is to appear in one pack of one
-- product. Scoped to the product (not just the set) because the same card's
-- rate can differ between a booster box and an ETB from the same set.
CREATE TABLE IF NOT EXISTS pull_rates (
  id                     TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  card_id                TEXT        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  sealed_product_id      TEXT        NOT NULL REFERENCES sealed_products(id) ON DELETE CASCADE,

  -- Chance this card appears in a single pack of this product. e.g. a 1-in-256
  -- pull is 0.00390625. NUMERIC (not FLOAT) so tiny probabilities don't lose
  -- precision — this feeds directly into EV math.
  per_pack_probability   NUMERIC(12,8) NOT NULL,

  -- 'published' (official/printed odds) or 'community' (crowd-sourced pull
  -- counting). Never silently treated the same — the EV engine surfaces this.
  source                 TEXT        NOT NULL,
  -- How many packs the community figure is based on. NULL for published
  -- rates (not applicable) or when genuinely unknown — never guessed.
  sample_size            INTEGER,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(card_id, sealed_product_id)
);

CREATE INDEX IF NOT EXISTS idx_pull_rates_product_id ON pull_rates(sealed_product_id);

-- ── rip_sessions ─────────────────────────────────────────────────────────────
-- One box/pack-opening session for one user.
CREATE TABLE IF NOT EXISTS rip_sessions (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sealed_product_id TEXT        NOT NULL REFERENCES sealed_products(id) ON DELETE CASCADE,

  -- 'in_progress' | 'completed'
  status            TEXT        NOT NULL DEFAULT 'in_progress',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rip_sessions_user_id ON rip_sessions(user_id);

-- ── rip_packs ────────────────────────────────────────────────────────────────
-- One pack within a rip session. Auto-generated from the product's
-- pack_count when the session is created (rip-session API, later work).
CREATE TABLE IF NOT EXISTS rip_packs (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rip_session_id TEXT        NOT NULL REFERENCES rip_sessions(id) ON DELETE CASCADE,
  pack_index     INTEGER     NOT NULL,

  UNIQUE(rip_session_id, pack_index)
);

CREATE INDEX IF NOT EXISTS idx_rip_packs_session_id ON rip_packs(rip_session_id);

-- ── pulls ────────────────────────────────────────────────────────────────────
-- One scanned card from one pack. The per-card provenance record: which
-- card, from which pack, from which session, landing in which collection entry.
CREATE TABLE IF NOT EXISTS pulls (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rip_pack_id         TEXT        NOT NULL REFERENCES rip_packs(id) ON DELETE CASCADE,
  card_id             TEXT        NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  condition           TEXT        NOT NULL DEFAULT 'NM',

  -- Provenance link to the collection_entries row this pull landed in.
  -- NULL until the rip-session API (later work) writes it.
  collection_entry_id TEXT        REFERENCES collection_entries(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration 005: Full pokemontcg.io card data + a pokemontcg.io-derived
-- fallback price. `details` is a JSON blob (supertype, attacks, abilities,
-- tcgplayer/cardmarket pricing, embedded set snapshot, etc. — see
-- CardDetails in Card.scala) captured verbatim from the API response, even
-- for fields the app doesn't use yet. `fallback_price_nm` is a Near-Mint
-- price derived from that same response's own tcgplayer/cardmarket data,
-- applied to card_prices.price_nm only when TCGTracking has no price for
-- that card (see PriceService/CardRepository.applyFallbackPrices) — closes
-- the gap for cards TCGTracking's set/card matching can't reach at all.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS fallback_price_nm NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_pulls_rip_pack_id ON pulls(rip_pack_id);

-- Migration 006: Physical storage tracking (boxes -> drawers -> cards).
-- Mirrors real-world stackable card-storage boxes, each with multiple
-- drawers. A card's location lives on collection_entries (one row per
-- user+card already, per the UNIQUE constraint above) rather than a
-- separate join table, since there's no per-copy location in v1 -- all
-- copies of a card the user owns live in the same drawer. Deleting a box
-- or drawer clears drawer_id (ON DELETE SET NULL) rather than touching
-- the owned card itself -- losing a box never loses a card.
CREATE TABLE IF NOT EXISTS storage_boxes (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_storage_boxes_user_id ON storage_boxes(user_id);

CREATE TABLE IF NOT EXISTS storage_drawers (
  id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  box_id     TEXT        NOT NULL REFERENCES storage_boxes(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_storage_drawers_box_id ON storage_drawers(box_id);

ALTER TABLE collection_entries
  ADD COLUMN IF NOT EXISTS drawer_id TEXT REFERENCES storage_drawers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_collection_entries_drawer_id ON collection_entries(drawer_id);
