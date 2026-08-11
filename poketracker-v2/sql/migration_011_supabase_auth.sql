-- Migration 011: link user profiles to Supabase Auth.
--
-- Run this manually in Railway's SQL editor BEFORE deploying backend code
-- that requires supabase_user_id (see AGENTS.md / README "Deployment").
--
-- Additive: adds a nullable column + a unique index over the non-null
-- values, so it never touches existing rows. It does NOT backfill
-- supabase_user_id for any pre-existing account — the old login screen
-- had no real passwords, so there is no password to migrate. Any account
-- created under the old system stays in the table (its data isn't
-- deleted) but becomes unreachable through the app until someone signs up
-- again through Supabase; if you want to keep it, update its
-- supabase_user_id by hand to the new Supabase user id once that account
-- has signed up once.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_supabase_user_id
  ON users(supabase_user_id) WHERE supabase_user_id IS NOT NULL;

COMMIT;
