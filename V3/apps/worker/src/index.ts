/**
 * File: index.ts
 * Purpose:
 *   Worker entry point for one-off sync commands.
 *
 * Why this file exists:
 *   Railway cron jobs should run one command, finish, and exit cleanly.
 *   `main`/`runWorker` are exported so tests can exercise the real
 *   nonzero-exit wiring; the direct-execution guard below keeps that
 *   exercise side-effect-free when this module is imported rather than run.
 */

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadWorkerEnv } from "./config/env.js";
import { resolveWorkerCommand } from "./commands.js";

/**
 * Runs the requested worker command.
 */
export async function main(): Promise<void> {
  const command = process.argv[2];
  const env = loadWorkerEnv();
  const runJob = resolveWorkerCommand(command);
  const prisma = new PrismaClient();

  try {
    await runJob(prisma, env);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Converts any rejection from `main` (invalid environment, unknown command,
 * or a failed job) into a nonzero process exit code instead of an unhandled
 * rejection, so Railway sees the container as failed.
 */
export function runWorker(): Promise<void> {
  return main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void runWorker();
}
