/**
 * File: open-tcg-price.provider.ts
 * Purpose:
 *   Calls an Open TCG / TCGTracking-style API for SKU-level variant pricing.
 *
 * Why this file exists:
 *   The user cannot get a TCGplayer API key, so price sync must not depend on
 *   TCGplayer credentials. This provider is isolated so the exact `tcg.io`
 *   response mapping can be adjusted after real fixtures are tested.
 */

import { CONDITION_CODE_TO_NAME, normalizeVariantCode, type CardCondition } from "@tcg/shared";
import type { WorkerEnv } from "../config/env.js";

export interface OpenTcgSkuPrice {
  productId: string;
  skuId: string;
  condition: CardCondition;
  variantKey: string | null;
  variantDisplayName: string | null;
  language: string;
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
}

interface UnknownSkuPayload {
  id?: string | number;
  pid?: string | number;
  sku_id?: string | number;
  sid?: string | number;
  cnd?: string;
  var?: string;
  var_a?: string;
  lng?: string;
  market?: number | string;
  market_price?: number | string;
  low?: number | string;
  mid?: number | string;
  high?: number | string;
}

/**
 * Fetches SKU pricing for one external set.
 *
 * Error handling:
 *   Throws if the response is not an array because unexpected empty/bad pricing
 *   data must be visible during sync.
 */
export async function fetchOpenTcgSetSkus(env: WorkerEnv, externalSetId: string): Promise<OpenTcgSkuPrice[]> {
  if (!env.OPEN_TCG_POKEMON_CATEGORY_ID) {
    throw new Error("OPEN_TCG_POKEMON_CATEGORY_ID is required for Open TCG price sync.");
  }

  const url = `${env.OPEN_TCG_API_BASE_URL}/v1/${env.OPEN_TCG_POKEMON_CATEGORY_ID}/sets/${externalSetId}/skus`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const payload = await response.json() as unknown;

  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`Open TCG SKU request failed or returned an unexpected shape for set ${externalSetId}.`);
  }

  return payload.map(normalizeOpenTcgSku).filter((item): item is OpenTcgSkuPrice => item !== null);
}

/**
 * Converts one external SKU row into the app's normalized price shape.
 */
function normalizeOpenTcgSku(row: UnknownSkuPayload): OpenTcgSkuPrice | null {
  const condition = row.cnd ? CONDITION_CODE_TO_NAME[row.cnd.toUpperCase()] : undefined;

  if (!condition) {
    return null;
  }

  return {
    productId: String(row.pid ?? row.id ?? ""),
    skuId: String(row.sku_id ?? row.sid ?? row.id ?? ""),
    condition,
    variantKey: normalizeVariantCode(row.var_a ?? null),
    variantDisplayName: row.var ?? null,
    language: row.lng ?? "EN",
    marketPrice: parseMoney(row.market_price ?? row.market),
    lowPrice: parseMoney(row.low),
    midPrice: parseMoney(row.mid),
    highPrice: parseMoney(row.high)
  };
}

/**
 * Parses a money-like value without throwing on missing data.
 */
function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
