/**
 * File: index.ts
 * Purpose:
 *   Worker entry point for one-off sync commands.
 *
 * Why this file exists:
 *   Railway cron jobs should run one command, finish, and exit cleanly. This
 *   file is only ever meant to be executed as the process entry point, never
 *   imported — the testable command-dispatch logic lives in commands.ts so
 *   importing it never triggers this file's process-level side effects.
 */

import { PrismaClient } from "@prisma/client";
import { loadWorkerEnv } from "./config/env.js";
import { resolveWorkerCommand } from "./commands.js";

/**
 * Runs the requested worker command.
 */
async function main(): Promise<void> {
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
