/**
 * File: vite.config.ts
 * Purpose:
 *   Configures Vite builds and the preview server used in production.
 *
 * Why this file exists:
 *   Railway serves the built app with `vite preview`. Preview must listen on
 *   the port Railway assigns (PORT env var) and accept requests addressed to
 *   the public Railway domain — Vite's default host check blocks unknown
 *   domains, which surfaces as a bad gateway with no error logs.
 */

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  }
});
