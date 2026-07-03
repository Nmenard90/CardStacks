/**
 * File: env.ts
 * Purpose:
 *   Validates worker environment variables.
 *
 * Why this file exists:
 *   Sync jobs should fail immediately when required API/database settings are
 *   missing instead of writing partial bad data.
 */

import { z } from "zod";

const workerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  POKEMON_TCG_API_URL: z.string().url(),
  POKEMON_TCG_API_KEY: z.string().optional().or(z.literal("")),
  POKEMON_TCG_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(250),
  OPEN_TCG_API_BASE_URL: z.string().url(),
  OPEN_TCG_POKEMON_CATEGORY_ID: z.string().optional().or(z.literal("")),
  OPEN_TCG_PRICE_SOURCE_NAME: z.string().min(1).default("open_tcg")
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/**
 * Reads and validates worker environment variables.
 */
export function loadWorkerEnv(): WorkerEnv {
  const parsed = workerEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid worker environment configuration: ${parsed.error.message}`);
  }

  return parsed.data;
}
