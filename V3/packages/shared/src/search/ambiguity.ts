/**
 * File: ambiguity.ts
 * Purpose:
 *   Detects and groups collector-number search results that span more than
 *   one set.
 *
 * Why this file exists:
 *   Collector numbers are not globally unique (FR-CAT-005). When a user
 *   searches by number alone, the same number can legitimately belong to
 *   cards in several different sets. The API and web client both need to
 *   agree on what "ambiguous" means and how candidates are grouped so the
 *   user can pick the right one instead of silently getting one guess.
 */

export interface SearchCandidate {
  id: string;
  setId: string;
}

export interface SearchCandidateGroup<T extends SearchCandidate> {
  setId: string;
  candidates: T[];
}

export interface NumberSearchFilters {
  q?: string;
  setId?: string;
  setName?: string;
  number?: string;
}

/**
 * Reports whether a search is a bare collector-number lookup (no name, set
 * id, or set name filter narrowing it to a single set already).
 *
 * Callers use this to decide whether ambiguity must be resolved against the
 * *complete* set of matches rather than just one results page — a number
 * search can span many sets, and a page boundary must never hide that.
 */
export function isNumberOnlySearch(filters: NumberSearchFilters): boolean {
  return Boolean(filters.number?.trim()) && !filters.setId?.trim() && !filters.setName?.trim() && !filters.q?.trim();
}

/**
 * A number-only search (no name, no set filter) is ambiguous when its
 * results reference more than one set.
 *
 * `results` must be the complete match set for the filter, not one page of
 * it — a page boundary can otherwise hide a second set's matches and report
 * a false negative.
 */
export function isAmbiguousNumberSearch(filters: NumberSearchFilters, results: SearchCandidate[]): boolean {
  if (!isNumberOnlySearch(filters)) {
    return false;
  }

  return countDistinctSets(results) > 1;
}

/**
 * Counts the distinct sets referenced by a list of search results.
 */
export function countDistinctSets(results: SearchCandidate[]): number {
  return new Set(results.map((result) => result.setId)).size;
}

/**
 * Groups search candidates by set, preserving first-seen set order.
 */
export function groupCandidatesBySet<T extends SearchCandidate>(candidates: T[]): SearchCandidateGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const candidate of candidates) {
    const existing = groups.get(candidate.setId);
    if (existing) {
      existing.push(candidate);
    } else {
      groups.set(candidate.setId, [candidate]);
    }
  }

  return [...groups.entries()].map(([setId, groupCandidates]) => ({ setId, candidates: groupCandidates }));
}
