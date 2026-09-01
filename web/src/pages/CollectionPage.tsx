/**
 * CollectionPage — the main page for finding and logging cards.
 *
 * HOW IT WORKS
 *   Two ways to find a card, and finding one never requires picking a set
 *   first: the search box (primary — backend searches every set at once
 *   once 2+ characters are typed) and the SetSelector, which is an
 *   optional convenience to narrow the grid to one set, not a gate.
 *   Quantity edits show on screen immediately; the change is saved to the
 *   backend right after (see `mutate`).
 *
 *   "My Collection" (every owned card across all sets) is its own page at
 *   /owned. Quick-add and the Recently Added sidebar live on the Bulk Add
 *   page (/bulk).
 *
 * USED BY: App.tsx (route "/")
 * DEPENDS ON: api/cards, api/collection, lib/cardSearch, lib/conditions
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { browseCards, getCards, getSets, searchCards, type BrowseSort } from '../api/cards'
import { bulkSave, getCollection, getOwnedCards, getStats, saveEntry } from '../api/collection'
import { BinderPickerModal } from '../components/BinderPickerModal'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { HeaderNav } from '../components/HeaderNav'
import { ImportModal } from '../components/ImportModal'
import { LoginScreen } from '../components/LoginScreen'
import { ALL_SETS, SetSelector } from '../components/SetSelector'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  basePrice, cardValue, condPrice, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
import { buildSetTotals, narrowByCollectorNumber } from '../lib/cardSearch'
import { downloadCSV, type ImportRow } from '../lib/csv'
import type { Card } from '../types'

/** Local state for one card: counts per condition + the active condition. */
interface Entry { conds: CondMap; selCond: string }

type SortMode = 'number' | 'value' | 'qty' | 'name'

/** Card numbers sort numerically when possible ("2" before "10"). */
const numKey = (n: string) => {
  const m = n.match(/\d+/)
  // No digits at all (an all-letter promo code) sorts to the very end.
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

export function CollectionPage() {
  const { user } = useUser()
  const toast = useToast()
  const qc = useQueryClient()
  const preview = usePreview()

  // Restores whichever set was open last time, read once on first load.
  const [setId, setSetId] = useState<string | null>(() => localStorage.getItem('poketracker_set'))
  const [search, setSearch] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('number')
  const [importOpen, setImportOpen] = useState(false)

  // Which card currently has its "add to binder" popup open.
  const [binderCard, setBinderCard] = useState<Card | null>(null)

  // Cross-set search results, populated only while the box holds 2+ characters.
  const [globalHits, setGlobalHits] = useState<Card[]>([])
  const [globalSearching, setGlobalSearching] = useState(false)
  const globalTimer = useRef<number | null>(null)

  // "All Sets" + no search query: a real paginated browse of the whole
  // catalog (server-sorted — too large to fetch and sort client-side),
  // instead of the old blank "type something to search" placeholder.
  const [browseSort, setBrowseSort] = useState<BrowseSort>('name')
  const [browseDir, setBrowseDir] = useState<'asc' | 'desc'>('asc')
  const [browseList, setBrowseList] = useState<Card[]>([])
  const [browseTotal, setBrowseTotal] = useState(0)
  const [browsePage, setBrowsePage] = useState(0)
  const [browseLoading, setBrowseLoading] = useState(false)
  const BROWSE_PAGE_SIZE = 60

  const userId = user?.id ?? ''

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // The set actually shown: the saved choice if it's still real, otherwise
  // the newest set. Computed directly (not via an effect) so there's no
  // flash of an empty grid on load.
  const activeSetId = useMemo(() => {
    if (setId === ALL_SETS) return ALL_SETS
    if (setId && sets.some(s => s.id === setId)) return setId
    if (sets.length === 0) return null
    return [...sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0].id
  }, [sets, setId])

  const setTotals = useMemo(() => buildSetTotals(sets), [sets])

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['cards', activeSetId],
    queryFn: () => getCards(activeSetId!),
    enabled: !!user && !!activeSetId && activeSetId !== ALL_SETS,
  })

  const { data: stats } = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => getStats(userId),
    enabled: !!user,
  })

  // The user's whole collection, kept locally so edits show up instantly
  // while the real save happens quietly in the background.
  const [coll, setColl] = useState<Record<string, Entry>>({})

  // Remembers the active set for next time.
  useEffect(() => {
    if (activeSetId) localStorage.setItem('poketracker_set', activeSetId)
  }, [activeSetId])

  // Loads the user's full collection once we know who they are.
  useEffect(() => {
    if (!userId) return
    getCollection(userId)
      .then(entries => {
        const m: Record<string, Entry> = {}
        for (const e of entries) {
          m[e.cardId] = { conds: fromCondList(e.conditions), selCond: e.selectedCond || 'NM' }
        }
        setColl(m)
      })
      .catch(() => toast('Could not load your collection.'))
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-set search, waiting a moment after typing stops. Runs whenever
  // the box holds 2+ characters, regardless of which set is selected.
  useEffect(() => {
    if (globalTimer.current) clearTimeout(globalTimer.current)
    const q = search.trim()

    globalTimer.current = window.setTimeout(async () => {
      if (q.length < 2 || activeSetId !== ALL_SETS) {
        setGlobalHits([])
        setGlobalSearching(false)
        return
      }
      setGlobalSearching(true)
      try {
        setGlobalHits(narrowByCollectorNumber(await searchCards(q), q, setTotals))
      }
      catch { setGlobalHits([]); toast('Search failed - please try again.') }
      finally { setGlobalSearching(false) }
    }, 300)

    return () => { if (globalTimer.current) clearTimeout(globalTimer.current) }
  }, [search, setTotals, activeSetId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Loads page 0 of the whole-catalog browse whenever "All Sets" is picked
  // with no search typed, or the sort changes while already there.
  const browseRequestKey = userId && activeSetId === ALL_SETS && search.trim().length < 2
    ? JSON.stringify([userId, search, browseSort, browseDir])
    : null
  const [previousBrowseRequestKey, setPreviousBrowseRequestKey] = useState<string | null>(null)
  if (browseRequestKey !== previousBrowseRequestKey) {
    setPreviousBrowseRequestKey(browseRequestKey)
    if (browseRequestKey) {
      setBrowsePage(0)
      setBrowseLoading(true)
    }
  }

  useEffect(() => {
    if (!userId || activeSetId !== ALL_SETS || search.trim().length >= 2) return
    let cancelled = false
    browseCards({ sort: browseSort, dir: browseDir, page: 0, pageSize: BROWSE_PAGE_SIZE })
      // Defensive fallback, not just the happy path: an old/mismatched
      // backend responding to this route with something other than
      // {cards,total} must degrade to an empty page, not crash the whole
      // app on `undefined.filter` further down.
      .then(res => { if (!cancelled) { setBrowseList(res?.cards ?? []); setBrowseTotal(res?.total ?? 0) } })
      .catch(() => { if (!cancelled) toast('Could not load the catalog.') })
      .finally(() => { if (!cancelled) setBrowseLoading(false) })
    return () => { cancelled = true }
  }, [userId, activeSetId, search, browseSort, browseDir, toast])

  const loadMoreBrowse = () => {
    const nextPage = browsePage + 1
    setBrowseLoading(true)
    browseCards({ sort: browseSort, dir: browseDir, page: nextPage, pageSize: BROWSE_PAGE_SIZE })
      .then(res => { setBrowseList(prev => [...prev, ...(res?.cards ?? [])]); setBrowsePage(nextPage) })
      .catch(() => toast('Could not load more cards.'))
      .finally(() => setBrowseLoading(false))
  }

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  // Only consulted for cross-set grids (search-all, catalog browse) — a
  // single-set grid already names its set once in the banner above it.
  const setNameById = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  /** Saves one card's current local entry to the backend for real. */
  const persist = (card: Card, entry: Entry) => {
    saveEntry(userId, card.id, toCondList(entry.conds, card), entry.selCond)
      // The stats (total value, etc.) are now out of date — tells the
      // cache to fetch a fresh copy.
      .then(() => qc.invalidateQueries({ queryKey: ['stats', userId] }))
      // The on-screen change already happened and isn't rolled back here
      // — a simple "assume it usually works" approach.
      .catch(() => toast('Save failed - change not stored.'))
  }

  /** Changes one card's local entry, then saves it. */
  const mutate = (card: Card, fn: (e: Entry) => Entry) => {
    setColl(prev => {
      const cur = prev[card.id] ?? { conds: {}, selCond: 'NM' }
      // Hands `fn` a fresh copy so it can't accidentally change the original.
      const next = fn({ conds: { ...cur.conds }, selCond: cur.selCond })
      persist(card, next)
      return { ...prev, [card.id]: next }
    })
  }

  /** Adjusts (+1/-1) the currently-selected condition's quantity — the tile's +/- buttons. */
  const adj = (card: Card, delta: number) => {
    const key = (coll[card.id] ?? { selCond: 'NM' }).selCond
    mutate(card, e => {
      const next = Math.max(0, (e.conds[key] ?? 0) + delta)
      if (next === 0) delete e.conds[key]; else e.conds[key] = next
      return e
    })
  }

  /** Sets the selected condition's quantity to an exact typed value. */
  const setQty = (card: Card, qty: number) =>
    mutate(card, e => {
      if (qty === 0) delete e.conds[e.selCond]; else e.conds[e.selCond] = qty
      return e
    })

  // Only switches which condition tab is active — nothing owned actually
  // changes, so this never saves anything.
  const selectCond = (card: Card, cond: string) =>
    setColl(prev => ({
      ...prev,
      [card.id]: { conds: { ...(prev[card.id]?.conds ?? {}) }, selCond: cond },
    }))

  /** Adjusts a specific condition directly (right-click a badge), regardless of which is selected. */
  const adjCond = (card: Card, cond: string, delta: number) =>
    mutate(card, e => {
      const next = Math.max(0, (e.conds[cond] ?? 0) + delta)
      if (next === 0) delete e.conds[cond]; else e.conds[cond] = next
      return e
    })

  /**
   * Exports the WHOLE collection (not just the browsed set) as a CSV
   * file — fetches full card data for every owned card first.
   */
  const exportCSV = async () => {
    let owned
    try {
      owned = await getOwnedCards(userId)
    } catch {
      toast('Export failed — could not load your collection.')
      return
    }

    const rows: (string | number)[][] = [[
      'Card ID', 'Name', 'Set', 'Number', 'Rarity',
      'Condition', 'Quantity', 'Market Price', 'Total Value',
    ]]
    for (const o of owned) {
      for (const [cond, qn] of Object.entries(fromCondList(o.conditions))) {
        if (qn <= 0) continue
        const p = condPrice(o.card, cond)
        rows.push([
          o.cardId, o.card.name, o.card.setId, o.card.number, o.card.rarity ?? '',
          cond, qn, p.toFixed(2), (p * qn).toFixed(2),
        ])
      }
    }
    if (rows.length === 1) { toast('Nothing to export yet.'); return }

    downloadCSV(`pokemon_collection_${user!.username}_${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast(`Exported ${rows.length - 1} rows.`)
  }

  /** Saves already-parsed CSV rows (built by ImportModal) to the backend. */
  const runImport = async (rows: ImportRow[]): Promise<string> => {
    const byCard = new Map<string, CondMap>()
    for (const r of rows) {
      const m = byCard.get(r.cardId) ?? {}
      // Adds onto whatever quantity was already recorded, in case the
      // same card+condition appears on more than one CSV row.
      if (r.quantity > 0) m[r.condition] = (m[r.condition] ?? 0) + r.quantity
      byCard.set(r.cardId, m)
    }

    await bulkSave(userId, [...byCard.entries()].map(([cardId, conds]) => ({
      cardId,
      conditions: toCondList(conds, cardById.get(cardId)),
      selectedCond: 'NM',
    })))

    // Updates the screen right away, without waiting for a full re-fetch.
    setColl(prev => {
      const next = { ...prev }
      for (const [cardId, conds] of byCard) {
        next[cardId] = { conds, selCond: prev[cardId]?.selCond ?? 'NM' }
      }
      return next
    })
    qc.invalidateQueries({ queryKey: ['stats', userId] })
    return `Imported ${byCard.size} card${byCard.size === 1 ? '' : 's'}.`
  }

  /** Removes every owned card in ONLY the currently-browsed set. */
  const clearSet = async () => {
    const ownedHere = cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0)
    if (ownedHere.length === 0) { toast('Nothing to clear in this set.'); return }
    if (!window.confirm(`Remove all ${ownedHere.length} owned cards in this set?`)) return

    // An empty conditions list is the signal the backend uses to mean
    // "delete this card's ownership record entirely."
    await bulkSave(userId, ownedHere.map(c => ({ cardId: c.id, conditions: [], selectedCond: 'NM' })))
      .catch(() => toast('Clear failed.'))

    setColl(prev => {
      const next = { ...prev }
      for (const c of ownedHere) delete next[c.id]
      return next
    })
    qc.invalidateQueries({ queryKey: ['stats', userId] })
    toast('Set cleared.')
  }

  // Search mode kicks in at 2+ characters, independent of the set browser.
  const isSearchMode = search.trim().length >= 2
  const allSets = activeSetId === ALL_SETS

  // The set-browsing card list, filtered by "owned only" and sorted.
  const filtered = useMemo(() => {
    const list = ownedOnly
      ? cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0)
      : [...cards]

    // A card's value if owned, or its base market price otherwise — so
    // sorting by value still makes sense while just browsing.
    const val = (c: Card) => cardValue(coll[c.id]?.conds ?? {}, c) || basePrice(c)
    const qty = (c: Card) => totalQty(coll[c.id]?.conds ?? {})

    if (sort === 'number') list.sort((a, b) => numKey(a.number) - numKey(b.number) || a.number.localeCompare(b.number))
    if (sort === 'value')  list.sort((a, b) => val(b) - val(a))
    if (sort === 'qty')    list.sort((a, b) => qty(b) - qty(a))
    if (sort === 'name')   list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [cards, coll, ownedOnly, sort])

  // Within-set search (done right here, no network call) used when a
  // specific set is selected — "All Sets" instead uses the backend search above.
  const withinSetHits = useMemo(() => {
    if (!isSearchMode || allSets) return []
    const ql = search.trim().toLowerCase()
    const num = search.trim().match(/^(\d+)/)?.[1]
    return cards.filter(c =>
      c.name.toLowerCase().includes(ql) ||
      (!!num && (c.number === num || parseInt(c.number, 10) === parseInt(num, 10)))
    )
  }, [cards, search, isSearchMode, allSets])

  // The catalog-browse list ("All Sets", nothing typed), filtered by "owned only".
  const browseDisplay = useMemo(
    () => browseList.filter(c => !ownedOnly || totalQty(coll[c.id]?.conds ?? {}) > 0),
    [browseList, coll, ownedOnly],
  )

  // Which single list of cards to actually show, based on the current
  // combination of search-mode and set-scope.
  const displayCards = isSearchMode
    ? (allSets ? globalHits : withinSetHits).filter(c => !ownedOnly || totalQty(coll[c.id]?.conds ?? {}) > 0)
    : allSets ? browseDisplay : filtered

  const set = sets.find(s => s.id === activeSetId)
  // "Cards owned" / "Set value" / "Set completion" are all scoped to one
  // specific set (`cards`, the per-set query result) — in All Sets mode
  // that query is disabled and `cards` is always [], so these must show as
  // not-applicable ("—") instead of a misleading literal 0/0%/$0.00.
  const ownedInSet = set ? cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0).length : 0
  const setValue = set ? cards.reduce((sum, c) => sum + cardValue(coll[c.id]?.conds ?? {}, c), 0) : 0
  const completion = set && set.total > 0 ? Math.round((ownedInSet / set.total) * 100) : 0
  const gridReady = isSearchMode ? (allSets ? !globalSearching : true) : allSets ? !browseLoading || browseList.length > 0 : !cardsLoading

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  return (
    <div className="page-tracker">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">CARD<span>STACKS</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          {/* Primary way to find a card: searches every set, no set required. */}
          <input
            type="text"
            className="header-search header-search-wide"
            placeholder={allSets ? 'Search every set by name or number' : `Search within ${set?.name ?? 'this set'}`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {/* Optional: narrow the grid to one set when not searching. */}
          <SetSelector
            sets={sets}
            selectedId={activeSetId}
            onSelect={id => setSetId(id)}
          />
          <HeaderNav />
        </header>

        {/* Stats bar */}
        <div className="stats-bar">
          <div className="stat">
            <div className="stat-label">Cards owned</div>
            <div className="stat-value">
              {set ? ownedInSet : '—'}<span style={{ color: 'var(--muted)', fontSize: 13 }}> / {set?.total ?? '—'}</span>
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Set completion</div>
            <div className="stat-value">
              {set ? `${completion}%` : '—'}
              {set && <div className="progress-wrap"><div className="progress-bar" style={{ width: completion + '%' }} /></div>}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Set value</div>
            <div className="stat-value gold">{set ? `$${setValue.toFixed(2)}` : '—'}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total collection</div>
            <div className="stat-value gold">${(stats?.totalValue ?? 0).toFixed(2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Sets entered</div>
            <div className="stat-value">{stats?.setsEntered ?? '—'}</div>
          </div>
        </div>

        {/* Toolbar — the whole-catalog browse gets its own sort set (Set/
            Price/Artist make sense across sets; per-set actions like
            Export/Clear set don't, so they're swapped out entirely here
            rather than just disabled). */}
        {allSets && !isSearchMode ? (
          <div className="toolbar">
            <span className="sort-label">Sort:</span>
            {(['name', 'price', 'set', 'number', 'artist'] as BrowseSort[]).map(m => (
              <button key={m} className={'tb-btn' + (browseSort === m ? ' active' : '')} onClick={() => setBrowseSort(m)}>
                {m === 'name' ? 'Name' : m === 'price' ? 'Price' : m === 'set' ? 'Set' : m === 'number' ? 'Card #' : 'Artist'}
              </button>
            ))}
            <button className="tb-btn" onClick={() => setBrowseDir(d => (d === 'asc' ? 'desc' : 'asc'))}>
              {browseDir === 'asc' ? '↑ Ascending' : '↓ Descending'}
            </button>
            <button className={'tb-btn' + (ownedOnly ? ' active' : '')} onClick={() => setOwnedOnly(o => !o)}>
              Owned only
            </button>
          </div>
        ) : (
          <div className="toolbar">
            <span className="sort-label">Sort:</span>
            {(['number', 'value', 'qty', 'name'] as SortMode[]).map(m => (
              <button key={m} className={'tb-btn' + (sort === m ? ' active' : '')} onClick={() => setSort(m)}>
                {m === 'number' ? 'Card #' : m === 'value' ? 'Value ↓' : m === 'qty' ? 'Qty ↓' : 'Name'}
              </button>
            ))}
            <button className={'tb-btn' + (ownedOnly ? ' active' : '')} onClick={() => setOwnedOnly(o => !o)}>
              Owned only
            </button>
            <button className="tb-btn" onClick={exportCSV}>⬇ Export CSV</button>
            <button className="tb-btn" onClick={() => setImportOpen(true)}>⬆ Import CSV</button>
            <button className="tb-btn primary" onClick={clearSet}>Clear set</button>
          </div>
        )}

        <div id="app-wrap">
          <div id="main">
            {/* Set banner only when browsing a set (not while searching). */}
            {!isSearchMode && set && (
              <div className="set-info">
                {set.images?.logo && <img className="set-logo" src={set.images.logo} alt={set.name} />}
                <div>
                  <div className="set-name">{set.name}</div>
                  <div className="set-meta">{set.series} · {set.releaseDate} · {set.total} cards</div>
                </div>
              </div>
            )}

            {!isSearchMode && allSets && browseLoading && browseList.length === 0 && (
              <div className="loading">Loading the catalog…</div>
            )}
            {!isSearchMode && allSets && !browseLoading && browseDisplay.length === 0 && (
              <div className="empty">{ownedOnly ? "You don't own any cards yet." : 'No cards in the catalog.'}</div>
            )}
            {!isSearchMode && allSets && browseDisplay.length > 0 && (
              <div style={{ padding: '8px 18px', color: 'var(--muted)', fontSize: 13 }}>
                Showing {browseDisplay.length} of {browseTotal.toLocaleString()} cards
              </div>
            )}

            {isSearchMode && allSets && globalSearching && <div className="loading">Searching all sets…</div>}
            {isSearchMode && gridReady && displayCards.length > 0 && (
              <div style={{ padding: '8px 18px', color: 'var(--muted)', fontSize: 13 }}>
                {displayCards.length} result{displayCards.length !== 1 ? 's' : ''} {allSets ? 'across all sets' : `in ${set?.name ?? 'this set'}`}
              </div>
            )}
            {isSearchMode && gridReady && displayCards.length === 0 && (
              <div className="empty">No cards found for "{search.trim()}"{allSets ? '' : ` in ${set?.name ?? 'this set'}`}.</div>
            )}

            {!isSearchMode && !allSets && cardsLoading && <div className="loading">Loading</div>}
            {!isSearchMode && !allSets && !cardsLoading && set && displayCards.length === 0 && (
              <div className="empty">No cards match.</div>
            )}

            {gridReady && displayCards.length > 0 && (
              <div className="card-grid">
                {displayCards.map(c => {
                  const entry = coll[c.id] ?? { conds: {}, selCond: 'NM' }
                  return (
                    <CardTile
                      key={c.id} card={c} conds={entry.conds} selCond={entry.selCond}
                      setName={allSets ? setNameById.get(c.setId) : undefined}
                      onAdj={d => adj(c, d)}
                      onSetQty={q => setQty(c, q)}
                      onSelectCond={cond => selectCond(c, cond)}
                      onAdjCond={(cond, d) => adjCond(c, cond, d)}
                      onPreview={(src, opts) => (src ? preview.show(src, opts) : preview.hide())}
                      onAddToBinder={() => setBinderCard(c)}
                    />
                  )
                })}
              </div>
            )}

            {!isSearchMode && allSets && browseList.length < browseTotal && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0' }}>
                <button className="tb-btn primary" onClick={loadMoreBrowse} disabled={browseLoading}>
                  {browseLoading ? 'Loading…' : `Load more (${(browseTotal - browseList.length).toLocaleString()} left)`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={runImport} />
      <BinderPickerModal card={binderCard} userId={userId} onClose={() => setBinderCard(null)} />
      {preview.overlay}
    </div>
  )
}
