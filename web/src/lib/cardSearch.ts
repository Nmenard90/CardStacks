/**
 * Shared helpers for the all-sets card search. The backend matches by
 * card NUMBER across every set, so "117/123" comes back as every card
 * numbered 117 anywhere — the "/123" (the set's card count) is what
 * identifies which 117 the user means, and these helpers do that
 * disambiguation client-side so every search box behaves consistently.
 *
 * USED BY: CollectionPage, BulkAddPage
 */
import type { Card, CardSet } from '../types'

export interface SetTotals { printed: string; total: string }

export function buildSetTotals(sets: CardSet[]): Map<string, SetTotals> {
  return new Map(sets.map(s => [s.id, {
    printed: String(s.printedTotal ?? ''),
    total: String(s.total ?? ''),
  }]))
}

/**
 * Narrows backend hits to the "117/123" the user means. Matches the
 * denominator with `startsWith` so results narrow as digits are typed.
 * Passes hits through unfiltered if the query isn't "number/number" or
 * the set list hasn't loaded yet.
 */
export function narrowByCollectorNumber(
  hits: Card[],
  query: string,
  totals: Map<string, SetTotals>,
): Card[] {
  const m = query.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  if (!m || totals.size === 0) return hits
  const [, num, denom] = m

  return hits.filter(c => {
    // Leading-zero-insensitive: "25" typed matches a card stored as "025".
    const sameNumber = c.number === num || parseInt(c.number, 10) === parseInt(num, 10)
    if (!sameNumber) return false

    const t = totals.get(c.setId)
    return !!t && (t.printed.startsWith(denom) || t.total.startsWith(denom))
  })
}
