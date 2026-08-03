/**
 * FILE: conditions.ts
 * LOCATION: src/lib/conditions.ts
 *
 * PURPOSE:
 *   The card-condition system shared by every page.
 *   Conditions, their display colors, price multipliers, and helpers for
 *   reading a price for a given condition off a Card from the API.
 *
 * USED BY: CollectionPage, AnalyzerPage, RecentSidebar, CardTile
 */
import type { Card, CardPrices, ConditionCount } from '../types'

/** The five grading conditions, best to worst. Order matters for display. */
export const CONDS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
export type Cond = (typeof CONDS)[number]

/** Display color for each condition — ported from the old app. */
export const COND_COLORS: Record<Cond, string> = {
  NM: '#22c55e', LP: '#84cc16', MP: '#eab308', HP: '#f97316', DMG: '#ef4444',
}

/** Price multiplier vs NM when the API has no per-condition price. */
export const COND_MULT: Record<Cond, number> = {
  NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.3,
}

/** A card's local condition state: condition key → quantity owned. */
export type CondMap = Record<string, number>

/**
 * FUNCTION: baseCond
 * PURPOSE: Strips the " 1st Ed" suffix off a condition key.
 *          "NM 1st Ed" → "NM"; "LP" → "LP".
 * @param key  A condition key, possibly with the 1st Ed suffix
 * @returns    The plain five-letter condition
 */
export const baseCond = (key: string): Cond =>
  (key.replace(' 1st Ed', '') as Cond)

/**
 * FUNCTION: pricesForVariant
 * PURPOSE: Looks up a card's prices for a specific print variant ("Normal",
 *          "Holofoil", "Reverse Holofoil", "Poké Ball Pattern", "Master Ball
 *          Pattern"). Falls back to the card's default `prices` when no
 *          variant is requested, the card has no `variants` data yet (older
 *          cached cards fetched before variant support), or the requested
 *          variant isn't priced for this card.
 * @param card     The card from the API
 * @param variant  Variant name, or undefined for the card's default price
 * @returns        CardPrices for that variant, or undefined if unpriced
 */
export function pricesForVariant(card: Card | undefined, variant?: string): CardPrices | undefined {
  if (variant && variant !== 'Normal' && card?.variants?.length) {
    const match = card.variants.find(v => v.name === variant)
    if (match) return match.prices
  }
  return card?.prices
}

/**
 * FUNCTION: basePrice
 * PURPOSE: A card's headline (NM market) price.
 *          Falls back through conditions if NM is missing.
 * @param card     The card from the API
 * @param variant  Optional print variant — see pricesForVariant
 * @returns        Price in dollars, or 0 when the API has none
 */
export function basePrice(card: Card | undefined, variant?: string): number {
  const p = pricesForVariant(card, variant)
  if (!p) return 0
  return p.nm ?? p.lp ?? p.mp ?? p.hp ?? p.dmg ?? 0
}

/**
 * FUNCTION: condPrice
 * PURPOSE: Price for one specific condition of a card.
 *          Uses the API's per-condition price when present, otherwise
 *          NM price × the standard condition multiplier.
 * @param card     The card from the API
 * @param key      Condition key (may include " 1st Ed")
 * @param variant  Optional print variant — see pricesForVariant
 * @returns        Price in dollars, or 0 when unknown
 */
export function condPrice(card: Card | undefined, key: string, variant?: string): number {
  const cond = baseCond(key)
  const p = pricesForVariant(card, variant)
  const direct = p?.[cond.toLowerCase() as 'nm' | 'lp' | 'mp' | 'hp' | 'dmg']
  if (direct && direct > 0) return direct
  const nm = basePrice(card, variant)
  return nm > 0 ? +(nm * COND_MULT[cond]).toFixed(2) : 0
}

/** One condition's self-reported purchase info: what was paid and when. */
export interface PurchaseInfo { price: number; purchasedAt?: string }
/** A card's local purchase state: condition key → purchase info. */
export type PurchaseMap = Record<string, PurchaseInfo>

/**
 * FUNCTION: toCondList
 * PURPOSE: Converts the local {cond → qty} map into the API's
 *          ConditionCount list, attaching the price for each condition and,
 *          when given, the purchase price/date logged for that condition.
 * @param map        Local condition map
 * @param card       The card, for price lookup
 * @param purchases  Optional purchase info per condition, to round-trip it
 * @returns          List ready to POST to /api/collection
 */
export function toCondList(map: CondMap, card: Card | undefined, purchases?: PurchaseMap): ConditionCount[] {
  return Object.entries(map)
    .filter(([, q]) => q > 0)
    .map(([condition, quantity]) => ({
      condition, quantity, price: condPrice(card, condition) || undefined,
      purchasePrice: purchases?.[condition]?.price,
      purchasedAt: purchases?.[condition]?.purchasedAt,
    }))
}

/**
 * FUNCTION: fromPurchaseList
 * PURPOSE: Extracts the purchase-price map back out of a ConditionCount list.
 * @param list  Conditions from a CollectionEntry/OwnedCard
 * @returns     Local {cond → purchase info} map for conditions with a logged price
 */
export function fromPurchaseList(list: ConditionCount[]): PurchaseMap {
  const m: PurchaseMap = {}
  // >= 0, not > 0: $0 is a legitimate logged price (e.g. a card pulled from a
  // pack you already paid for), not the same as "nothing logged yet".
  for (const c of list) if (c.purchasePrice != null && c.purchasePrice >= 0) {
    m[c.condition] = { price: c.purchasePrice, purchasedAt: c.purchasedAt }
  }
  return m
}

/**
 * FUNCTION: fromCondList
 * PURPOSE: Converts the API's ConditionCount list into the local map.
 * @param list  Conditions from a CollectionEntry
 * @returns     Local {cond → qty} map
 */
export function fromCondList(list: ConditionCount[]): CondMap {
  const m: CondMap = {}
  for (const c of list) if (c.quantity > 0) m[c.condition] = c.quantity
  return m
}

/**
 * FUNCTION: totalQty
 * PURPOSE: Total copies owned across all conditions of one card.
 * @param map  Local condition map
 * @returns    Sum of all quantities
 */
export const totalQty = (map: CondMap): number =>
  Object.values(map).reduce((a, b) => a + b, 0)

/**
 * FUNCTION: dominantCondClass
 * PURPOSE: CSS class for a card tile's colored border.
 *          One condition owned → that condition's color;
 *          several → the "mixed" indigo; none → no class.
 * @param map  Local condition map
 * @returns    "cond-NM" | … | "cond-mixed" | ""
 */
export function dominantCondClass(map: CondMap): string {
  const owned = [...new Set(Object.keys(map).filter(k => map[k] > 0).map(baseCond))]
  if (owned.length === 0) return ''
  if (owned.length === 1) return `cond-${owned[0]}`
  return 'cond-mixed'
}

/**
 * FUNCTION: cardValue
 * PURPOSE: Total dollar value of one card's owned copies,
 *          priced per condition.
 * @param map   Local condition map
 * @param card  The card, for price lookup
 * @returns     Dollar value
 */
export const cardValue = (map: CondMap, card: Card | undefined, variant?: string): number =>
  Object.entries(map).reduce((sum, [k, q]) => sum + condPrice(card, k, variant) * q, 0)
