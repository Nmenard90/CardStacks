/**
 * File: supabase.ts
 * Purpose:
 *   Creates the browser Supabase client used only for login/session UI.
 *
 * Why this file exists:
 *   Auth happens with Supabase, but all collection/catalog data still comes
 *   from the backend API.
 */

import { createClient } from "@supabase/supabase-js";
import { WEB_ENV } from "./env.js";

export const supabase = createClient(WEB_ENV.supabaseUrl, WEB_ENV.supabaseAnonKey);
