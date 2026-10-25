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
import { compareBy, DEFAULT_DIR, type SortDir, type SortKey } from '../lib/cardSort'
import { SortControl } from './SortControl'

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
  /** Omit when unknown — the Rarity / Artist sorts only show if some row has one. */
  rarity?: string | null
  artist?: string | null
}

export function CardBrowser<T>({ items, fields, renderTile, itemKey, empty, defaultSort = 'value', actions,
  groupBySet = false, setFilterValue, onSetFilterChange }: {
  items: T[]
  fields: (item: T) => BrowseFields
  renderTile: (item: T) => ReactNode
  itemKey: (item: T) => string
  empty: ReactNode
  defaultSort?: SortKey
  /** Shop mode: a set directory and numbered card previews, instead of one mixed grid. */
  groupBySet?: boolean
  setFilterValue?: string
  onSetFilterChange?: (id: string) => void
  /** Buttons beside the count, given the cards currently shown (all
   *  filtered rows, not just the loaded page) — e.g. "Select all". */
  actions?: (shown: T[]) => ReactNode
}) {
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setInfo = useMemo(() => new Map(sets.map(s => [s.id, s])), [sets])

  const [q, setQ] = useState('')
  const [internalSetFilter, setInternalSetFilter] = useState('')
  const setFilter = setFilterValue ?? internalSetFilter
  const setSetFilter = onSetFilterChange ?? setInternalSetFilter
  const [sort, setSort] = useState<SortKey>(defaultSort)
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR[defaultSort])

  const rows = useMemo(() => items.map(item => ({ item, f: fields(item) })), [items, fields])
  const sortKeys = useMemo(() => {
    const keys: SortKey[] = ['value', 'name', 'set', 'number']
    if (rows.some(r => r.f.rarity)) keys.push('rarity')
    if (rows.some(r => r.f.artist)) keys.push('artist')
    if (rows.some(r => r.f.quantity !== undefined)) keys.push('qty')
    if (rows.some(r => r.f.addedAt)) keys.push('recent')
    return keys
  }, [rows])

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
      (!needle || [r.f.name, r.f.artist, r.f.number, setInfo.get(r.f.setId)?.name]
        .some(t => t?.toLowerCase().includes(needle))))
    return list.sort(compareBy(r => ({ ...r.f, qty: r.f.quantity }), sort, sortDir, id => setInfo.get(id)?.releaseDate))
  }, [rows, q, setFilter, sort, sortDir, setInfo])

  const total = filtered.reduce((s, r) => s + (r.f.value ?? 0) * (r.f.quantity ?? 1), 0)
  const copies = filtered.reduce((s, r) => s + (r.f.quantity ?? 1), 0)

  const resetKey = `${q}|${setFilter}|${sort}|${sortDir}|${items.length}`
  const page = usePagedList(filtered, resetKey, 48)
  const groups = useMemo(() => {
    const bySet = new Map<string, typeof filtered>()
    for (const row of filtered) {
      const group = bySet.get(row.f.setId) ?? []
      group.push(row)
      bySet.set(row.f.setId, group)
    }
    return setOptions.filter(s => bySet.has(s.id)).map(s => ({ ...s, rows: bySet.get(s.id)! }))
  }, [filtered, setOptions])
  const groupPage = usePagedList(groups, resetKey, 4)
  const groupedOverview = groupBySet && !setFilter

  // Load the next page when the sentinel below the grid scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasMore, loadMore, remaining } = groupedOverview ? groupPage : page
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
      {groupBySet && <details className="shop-set-directory">
        <summary>Browse all {setOptions.length} sets <span>Find your favorite expansion</span></summary>
        <div className="shop-set-links">
          {setOptions.map(s => <button key={s.id} type="button" aria-pressed={setFilter === s.id}
            onClick={event => { setSetFilter(s.id); event.currentTarget.closest('details')?.removeAttribute('open') }}>
            {setInfo.get(s.id)?.images.symbol && <img src={setInfo.get(s.id)!.images.symbol} alt="" loading="lazy" />}
            <span>{s.name}<small>{s.n} card option{s.n === 1 ? '' : 's'}</small></span>
          </button>)}
        </div>
      </details>}
      <div className="browser-toolbar">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, artist, set…" aria-label="Search cards" />
        <select value={setFilter} onChange={e => setSetFilter(e.target.value)} aria-label="Filter by set">
          <option value="">All sets ({rows.length})</option>
          {setOptions.map(s => <option key={s.id} value={s.id}>{s.name} ({s.n})</option>)}
        </select>
        <SortControl keys={sortKeys} sort={sort} dir={sortDir} onChange={(k, d) => { setSort(k); setSortDir(d) }} />
      </div>
      <div className="browser-summary">
        <span>
          {filtered.length} card{filtered.length === 1 ? '' : 's'}
          {copies !== filtered.length ? ` · ${copies} copies` : ''}
          {groupBySet ? ` · ${groups.length} set${groups.length === 1 ? '' : 's'}` : ` · ≈ ${money(total)}`}
        </span>
        {actions && filtered.length > 0 && <span className="browser-actions">{actions(filtered.map(r => r.item))}</span>}
      </div>

      {groupBySet && setFilter && <button className="shop-all-sets" type="button" onClick={() => setSetFilter('')}>← Back to all sets</button>}
      {filtered.length === 0 ? <div className="browser-empty"><p className="muted">No cards match your search.</p>
        <button type="button" onClick={() => { setQ(''); setSetFilter('') }}>Clear filters</button></div> : groupBySet ? (
        <div className="shop-set-groups">
          {(groupedOverview ? groupPage.visible : groups).map(group => <section className="shop-set-section" key={group.id} aria-label={group.name}>
            <header className="shop-set-heading">
              {setInfo.get(group.id)?.images.symbol && <img src={setInfo.get(group.id)!.images.symbol} alt="" loading="lazy" />}
              <div><h3>{group.name}</h3><p>{setInfo.get(group.id)?.series ? `${setInfo.get(group.id)!.series} · ` : ''}{group.rows.length} card option{group.rows.length === 1 ? '' : 's'}</p></div>
              {groupedOverview && group.rows.length > 12 && <button type="button" onClick={() => setSetFilter(group.id)} aria-label={`View all ${group.rows.length} cards in ${group.name}`}>View set →</button>}
            </header>
            <div className="trade-grid">
              {(groupedOverview ? group.rows.slice(0, 12) : page.visible).map(r => <div className="browser-cell" key={itemKey(r.item)}>{renderTile(r.item)}</div>)}
            </div>
            {groupedOverview && group.rows.length > 12 && <button className="shop-view-set" type="button" onClick={() => setSetFilter(group.id)}>See all {group.rows.length} cards in {group.name} →</button>}
          </section>)}
        </div>
      ) : (
        <div className="trade-grid">
          {page.visible.map(r => <div className="browser-cell" key={itemKey(r.item)}>{renderTile(r.item)}</div>)}
        </div>
      )}
      {hasMore && (
        <div ref={sentinel} className="browser-more">
          <button onClick={loadMore}>Show more {groupedOverview ? 'sets' : 'cards'} ({remaining} left)</button>
        </div>
      )}
    </div>
  )
}
