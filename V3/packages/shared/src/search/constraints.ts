/**
 * File: constraints.ts
 * Purpose:
 *   Defines the input bounds a card search request must satisfy.
 *
 * Why this file exists:
 *   The API validates search input with these bounds and the web client uses
 *   the same values to give the user feedback before a request is even sent.
 */

export const SEARCH_NAME_MAX_LENGTH = 120;
export const SEARCH_SET_ID_MAX_LENGTH = 80;
export const SEARCH_SET_NAME_MAX_LENGTH = 120;
export const SEARCH_NUMBER_MAX_LENGTH = 40;

export interface CardSearchFilters {
  q?: string;
  setId?: string;
  setName?: string;
  number?: string;
}

/**
 * Reports whether at least one meaningful search filter was provided.
 *
 * A card search must never silently fall back to browsing the entire
 * catalog: FR-CAT-004 requires the caller to state what they are looking
 * for. Bounded browsing (all sets, or all cards in one set) is a distinct,
 * explicit action handled by the catalog endpoints instead.
 */
export function hasMeaningfulSearchFilter(filters: CardSearchFilters): boolean {
  return Boolean(filters.q?.trim() || filters.setId?.trim() || filters.setName?.trim() || filters.number?.trim());
}
