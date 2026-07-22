/**
 * File: vitest.setup.ts
 * Purpose:
 *   Provides safe, fake environment values for the test run.
 *
 * Why this file exists:
 *   Vitest does not load Railway/production env vars, and it should not — real
 *   secrets must never live in unit tests. Tests that DO exercise auth still
 *   need *some* non-empty values so createClient() doesn't throw. These fakes
 *   satisfy that without pointing at anything real. Non-auth tests don't rely
 *   on this at all now that the Supabase client is lazy (see src/lib/supabase.ts).
 *
 *   vi.stubEnv populates both process.env and import.meta.env, and setupFiles
 *   run before test modules are imported, so env.ts sees these when it evaluates.
 */

import { vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:4000");
