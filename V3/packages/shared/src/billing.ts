/**
 * File: billing.ts
 * Purpose:
 *   Defines billing plan and access constants used by API and frontend.
 *
 * Why this file exists:
 *   Billing is not fully wired yet, but the database and access model must be
 *   present from day one so premium features are not painful to add later.
 */

export const PLAN_CODES = ["FREE", "COLLECTOR_PRO", "VENDOR_PRO"] as const;

export type PlanCode = (typeof PLAN_CODES)[number];

export const ACCESS_LEVELS = ["FREE", "COLLECTOR_PRO", "VENDOR_PRO", "ADMIN_FULL"] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number];
