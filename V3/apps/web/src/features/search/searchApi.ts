/**
 * File: searchApi.ts
 * Purpose:
 *   Typed API call for card search by name, set, and/or collector number.
 *
 * Why this file exists:
 *   Keeping the query-string construction and response typing in one place
 *   avoids each search UI re-deriving the request shape.
 */

import type { PageInfo } from "@tcg/shared";
import { apiGet } from "../../lib/api.js";

export interface SearchResultCard {
  id: string;
  setId: string;
  name: string;
  number: string;
  rarity?: string;
  imageSmall?: string;
  imageLarge?: string;
  set: { id: string; name: string; series: string };
}

export interface SearchCardsResult {
  items: SearchResultCard[];
  pageInfo: PageInfo;
  ambiguous: boolean;
}

export interface SearchCardsParams {
  q?: string;
  setId?: string;
  number?: string;
  page: number;
  limit: number;
}

/**
 * Searches cards using validated name/set/number filters.
 *
 * The API rejects a request with no meaningful filter (FR-CAT-004); callers
 * should check `hasMeaningfulSearchFilter` from `@tcg/shared` before calling
 * this so the user sees an inline validation message instead of a network
 * round trip that is guaranteed to fail.
 */
export async function searchCards(params: SearchCardsParams): Promise<SearchCardsResult> {
  const query = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.q) query.set("q", params.q);
  if (params.setId) query.set("setId", params.setId);
  if (params.number) query.set("number", params.number);

  return apiGet<SearchCardsResult>(`/api/v1/search/cards?${query}`);
}
