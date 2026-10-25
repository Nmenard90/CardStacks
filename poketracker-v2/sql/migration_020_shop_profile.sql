-- Seller-written shop profile. Apply manually before deploying the profile code.
-- Existing shops keep their URL, visibility and Messenger link, with blank profiles.
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio VARCHAR(1000) NOT NULL DEFAULT '';
