/**
 * File: env.ts
 * Purpose:
 *   Reads browser environment variables.
 *
 * Why this file exists:
 *   The frontend needs API and Supabase URLs without hard-coding deployment
 *   values into source code.
 */

export const WEB_ENV = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string
};
