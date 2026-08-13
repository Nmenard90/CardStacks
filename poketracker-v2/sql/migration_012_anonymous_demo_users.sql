-- Migration 012: mark demo (Supabase anonymous-auth) accounts.
--
-- Run this manually in Railway's SQL editor BEFORE deploying backend code
-- that requires is_anonymous (see AGENTS.md / README "Deployment").
--
-- Additive: adds a NOT NULL column with a default, so it never touches
-- existing rows (they all become is_anonymous = false, which is correct —
-- every pre-existing row is a real Supabase account). Backs the "try the
-- demo, no signup" flow: rows with is_anonymous = true are purged 24h
-- after creation by a cleanup job started in Main.scala.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
