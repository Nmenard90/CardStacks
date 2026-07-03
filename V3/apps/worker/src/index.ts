/**
 * File: index.ts
 * Purpose:
 *   Worker entry point for one-off sync commands.
 *
 * Why this file exists:
 *   Railway cron jobs should run one command, finish, and exit cleanly.
 */

import { PrismaClient } from "@prisma/client";
import { loadWorkerEnv } from "./config/env.js";
import { syncCatalog } from "./jobs/sync-catalog.js";
import { syncPrices } from "./jobs/sync-prices.js";

/**
 * Runs the requested worker command.
 */
async function main(): Promise<void> {
  const command = process.argv[2];
  const env = loadWorkerEnv();
  const prisma = new PrismaClient();

  try {
    if (command === "sync-catalog") {
      await syncCatalog(prisma, env);
      return;
    }

    if (command === "sync-prices") {
      await syncPrices(prisma, env);
      return;
    }

    throw new Error(`Unknown worker command: ${command ?? "missing"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
