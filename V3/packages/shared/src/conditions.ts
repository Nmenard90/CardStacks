/**
 * File: conditions.ts
 * Purpose:
 *   Defines the only card conditions accepted by the app.
 *
 * Why this file exists:
 *   Conditions are used by collection tracking, price matching, imports,
 *   exports, and trade analysis. Keeping them in one file prevents typos.
 */

export const CARD_CONDITIONS = [
  "NEAR_MINT",
  "LIGHTLY_PLAYED",
  "MODERATELY_PLAYED",
  "HEAVILY_PLAYED",
  "DAMAGED"
] as const;

export type CardCondition = (typeof CARD_CONDITIONS)[number];

export const CONDITION_CODE_TO_NAME: Record<string, CardCondition> = {
  NM: "NEAR_MINT",
  LP: "LIGHTLY_PLAYED",
  MP: "MODERATELY_PLAYED",
  HP: "HEAVILY_PLAYED",
  DMG: "DAMAGED"
};

/**
 * Checks whether an unknown value is a supported card condition.
 *
 * Why this function exists:
 *   User imports and API requests can contain bad condition names, so every
 *   boundary needs a safe way to validate them.
 */
export function isCardCondition(value: unknown): value is CardCondition {
  return typeof value === "string" && CARD_CONDITIONS.includes(value as CardCondition);
}
