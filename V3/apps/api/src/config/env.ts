/**
 * File: env.ts
 * Purpose:
 *   Loads and validates environment variables for the API.
 *
 * Why this file exists:
 *   Missing configuration should fail at startup instead of causing confusing
 *   runtime bugs after users are already on the app.
 */

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  PUBLIC_WEB_URL: z.string().url(),
  API_BASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  SUPABASE_ANON_KEY: z.string().optional().or(z.literal("")),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().or(z.literal("")),
  POKEMON_TCG_API_URL: z.string().url(),
  POKEMON_TCG_API_KEY: z.string().optional().or(z.literal("")),
  POKEMON_TCG_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(250),
  OPEN_TCG_API_BASE_URL: z.string().url(),
  OPEN_TCG_POKEMON_CATEGORY_ID: z.string().optional().or(z.literal("")),
  OPEN_TCG_PRICE_SOURCE_NAME: z.string().min(1).default("open_tcg"),
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_GENERAL_WINDOW: z.string().default("1 minute"),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW: z.string().default("1 minute"),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_SEARCH_WINDOW: z.string().default("1 minute"),
  RATE_LIMIT_IMPORT_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_IMPORT_WINDOW: z.string().default("1 hour"),
  ADMIN_EMAILS: z.string().optional().default(""),
  BILLING_ENABLED: z.enum(["true", "false"]).default("false"),
  STRIPE_SECRET_KEY: z.string().optional().or(z.literal("")),
  STRIPE_WEBHOOK_SECRET: z.string().optional().or(z.literal(""))
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Reads, validates, and returns app environment settings.
 *
 * Error handling:
 *   Throws a readable error if required variables are missing or malformed.
 */
export function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Converts comma-separated admin emails into a normalized set.
 */
export function parseAdminEmails(rawValue: string): Set<string> {
  return new Set(
    rawValue
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}
