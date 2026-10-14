/**
 * CardBrowser — a scrollable, sortable, filterable card grid for the
 * trading pages (your collection, your trade list, someone's share page).
 *
 * HOW IT WORKS
 *   Callers pass any item type plus a `fields` accessor that pulls out what
 *   browsing needs (name, set, number, value, quantity, added date) and a
 *   `renderTile` for the tile itself — the browser owns only the toolbar
 *   (name filter, set filter, sort), the count/value summary, and paging.
 *   Paging is client-side (usePagedList) and loads the next page
 *   automatically when the bottom of the grid scrolls into view, with a
 *   "Show more" button as a fallback. Set names/release dates come from the
 *   public /api/sets catalog, so "sort by set" is newest set first, then
 *   card number.
 *
 * USED BY: TradePage (trade list + collection), SharePage
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSets } from '../api/cards'
import { usePagedList } from '../lib/usePagedList'
import { money } from '../lib/trading'

export interface BrowseFields {
  name: string
  setId: string
  number: string
  /** Per-copy value used for sorting; null = unknown (sorts last). */
  value: number | null
  /** Copies this tile stands for — used for the summary total. */
  quantity?: number
  /** ISO timestamp for "Recently added"; omit to hide that sort. */
  addedAt?: string
}

export type BrowseSort = 'value-desc' | 'value-asc' | 'name' | 'set' | 'recent'

const SORT_LABELS: Record<BrowseSort, string> = {
  'value-desc': 'Value: high → low',
  'value-asc': 'Value: low → high',
  name: 'Name A → Z',
  set: 'Set (newest first)',
  recent: 'Recently added',
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

export function CardBrowser<T>({ items, fields, renderTile, itemKey, empty, defaultSort = 'value-desc' }: {
  items: T[]
  fields: (item: T) => BrowseFields
  renderTile: (item: T) => ReactNode
  itemKey: (item: T) => string
  empty: ReactNode
  defaultSort?: BrowseSort
}) {
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setInfo = useMemo(() => new Map(sets.map(s => [s.id, s])), [sets])

  const [q, setQ] = useState('')
  const [setFilter, setSetFilter] = useState('')
  const [sort, setSort] = useState<BrowseSort>(defaultSort)

  const rows = useMemo(() => items.map(item => ({ item, f: fields(item) })), [items, fields])
  const hasDates = rows.some(r => r.f.addedAt)

  /** Sets that actually appear in this list, newest first, with counts. */
  const setOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.f.setId, (counts.get(r.f.setId) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n, name: setInfo.get(id)?.name ?? id, date: setInfo.get(id)?.releaseDate ?? '' }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  }, [rows, setInfo])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = rows.filter(r =>
      (!setFilter || r.f.setId === setFilter) &&
      (!needle || r.f.name.toLowerCase().includes(needle)))
    const date = (id: string) => setInfo.get(id)?.releaseDate ?? ''
    const val = (v: number | null, dir: 1 | -1) => (v == null ? Infinity : dir * v)
    list.sort((a, b) => {
      switch (sort) {
        case 'value-desc': return val(a.f.value, -1) - val(b.f.value, -1) || a.f.name.localeCompare(b.f.name)
        case 'value-asc':  return val(a.f.value, 1) - val(b.f.value, 1) || a.f.name.localeCompare(b.f.name)
        case 'name':       return a.f.name.localeCompare(b.f.name) || byNumber(a.f.number, b.f.number)
        case 'set':        return date(b.f.setId).localeCompare(date(a.f.setId)) || a.f.setId.localeCompare(b.f.setId) || byNumber(a.f.number, b.f.number)
        case 'recent':     return (b.f.addedAt ?? '').localeCompare(a.f.addedAt ?? '')
      }
    })
    return list
  }, [rows, q, setFilter, sort, setInfo])

  const total = filtered.reduce((s, r) => s + (r.f.value ?? 0) * (r.f.quantity ?? 1), 0)
  const copies = filtered.reduce((s, r) => s + (r.f.quantity ?? 1), 0)

  const page = usePagedList(filtered, `${q}|${setFilter}|${sort}|${items.length}`, 48)

  // Load the next page when the sentinel below the grid scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasMore, loadMore } = page
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadMore, page.visible.length])

  if (items.length === 0) return <>{empty}</>

  return (
    <div className="card-browser">
      <div className="browser-toolbar">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name…" aria-label="Filter by name" />
        <select value={setFilter} onChange={e => setSetFilter(e.target.value)} aria-label="Filter by set">
          <option value="">All sets ({rows.length})</option>
          {setOptions.map(s => <option key={s.id} value={s.id}>{s.name} ({s.n})</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as BrowseSort)} aria-label="Sort">
          {(Object.keys(SORT_LABELS) as BrowseSort[]).filter(s => s !== 'recent' || hasDates)
            .map(s => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
        </select>
      </div>
      <p className="browser-summary">
        {filtered.length} card{filtered.length === 1 ? '' : 's'}
        {copies !== filtered.length ? ` · ${copies} copies` : ''} · ≈ {money(total)}
      </p>

      {filtered.length === 0 ? <p className="muted">No cards match.</p> : (
        <div className="trade-grid">
          {page.visible.map(r => <div className="browser-cell" key={itemKey(r.item)}>{renderTile(r.item)}</div>)}
        </div>
      )}
      {hasMore && (
        <div ref={sentinel} className="browser-more">
          <button onClick={loadMore}>Show more ({page.remaining} left)</button>
        </div>
      )}
    </div>
  )
}

/** Set name + number line for a tile, e.g. "Hidden Fates · #57". */
export function SetLine({ setId, number }: { setId: string; number: string }) {
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const name = sets.find(s => s.id === setId)?.name ?? setId
  return <small className="tile-set">{name} · #{number}</small>
}
