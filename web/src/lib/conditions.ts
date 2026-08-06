/**
 * Card-condition system shared by every page: the five grading tiers,
 * their display colors, price fallback multipliers, and helpers for
 * reading/writing a card's per-condition price and ownership state.
 *
 * USED BY: CollectionPage, AnalyzerPage, RecentSidebar, CardTile
 */
import type { Card, CardPrices, ConditionCount } from '../types'

/** Best to worst. Order drives display order everywhere this is used. */
export const CONDS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
export type Cond = (typeof CONDS)[number]

export const COND_COLORS: Record<Cond, string> = {
  NM: '#22c55e', LP: '#84cc16', MP: '#eab308', HP: '#f97316', DMG: '#ef4444',
}

/** Applied to NM price when the API has no real per-condition price. */
export const COND_MULT: Record<Cond, number> = {
  NM: 1, LP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.3,
}

/** Condition key (may include " 1st Ed") → quantity owned. */
export type CondMap = Record<string, number>

export const baseCond = (key: string): Cond =>
  (key.replace(' 1st Ed', '') as Cond)

/**
 * Falls back to the card's default `prices` if no variant is requested,
 * the card predates variant tracking, or the requested variant isn't priced.
 */
export function pricesForVariant(card: Card | undefined, variant?: string): CardPrices | undefined {
  if (variant && variant !== 'Normal' && card?.variants?.length) {
    const match = card.variants.find(v => v.name === variant)
    if (match) return match.prices
  }
  return card?.prices
}

/** Headline price. Falls through NM→LP→MP→HP→DMG if NM itself is missing. */
export function basePrice(card: Card | undefined, variant?: string): number {
  const p = pricesForVariant(card, variant)
  if (!p) return 0
  return p.nm ?? p.lp ?? p.mp ?? p.hp ?? p.dmg ?? 0
}

/** Uses the API's real per-condition price when available; otherwise
 *  estimates from NM × COND_MULT, since the API doesn't price every tier. */
export function condPrice(card: Card | undefined, key: string, variant?: string): number {
  const cond = baseCond(key)
  const p = pricesForVariant(card, variant)
  const direct = p?.[cond.toLowerCase() as 'nm' | 'lp' | 'mp' | 'hp' | 'dmg']
  if (direct && direct > 0) return direct

  const nm = basePrice(card, variant)
  return nm > 0 ? +(nm * COND_MULT[cond]).toFixed(2) : 0
}

export interface PurchaseInfo { price: number; purchasedAt?: string }
export type PurchaseMap = Record<string, PurchaseInfo>

/** @param purchases Optional — round-trips logged purchase price/date per condition. */
export function toCondList(map: CondMap, card: Card | undefined, purchases?: PurchaseMap): ConditionCount[] {
  return Object.entries(map)
    .filter(([, q]) => q > 0)
    .map(([condition, quantity]) => ({
      condition, quantity,
      // Omitted (not 0) when unknown — a real $0 price would be indistinguishable otherwise.
      price: condPrice(card, condition) || undefined,
      purchasePrice: purchases?.[condition]?.price,
      purchasedAt: purchases?.[condition]?.purchasedAt,
    }))
}

export function fromPurchaseList(list: ConditionCount[]): PurchaseMap {
  const m: PurchaseMap = {}
  // >= 0, not > 0: a logged $0 (e.g. a pack pull) is a real value, not "unset."
  for (const c of list) if (c.purchasePrice != null && c.purchasePrice >= 0) {
    m[c.condition] = { price: c.purchasePrice, purchasedAt: c.purchasedAt }
  }
  return m
}

export function fromCondList(list: ConditionCount[]): CondMap {
  const m: CondMap = {}
  for (const c of list) if (c.quantity > 0) m[c.condition] = c.quantity
  return m
}

export const totalQty = (map: CondMap): number =>
  Object.values(map).reduce((a, b) => a + b, 0)

/** CSS class for a tile's border: single condition owned → that color,
 *  multiple → "mixed", none → no class. */
export function dominantCondClass(map: CondMap): string {
  const owned = [...new Set(Object.keys(map).filter(k => map[k] > 0).map(baseCond))]
  if (owned.length === 0) return ''
  if (owned.length === 1) return `cond-${owned[0]}`
  return 'cond-mixed'
}

export const cardValue = (map: CondMap, card: Card | undefined, variant?: string): number =>
  Object.entries(map).reduce((sum, [k, q]) => sum + condPrice(card, k, variant) * q, 0)
