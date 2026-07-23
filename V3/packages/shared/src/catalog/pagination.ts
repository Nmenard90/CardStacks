/**
 * File: pagination.ts
 * Purpose:
 *   Shared pagination metadata shape for bounded catalog listings.
 *
 * Why this file exists:
 *   Set listing, card-in-set browsing, and search all need the same bounded
 *   list contract so clients never have to guess whether more pages exist.
 */

export interface PageInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

/**
 * Builds page metadata from a requested page/limit and a total row count.
 */
export function buildPageInfo(page: number, limit: number, total: number): PageInfo {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit)
  };
}
