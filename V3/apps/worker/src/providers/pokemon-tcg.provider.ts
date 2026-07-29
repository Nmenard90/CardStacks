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
 */
export async function fetchPokemonTcgSets(env: WorkerEnv): Promise<PokemonTcgSet[]> {
  const payload = await getJson<{ data?: PokemonTcgSet[] }>(env, `${env.POKEMON_TCG_API_URL}/sets`);

  if (!Array.isArray(payload.data)) {
    throw new Error("PokémonTCG.io sets response did not contain a data array.");
  }

  return payload.data;
}

/**
 * Fetches every card in one set, filtered by set id, 250 per page, paging
 * through with the reported totalCount.
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
 * Fetches one page of cards for a set and returns the data plus the total count.
 */
async function fetchCardQueryPage(env: WorkerEnv, setId: string, page: number, pageSize: number): Promise<{ data: PokemonTcgCard[]; totalCount: number }> {
  const params = new URLSearchParams({ q: `set.id:${setId}`, pageSize: String(pageSize), page: String(page) });
  const payload = await getJson<{ data?: PokemonTcgCard[]; totalCount?: number }>(env, `${env.POKEMON_TCG_API_URL}/cards?${params}`);

  if (!Array.isArray(payload.data)) {
    throw new Error(`PokémonTCG.io cards response for set ${setId} did not contain a data array.`);
  }

  return { data: payload.data, totalCount: payload.totalCount ?? payload.data.length };
}

/**
 * GET a URL and parse JSON, with retry/backoff for the API's frequent transient
 * failures (HTTP 500s, timeouts, and empty response bodies).
 *
 * Why this exists:
 *   pokemontcg.io intermittently returns a 500 or an empty body on an otherwise
 *   valid request. A single sync makes many sequential calls, so without retry
 *   one blip kills the whole run. Retrying each request a few times makes a
 *   full sync reliable. Note: no `accept` header is sent — the API returns 500
 *   when `accept: application/json` is present.
 */
async function getJson<T>(env: WorkerEnv, url: string): Promise<T> {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: buildHeaders(env) });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Request to ${url} failed with status ${response.status}.`);
      }
      if (body.trim() === "") {
        throw new Error(`Request to ${url} returned an empty body.`);
      }

      return JSON.parse(body) as T;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s, 8s.
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`PokémonTCG.io request failed after ${maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/**
 * Builds API headers.
 *
 * IMPORTANT: Do NOT send an `accept` header. The pokemontcg.io server returns
 * HTTP 500 when `accept: application/json` is present. A plain request (only the
 * optional API key) is what the API documents and what works.
 */
function buildHeaders(env: WorkerEnv): Record<string, string> {
  const headers: Record<string, string> = {};

  if (env.POKEMON_TCG_API_KEY) {
    headers["X-Api-Key"] = env.POKEMON_TCG_API_KEY;
  }

  return headers;
}

/**
 * Resolves after the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
