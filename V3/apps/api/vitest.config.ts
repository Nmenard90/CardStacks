/**
 * File: vitest.config.ts
 * Purpose:
 *   Configures API tests.
 *
 * Why this file exists:
 *   Tests must run consistently in local development and CI.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node"
  }
});
