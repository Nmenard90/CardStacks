/**
 * File: variants.ts
 * Purpose:
 *   Defines supported card variant keys and helper functions.
 *
 * Why this file exists:
 *   Variants affect master set progress and prices. Conditions do not affect
 *   master set completion, so variants must be modeled separately.
 */

export const CARD_VARIANT_KEYS = [
  "NORMAL",
  "HOLOFOIL",
  "REVERSE_HOLOFOIL",
  "FIRST_EDITION_NORMAL",
  "FIRST_EDITION_HOLOFOIL",
  "UNLIMITED_NORMAL",
  "UNLIMITED_HOLOFOIL",
  "FOIL",
  "PROMO",
  "GRADED"
] as const;

export type CardVariantKey = (typeof CARD_VARIANT_KEYS)[number];

export const OPEN_TCG_VARIANT_CODE_TO_KEY: Record<string, CardVariantKey> = {
  N: "NORMAL",
  F: "FOIL",
  H: "HOLOFOIL",
  RH: "REVERSE_HOLOFOIL",
  RHO: "REVERSE_HOLOFOIL",
  "1EN": "FIRST_EDITION_NORMAL",
  "1EH": "FIRST_EDITION_HOLOFOIL",
  "1E": "FIRST_EDITION_NORMAL",
  UL: "UNLIMITED_NORMAL",
  ULH: "UNLIMITED_HOLOFOIL",
  UEN: "UNLIMITED_NORMAL"
};

/**
 * Converts a loose external variant code into an internal variant key.
 *
 * Why this function exists:
 *   Different price sources use different variant labels. This helper gives
 *   providers one safe place to normalize them.
 */
export function normalizeVariantCode(code: string | null | undefined): CardVariantKey | null {
  if (!code) {
    return null;
  }

  return OPEN_TCG_VARIANT_CODE_TO_KEY[code.toUpperCase()] ?? null;
}
