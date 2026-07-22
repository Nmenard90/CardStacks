/**
 * File: vite.config.ts
 * Purpose:
 *   Configures Vite builds, the preview server used in production, and Vitest.
 *
 * Why this file exists:
 *   Railway serves the built app with `vite preview`. Preview must listen on
 *   the port Railway assigns (PORT env var) and accept requests addressed to
 *   the public Railway domain — Vite's default host check blocks unknown
 *   domains, which surfaces as a bad gateway with no error logs.
 *
 * Why defineConfig comes from "vitest/config":
 *   It's a superset of Vite's defineConfig that also types the `test` block.
 *   Runtime build behavior is unchanged.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  preview: {
    host: true,
    // Railway injects PORT; the 4173 fallback keeps local preview working.
    port: Number(process.env.PORT) || 4173,
    // The app is served under Railway-generated (and later custom) domains
    // that cannot be listed ahead of time. Auth still protects the API; the
    // static frontend has no secrets to shield behind a host check.
    allowedHosts: true
  },
  test: {
    // React component tests (e.g. AppShell.test.tsx) render DOM nodes.
    environment: "jsdom",
    // Loads fake env values before any test module is imported.
    setupFiles: ["./vitest.setup.ts"]
  }
});
