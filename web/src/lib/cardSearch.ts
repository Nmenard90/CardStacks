/**
 * FILE: cardSearch.ts
 * LOCATION: src/lib/cardSearch.ts
 *
 * PURPOSE:
 *   Shared helpers for the all-sets card search, used by every page that has a
 *   search box. The backend search matches a card NUMBER across every set, so a
 *   query like "117/123" comes back as every card numbered 117. The "/123" is
 *   the set's printed total and identifies WHICH 117 the user means; these
 *   helpers apply that disambiguation on the client so all search boxes behave
 *   the same way without duplicating the logic in each page.
 *
 * USED BY: CollectionPage, BulkAddPage (and any future search box)
 * DEPENDS ON: the Card and CardSet shapes in ../types
 */
import type { Card, CardSet } from '../types'

/** A set's two "total" fields as strings, for matching the "/NNN" denominator. */
export interface SetTotals { printed: string; total: string }

/**
 * PURPOSE: Build a setId -> totals lookup from the loaded set list, so a search
 *   result's set total can be checked without another request.
 * @param sets  The full set list (from GET /api/sets)
 * @return Map of setId to that set's printed total and total, as strings
 */
export function buildSetTotals(sets: CardSet[]): Map<string, SetTotals> {
  return new Map(sets.map(s => [s.id, {
    printed: String(s.printedTotal ?? ''),
    total: String(s.total ?? ''),
  }]))
}

/**
 * PURPOSE: When the user types a collector reference like "117/123", narrow the
 *   backend hits down to the card they mean. Without this the dropdown shows
 *   every card numbered 117 and ignores the "/123". The denominator is matched
 *   with startsWith so the list narrows as each digit is typed. A query with no
 *   "/denominator" is returned unchanged, and if the set list has not loaded yet
 *   the hits are returned unfiltered (so nothing disappears mid-load).
 * @param hits    Cards returned by the backend search
 * @param query   The raw text the user typed
 * @param totals  setId -> totals map from buildSetTotals
 * @return The hits filtered to the typed collector reference, or all hits
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
    // Numerator: the card's own number must equal the typed number, ignoring
    // leading zeros (this regex only fires on a query that's pure digits, so
    // no letter-prefix case like "SWSH001" reaches this function).
    const sameNumber = c.number === num || parseInt(c.number, 10) === parseInt(num, 10)
    if (!sameNumber) return false
    // Denominator: the card's set total must begin with what's been typed.
    const t = totals.get(c.setId)
    return !!t && (t.printed.startsWith(denom) || t.total.startsWith(denom))
  })
}
