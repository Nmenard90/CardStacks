/**
 * Supabase client — the single source of truth for who's signed in.
 * Reads the project URL/anon key baked in at build time (see .env.example
 * for local dev, .env.production for the production build). The anon key
 * is safe to ship in the frontend bundle by design — it can only do what
 * Supabase's Row Level Security policies (and, for this app, our own
 * backend's token verification) allow.
 *
 * USED BY: context/UserContext, components/LoginScreen, api/client
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — sign-up and login will not work until these are set. See .env.example.'
  )
}

// createClient throws synchronously on an empty/invalid URL, which would
// otherwise take down the entire app at import time before any page even
// renders. Falling back to a placeholder keeps the app usable (everything
// except auth) when the env vars simply haven't been configured yet.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key')
