/**
 * File: commands.ts
 * Purpose:
 *   Maps explicit worker CLI command strings to job functions.
 *
 * Why this file exists:
 *   Railway's per-service start command (see railway.catalog-sync.toml /
 *   railway.price-sync.toml) and `pnpm start:sync-catalog` /
 *   `pnpm start:sync-prices` must agree on the exact command strings. Keeping
 *   the mapping here, separate from index.ts, keeps it importable in tests
 *   without triggering index.ts's top-level process entry point.
 */

import type { PrismaClient } from "@prisma/client";
import type { WorkerEnv } from "./config/env.js";
import { syncCatalog } from "./jobs/sync-catalog.js";
import { syncPrices } from "./jobs/sync-prices.js";

export const WORKER_COMMANDS = {
  "sync-catalog": syncCatalog,
  "sync-prices": syncPrices
} as const satisfies Record<string, (prisma: PrismaClient, env: WorkerEnv) => Promise<void>>;

export type WorkerCommand = keyof typeof WORKER_COMMANDS;

/**
 * Resolves an argv command string to its job function.
 *
 * Throws for a missing or unrecognized command so the process exits nonzero
 * instead of silently doing nothing.
 */
export function resolveWorkerCommand(command: string | undefined): (typeof WORKER_COMMANDS)[WorkerCommand] {
  if (command !== undefined && command in WORKER_COMMANDS) {
    return WORKER_COMMANDS[command as WorkerCommand];
  }

  throw new Error(`Unknown worker command: ${command ?? "missing"}`);
}
