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
 * Fetches one page of cards from PokémonTCG.io.
 *
 * Performance:
 *   The caller controls paging so the worker never loads the entire catalog
 *   unless it intentionally iterates page by page.
 */
export async function fetchPokemonTcgCardPage(env: WorkerEnv, page: number): Promise<PokemonTcgCard[]> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(env.POKEMON_TCG_PAGE_SIZE), orderBy: "set.releaseDate,number" });
  const response = await fetch(`${env.POKEMON_TCG_API_URL}/cards?${params}`, { headers: buildHeaders(env) });
  const payload = await response.json() as { data?: PokemonTcgCard[] };

  if (!response.ok || !Array.isArray(payload.data)) {
    throw new Error(`PokémonTCG.io cards request failed with status ${response.status}.`);
  }

  return payload.data;
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
