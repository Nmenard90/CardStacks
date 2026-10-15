/**
 * Card-condition system shared by every page: the five grading tiers,
 * their display colors, and helpers for reading/writing a card's
 * per-condition price and ownership state.
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

/** Condition key → quantity owned. Keys are "<COND>[ 1st Ed][ · <print>]":
 *  "NM", "LP 1st Ed", "NM · reverse". No print suffix = the card's default
 *  print; a suffix is a backend variant key (reverse, holo, pokeball, ...),
 *  so each print is counted — and priced — on its own. The backend parses
 *  the same grammar (models/Collection.scala ConditionKey). */
export type CondMap = Record<string, number>

export const PRINT_SEP = ' · '

export interface ParsedKey { cond: Cond; firstEd: boolean; print?: string }

export function parseKey(key: string): ParsedKey {
  const i = key.indexOf(PRINT_SEP)
  const left = i === -1 ? key : key.slice(0, i)
  const print = i === -1 ? undefined : key.slice(i + PRINT_SEP.length).trim().toLowerCase() || undefined
  return { cond: left.replace(' 1st Ed', '').trim() as Cond, firstEd: left.endsWith(' 1st Ed'), print }
}

/** `cond` may already carry " 1st Ed"; `print` undefined = default print. */
export const makeKey = (cond: string, print?: string): string =>
  print ? `${parseKey(cond).cond}${parseKey(cond).firstEd ? ' 1st Ed' : ''}${PRINT_SEP}${print}` : cond

export const baseCond = (key: string): Cond => parseKey(key).cond

export const keyPrint = (key: string): string | undefined => parseKey(key).print

/** The condition key an inventory lot stands for (inverse of the backend's
 *  ConditionKey.parse): edition → " 1st Ed", non-"standard" print → " · print". */
export const lotKey = (l: { condition: string; edition: string; variantKey: string }): string =>
  makeKey(l.edition === 'first_edition' ? `${l.condition} 1st Ed` : l.condition,
    l.variantKey && l.variantKey !== 'standard' ? l.variantKey : undefined)

/** The only sets ever printed with a 1st Edition stamp (pokemontcg.io ids):
 *  Base, Jungle, Fossil, Team Rocket, Gym Heroes/Challenge, Neo 1–4. */
const FIRST_EDITION_SETS = new Set(['base1', 'base2', 'base3', 'base5', 'gym1', 'gym2', 'neo1', 'neo2', 'neo3', 'neo4'])

export const hasFirstEdition = (setId: string | undefined): boolean =>
  !!setId && FIRST_EDITION_SETS.has(setId)

/** Display names for the backend's print keys (see CardVariant). */
export const VARIANT_LABELS: Record<string, string> = {
  normal: 'Normal', holo: 'Holo', reverse: 'Reverse',
  pokeball: 'Poké Ball', masterball: 'Master Ball',
}

/** Known Pokémon prints get their proper names; any other game's print key
 *  ("foil", "cold-foil", "1st-edition") is title-cased from the key. */
export const variantLabel = (key: string): string =>
  VARIANT_LABELS[key] ?? key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/** Human label for a condition key: "NM", "LP 1st Ed", "NM Reverse". */
export function condLabel(key: string): string {
  const p = parseKey(key)
  return `${p.cond}${p.firstEd ? ' 1st Ed' : ''}${p.print ? ' ' + variantLabel(p.print) : ''}`
}

/**
 * The print a card's plain `prices` describe — Normal when it exists,
 * otherwise Holo (e.g. rares with no non-holo print).
 */
export function defaultVariant(card: Card | undefined): string | undefined {
  const names = (card?.variants ?? []).map(v => v.name)
  return names.find(n => n === 'normal') ?? names.find(n => n === 'holo') ?? names[0]
}

/**
 * Falls back to the card's default `prices` if no variant is requested,
 * the card predates variant tracking, or the requested variant isn't priced.
 */
export function pricesForVariant(card: Card | undefined, variant?: string): CardPrices | undefined {
  if (variant && variant !== defaultVariant(card) && card?.variants?.length) {
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

/** Only ever a real per-condition price from the API — never synthesized.
 *  Returns 0 (rendered as "no price" by callers) when the source has no
 *  real quote for this specific condition. */
export function condPrice(card: Card | undefined, key: string, variant?: string): number {
  const { cond, print } = parseKey(key)
  // A key that names its own print is always priced as that print.
  const p = pricesForVariant(card, print ?? variant)
  const direct = p?.[cond.toLowerCase() as 'nm' | 'lp' | 'mp' | 'hp' | 'dmg']
  return direct && direct > 0 ? direct : 0
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

/** Total market value of everything owned — each key at its own print's price. */
export const cardValue = (map: CondMap, card: Card | undefined): number =>
  Object.entries(map).reduce((sum, [k, q]) => sum + condPrice(card, k) * q, 0)
