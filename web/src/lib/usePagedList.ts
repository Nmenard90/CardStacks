/**
 * Client-side "Load more" pagination over an already-fully-loaded array.
 * Used everywhere a big owned-cards list gets rendered (box "Available
 * owned copies", Trade Analyzer Quick Add, the binder picker) so large
 * collections don't either dump thousands of DOM nodes at once or get
 * silently truncated with no way to see the rest.
 *
 * USED BY: SpacesLivePage (BoxInventory), AnalyzerPage, BinderViewPage
 */

import { useState } from 'react'

/** @param resetKey Whenever this changes (e.g. a search query or filter),
 *    the page resets to the first one — otherwise a new filter could stay
 *    stuck scrolled to "page 3" of the previous, unrelated list. */
export function usePagedList<T>(items: T[], resetKey: unknown, pageSize = 60) {
  const [pagination, setPagination] = useState(() => ({ count: pageSize, resetKey, pageSize }))
  if (!Object.is(pagination.resetKey, resetKey) || pagination.pageSize !== pageSize) {
    setPagination({ count: pageSize, resetKey, pageSize })
  }

  const visible = items.slice(0, pagination.count)
  return {
    visible,
    hasMore: visible.length < items.length,
    remaining: items.length - visible.length,
    loadMore: () => setPagination(current => ({ ...current, count: current.count + pageSize })),
  }
}
