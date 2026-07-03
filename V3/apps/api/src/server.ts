/**
 * File: server.ts
 * Purpose:
 *   Starts the HTTP API server.
 *
 * Why this file exists:
 *   The entry point should be tiny. It loads environment variables, builds the
 *   app, and starts listening.
 */

import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

/**
 * Starts the API server.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp(env);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
