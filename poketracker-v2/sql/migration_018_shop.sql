-- Migration 018: per-user public shop + buyer requests from the public /shop/:slug page.
-- Run manually in Railway's SQL editor BEFORE deploying the ShopRoutes code
-- (see AGENTS.md: migrations are not applied on deploy).
--
-- NOTE: these exact tables were already created in production by hand under the
-- working name "017" (before main's migration_017_price_fallbacks.sql was known).
-- Nothing tracks migrations by filename, and every statement is IF NOT EXISTS,
-- so re-running this is a harmless no-op there. A fresh database needs it run once.

-- A user's shop is private until they switch it on. The slug is the public link: /shop/<slug>.
CREATE TABLE IF NOT EXISTS shop_settings (
  user_id       TEXT PRIMARY KEY,
  slug          TEXT        NOT NULL UNIQUE,   -- lowercase letters, digits, dashes; 3-30 chars (enforced in the API)
  enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  messenger_url TEXT        NOT NULL DEFAULT '',  -- optional https://m.me/... link shown as a button
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_requests (
  id             TEXT PRIMARY KEY,
  seller_user_id TEXT        NOT NULL,
  buyer_name     TEXT        NOT NULL,
  buyer_contact  TEXT        NOT NULL,   -- Facebook name / email / phone, whatever the buyer typed
  message        TEXT        NOT NULL DEFAULT '',
  kind           TEXT        NOT NULL DEFAULT 'buy',  -- 'buy' (cards picked) or 'chat' (just a question)
  items          JSONB       NOT NULL DEFAULT '[]',   -- [{cardId, name, number, condition, qty}]
  status         TEXT        NOT NULL DEFAULT 'new',  -- new | answered | done
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_requests_seller ON shop_requests (seller_user_id, created_at DESC);
