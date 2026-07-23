/**
 * File: catalogApi.ts
 * Purpose:
 *   Typed API calls for bounded catalog browsing (sets, cards-in-set, card
 *   detail).
 *
 * Why this file exists:
 *   Centralizing these fetch calls keeps loading/error handling consistent
 *   across the set, set-detail, and card-detail views instead of repeating
 *   fetch logic in every component.
 */

import type { PaginatedResult } from "@tcg/shared";
import { apiGet } from "../../lib/api.js";

export interface CatalogSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  symbolUrl?: string;
  logoUrl?: string;
}

export interface CatalogCard {
  id: string;
  setId: string;
  name: string;
  number: string;
  rarity?: string;
  imageSmall?: string;
  imageLarge?: string;
  set: { id: string; name: string; series: string };
}

export interface CatalogCardVariant {
  id: string;
  variantKey: string;
  displayName: string;
  finish?: string;
  edition?: string;
  language: string;
  isMasterSetVariant: boolean;
}

export interface CatalogCardDetail extends CatalogCard {
  artist?: string;
  supertype?: string;
  subtypes: string[];
  variants: CatalogCardVariant[];
}

/**
 * Lists sets in release order, bounded by page/limit.
 */
export async function listSets(page: number, limit: number): Promise<PaginatedResult<CatalogSet>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return apiGet<PaginatedResult<CatalogSet>>(`/api/v1/sets?${params}`);
}

/**
 * Fetches one set by id.
 */
export async function getSet(setId: string): Promise<CatalogSet> {
  return apiGet<CatalogSet>(`/api/v1/sets/${encodeURIComponent(setId)}`);
}

/**
 * Lists cards within a set, bounded by page/limit.
 */
export async function listCardsInSet(setId: string, page: number, limit: number): Promise<PaginatedResult<CatalogCard>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return apiGet<PaginatedResult<CatalogCard>>(`/api/v1/sets/${encodeURIComponent(setId)}/cards?${params}`);
}

/**
 * Fetches one card, including its variants, for the card detail view.
 */
export async function getCardDetail(cardId: string): Promise<CatalogCardDetail> {
  return apiGet<CatalogCardDetail>(`/api/v1/cards/${encodeURIComponent(cardId)}`);
}
