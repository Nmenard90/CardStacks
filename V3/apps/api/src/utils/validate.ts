/**
 * File: validate.ts
 * Purpose:
 *   Provides a tiny helper for parsing API inputs with Zod.
 *
 * Why this file exists:
 *   Every route should validate inputs before reaching business logic.
 */

import type { z } from "zod";

/**
 * Validates unknown input with a Zod schema and returns typed data.
 */
export function validateInput<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.infer<TSchema> {
  return schema.parse(value);
}
