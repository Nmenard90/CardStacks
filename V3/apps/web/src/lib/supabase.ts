/**
 * File: supabase.ts
 * Purpose:
 *   Creates the browser Supabase client used only for login/session UI.
 *
 * Why this file exists:
 *   Auth happens with Supabase, but all collection/catalog data still comes
 *   from the backend API.
 *
 * Why the client is lazy:
 *   createClient() throws "supabaseUrl is required" when the env vars are
 *   absent. If we instantiate at module load, then ANY import that transitively
 *   reaches this file (e.g. a route test importing api.ts) crashes at import
 *   time — before a single assertion runs — even when that code never touches
 *   auth. Deferring creation to first use keeps non-auth code paths (and the
 *   tests that exercise them) from requiring runtime credentials.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WEB_ENV } from "./env.js";

let _client: SupabaseClient | undefined;

/**
 * Returns the browser Supabase client, creating it on first call.
 *
 * @return the shared SupabaseClient instance
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(WEB_ENV.supabaseUrl, WEB_ENV.supabaseAnonKey);
  }
  return _client;
}
