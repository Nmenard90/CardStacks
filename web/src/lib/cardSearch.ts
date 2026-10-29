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

/**
 * The newest set that has already been released — the sensible set to open on. TCGTracking lists sets a few weeks
 * before release, with no prices or card art yet. Dates come as "2026-11-06" or "1999/01/09"; with nothing released
 * yet (a brand-new game), the newest set of all.
 * @param sets  at least one set
 * @param today "YYYY-MM-DD", for tests; defaults to today's local date
 */
export function newestReleasedSet(sets: CardSet[], today = new Date().toLocaleDateString('en-CA')): CardSet {
  const day = (s: CardSet) => (s.releaseDate ?? '').replaceAll('/', '-')
  const newestFirst = [...sets].sort((a, b) => day(b).localeCompare(day(a)))
  return newestFirst.find(s => day(s) && day(s) <= today) ?? newestFirst[0]
}
