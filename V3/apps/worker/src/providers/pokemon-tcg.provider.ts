/**
 * File: pokemon-tcg.provider.ts
 * Purpose:
 *   Calls PokémonTCG.io for official set and card catalog data.
 *
 * Why this file exists:
 *   External API calls belong in providers so sync jobs can be tested and so
 *   field mapping is not scattered through the codebase.
 */

import type { WorkerEnv } from "../config/env.js";

export interface PokemonTcgSet {
  id: string;
  name: string;
  series?: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
  releaseDate?: string;
  updatedAt?: string;
  images?: { symbol?: string; logo?: string };
}

export interface PokemonTcgCard {
  id: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  set: { id: string };
  number: string;
  artist?: string;
  rarity?: string;
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, unknown> };
}

/**
 * Fetches all sets from PokémonTCG.io.
 *
 * Error handling:
 *   Throws when the API does not return the documented `data` array.
 */
export async function fetchPokemonTcgSets(env: WorkerEnv): Promise<PokemonTcgSet[]> {
  const response = await fetch(`${env.POKEMON_TCG_API_URL}/sets`, { headers: buildHeaders(env) });
  const payload = await response.json() as { data?: PokemonTcgSet[] };

  if (!response.ok || !Array.isArray(payload.data)) {
    throw new Error(`PokémonTCG.io sets request failed with status ${response.status}.`);
  }

  return payload.data;
}

/**
 * Fetches every card in one set, following the same approach as the proven V2
 * service: query cards filtered by set id, 250 per page, and page through using
 * the reported totalCount.
 *
 * Why per-set instead of one global card loop:
 *   The unfiltered `/cards` endpoint (especially with an orderBy on a nested
 *   set field) returns intermittent HTTP 500s at scale. Filtering by
 *   `q=set.id:<id>` keeps each request small and reliable, and no orderBy is
 *   sent — cards are ordered locally by collector number when needed.
 */
export async function fetchPokemonTcgCardsForSet(env: WorkerEnv, setId: string): Promise<PokemonTcgCard[]> {
  const pageSize = 250;
  const firstPage = await fetchCardQueryPage(env, setId, 1, pageSize);

  if (firstPage.totalCount <= pageSize) {
    return firstPage.data;
  }

  const lastPage = Math.ceil(firstPage.totalCount / pageSize);
  let all = firstPage.data;

  for (let page = 2; page <= lastPage; page += 1) {
    const next = await fetchCardQueryPage(env, setId, page, pageSize);
    all = all.concat(next.data);
  }

  return all;
}

/**
 * Fetches one page of cards for a set and returns the data plus the total count
 * so the caller can decide whether more pages are needed.
 */
async function fetchCardQueryPage(env: WorkerEnv, setId: string, page: number, pageSize: number): Promise<{ data: PokemonTcgCard[]; totalCount: number }> {
  const params = new URLSearchParams({ q: `set.id:${setId}`, pageSize: String(pageSize), page: String(page) });
  const response = await fetch(`${env.POKEMON_TCG_API_URL}/cards?${params}`, { headers: buildHeaders(env) });
  const payload = await response.json() as { data?: PokemonTcgCard[]; totalCount?: number };

  if (!response.ok || !Array.isArray(payload.data)) {
    throw new Error(`PokémonTCG.io cards request for set ${setId} failed with status ${response.status}.`);
  }

  return { data: payload.data, totalCount: payload.totalCount ?? payload.data.length };
}

/**
 * Builds API headers while keeping the API key optional.
 */
function buildHeaders(env: WorkerEnv): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };

  if (env.POKEMON_TCG_API_KEY) {
    headers["X-Api-Key"] = env.POKEMON_TCG_API_KEY;
  }

  return headers;
}