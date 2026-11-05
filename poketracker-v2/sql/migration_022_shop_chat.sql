-- Migration 022: shop requests come from signed-in buyers and carry an on-site chat.
-- Buyers now sign in to send a request (or to ask for photos of a card), and the seller and buyer talk in a message
-- thread on the request instead of the buyer typing contact details. Unread badges work like card_offers
-- (migration 015): each side's last-read time against the other side's newest message.
-- Run manually in Railway BEFORE deploying the code that uses it (see AGENTS.md; nothing runs migrations on deploy).
--
-- Additive only, all or nothing (one transaction), safe to run twice. Existing requests keep working: they have no
-- buyer account (buyer_user_id NULL) and keep showing the contact the buyer typed.

BEGIN;

ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS buyer_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS seller_read_at TIMESTAMPTZ;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS buyer_read_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shop_requests_buyer ON shop_requests (buyer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_request_messages (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id     TEXT        NOT NULL REFERENCES shop_requests(id) ON DELETE CASCADE,
  sender_user_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT        NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_request_messages_request ON shop_request_messages (request_id, created_at);

COMMIT;

-- Check (should list the 3 new columns and the new table):
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'shop_requests'
--   AND column_name IN ('buyer_user_id','seller_read_at','buyer_read_at');
-- SELECT to_regclass('public.shop_request_messages');
