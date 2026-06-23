/**
 * FILE: CollectionPage.tsx
 * LOCATION: src/pages/CollectionPage.tsx
 *
 * PURPOSE:
 *   Set browser and collection tracker. Two modes driven by the search box:
 *
 *   SET BROWSE (search empty):
 *     Shows every card in the selected set.  Filtering by owned-only, sorting
 *     by number / value / qty / name, and per-card +/− all work here.
 *     CSV export and import live here too.
 *
 *   GLOBAL SEARCH (search ≥ 2 chars):
 *     Queries the backend across ALL sets — the Scala service falls back to
 *     the pokemontcg.io API if the DB does not have the card yet.  Results
 *     show set name and support the same +/− adjustments as the set browse.
 *     Clearing the search returns to set-browse mode.
 *
 *   Quick-add by collector number and the "Recently Added" sidebar have moved
 *   to BulkAddPage, which is the primary card-entry hub.
 *
 * IMPORTS EXPLAINED:
 *   useQuery/useQueryClient — React Query for sets, cards-in-set, collection stats
 *   useEffect/useMemo/useRef/useState — search debounce, derived data, local coll map
 *   Link                   — nav links to other pages
 *   getCards/getSets/searchCards — set list, per-set cards, global name/number search
 *   bulkSave/getCollection/getStats/saveEntry — collection CRUD
 *   CardTile / usePreview  — shared card tile + hover-overlay
 *   ImportModal            — CSV import dialog
 *   LoginScreen            — shown when nobody is logged in
 *   SetSelector            — the set dropdown component
 *   useToast               — bottom-right toast for save errors
 *   useUser                — currently logged-in user
 *   conditions helpers     — price math, list <-> map, sorting
 *   downloadCSV            — triggers a browser CSV download
 *
 * USED BY: App.tsx (route "/")
 * DEPENDS ON: backend GET /api/sets, /api/cards/:setId, /api/search,
 *             POST /api/collection/:userId/:cardId, /api/collection/:userId/bulk
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCards, getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, getStats, saveEntry } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { ImportModal } from '../components/ImportModal'
import { LoginScreen } from '../components/LoginScreen'
import { SetSelector } from '../components/SetSelector'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  basePrice, cardValue, condPrice, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
import { downloadCSV, type ImportRow } from '../lib/csv'
import type { Card } from '../types'

/** Local state for one card: counts per condition + the currently active condition. */
interface Entry { conds: CondMap; selCond: string }

type SortMode = 'number' | 'value' | 'qty' | 'name'

/**
 * PURPOSE: Numeric sort key for collector numbers.
 *   Pure-numeric numbers sort as integers; non-numeric (TG01, SWSH158) sort
 *   after all numeric cards because they return MAX_SAFE_INTEGER.
 */
const numKey = (n: string) => {
  const m = n.match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

export function CollectionPage() {
  const { user, setUser } = useUser()
  const toast = useToast()
  const qc = useQueryClient()
  const preview = usePreview()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [setId, setSetId] = useState<string | null>(() => localStorage.getItem('poketracker_set'))
  const [search, setSearch] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('number')
  const [importOpen, setImportOpen] = useState(false)

  // ── Global (cross-set) search state ──────────────────────────────────────
  // Populated by a debounced call to searchCards when search length >= 2.
  // While searching the backend, isSearchMode hides the set-browse grid.
  const [globalHits, setGlobalHits] = useState<Card[]>([])
  const [globalSearching, setGlobalSearching] = useState(false)
  const globalTimer = useRef<number | null>(null)

  // ── Server data ───────────────────────────────────────────────────────────
  const userId = user?.id ?? ''

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  /**
   * PURPOSE: Resolve the active set ID from the stored preference.
   *   Falls back to the newest set when the stored ID is no longer in the
   *   list (e.g., after a DB reset).  Derived synchronously so there is no
   *   flash of empty content while an effect runs.
   */
  const activeSetId = useMemo(() => {
    if (setId && sets.some(s => s.id === setId)) return setId
    if (sets.length === 0) return null
    return [...sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0].id
  }, [sets, setId])
  useEffect(() => { if (activeSetId) localStorage.setItem('poketracker_set', activeSetId) }, [activeSetId])

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['cards', activeSetId],
    queryFn: () => getCards(activeSetId!),
    enabled: !!user && !!activeSetId,
  })
  const { data: stats } = useQuery({
    queryKey: ['stats', userId],
    queryFn: () => getStats(userId),
    enabled: !!user,
  })

  /**
   * PURPOSE: Seed the local collection map from the backend on login.
   *   `coll` is the optimistic local mirror: every +/− mutates it immediately
   *   and fires a background POST so the UI never feels laggy.
   */
  const [coll, setColl] = useState<Record<string, Entry>>({})
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

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])

  /**
   * PURPOSE: Debounced cross-set search.
   *   Fires 300 ms after the last keystroke so we do not hammer the backend
   *   while the user is still typing.  Sets globalHits for the search-mode grid.
   */
  useEffect(() => {
    if (globalTimer.current) clearTimeout(globalTimer.current)
    const q = search.trim()
    if (q.length < 2) { setGlobalHits([]); setGlobalSearching(false); return }
    setGlobalSearching(true)
    globalTimer.current = window.setTimeout(async () => {
      try { setGlobalHits(await searchCards(q)) }
      catch { setGlobalHits([]) }
      finally { setGlobalSearching(false) }
    }, 300)
    return () => { if (globalTimer.current) clearTimeout(globalTimer.current) }
  }, [search])

  // ── Persistence ───────────────────────────────────────────────────────────

  const persist = (card: Card, entry: Entry) => {
    saveEntry(userId, card.id, toCondList(entry.conds, card), entry.selCond)
      .then(() => qc.invalidateQueries({ queryKey: ['stats', userId] }))
      .catch(() => toast('Save failed — change not stored.'))
  }

  const mutate = (card: Card, fn: (e: Entry) => Entry) => {
    setColl(prev => {
      const cur = prev[card.id] ?? { conds: {}, selCond: 'NM' }
      const next = fn({ conds: { ...cur.conds }, selCond: cur.selCond })
      persist(card, next)
      return { ...prev, [card.id]: next }
    })
  }

  /** PURPOSE: +/− on the selected condition, persisted immediately. */
  const adj = (card: Card, delta: number) => {
    const key = (coll[card.id] ?? { selCond: 'NM' }).selCond
    mutate(card, e => {
      const next = Math.max(0, (e.conds[key] ?? 0) + delta)
      if (next === 0) delete e.conds[key]; else e.conds[key] = next
      return e
    })
  }

  const setQty = (card: Card, qty: number) =>
    mutate(card, e => {
      if (qty === 0) delete e.conds[e.selCond]; else e.conds[e.selCond] = qty
      return e
    })

  const selectCond = (card: Card, cond: string) =>
    setColl(prev => ({
      ...prev,
      [card.id]: { conds: { ...(prev[card.id]?.conds ?? {}) }, selCond: cond },
    }))

  const adjCond = (card: Card, cond: string, delta: number) =>
    mutate(card, e => {
      const next = Math.max(0, (e.conds[cond] ?? 0) + delta)
      if (next === 0) delete e.conds[cond]; else e.conds[cond] = next
      return e
    })

  // ── CSV export / import / clear set ──────────────────────────────────────

  const exportCSV = () => {
    const rows: (string | number)[][] = [[
      'Card ID', 'Name', 'Set', 'Number', 'Rarity',
      'Condition', 'Quantity', 'Market Price', 'Total Value',
    ]]
    for (const [id, e] of Object.entries(coll)) {
      const card = cardById.get(id)
      for (const [cond, q] of Object.entries(e.conds)) {
        if (q <= 0) continue
        const p = condPrice(card, cond)
        rows.push([
          id, card?.name ?? '', card?.setId ?? id.split('-')[0],
          card?.number ?? '', card?.rarity ?? '',
          cond, q, p.toFixed(2), (p * q).toFixed(2),
        ])
      }
    }
    if (rows.length === 1) { toast('Nothing to export yet.'); return }
    downloadCSV(`pokemon_collection_${user!.username}_${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast(`Exported ${rows.length - 1} rows.`)
  }

  const runImport = async (rows: ImportRow[]): Promise<string> => {
    const byCard = new Map<string, CondMap>()
    for (const r of rows) {
      const m = byCard.get(r.cardId) ?? {}
      if (r.quantity > 0) m[r.condition] = (m[r.condition] ?? 0) + r.quantity
      byCard.set(r.cardId, m)
    }
    await bulkSave(userId, [...byCard.entries()].map(([cardId, conds]) => ({
      cardId,
      conditions: toCondList(conds, cardById.get(cardId)),
      selectedCond: 'NM',
    })))
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

  const clearSet = async () => {
    const ownedHere = cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0)
    if (ownedHere.length === 0) { toast('Nothing to clear in this set.'); return }
    if (!window.confirm(`Remove all ${ownedHere.length} owned cards in this set?`)) return
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

  // ── Derived view data ─────────────────────────────────────────────────────

  /**
   * PURPOSE: The card list for set-browse mode.
   *   Applies owned-only filter and the active sort.  Does NOT apply the search
   *   text — that switches to global-search mode instead (see isSearchMode).
   */
  const filtered = useMemo(() => {
    let list = ownedOnly
      ? cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0)
      : [...cards]
    const val = (c: Card) => cardValue(coll[c.id]?.conds ?? {}, c) || basePrice(c)
    const qty = (c: Card) => totalQty(coll[c.id]?.conds ?? {})
    if (sort === 'number') list.sort((a, b) => numKey(a.number) - numKey(b.number) || a.number.localeCompare(b.number))
    if (sort === 'value')  list.sort((a, b) => val(b) - val(a))
    if (sort === 'qty')    list.sort((a, b) => qty(b) - qty(a))
    if (sort === 'name')   list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [cards, coll, ownedOnly, sort])

  const isSearchMode = search.trim().length >= 2
  const displayCards = isSearchMode
    ? globalHits.filter(c => !ownedOnly || totalQty(coll[c.id]?.conds ?? {}) > 0)
    : filtered

  const set = sets.find(s => s.id === activeSetId)
  const ownedInSet = cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0).length
  const setValue = cards.reduce((sum, c) => sum + cardValue(coll[c.id]?.conds ?? {}, c), 0)
  const completion = set && set.total > 0 ? Math.round((ownedInSet / set.total) * 100) : 0

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  return (
    <div className="page-tracker">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">POKÉDEX <span>TRACKER</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <SetSelector sets={sets} selectedId={activeSetId} onSelect={id => { setSetId(id); setSearch('') }} />
          <input
            type="text"
            placeholder={isSearchMode ? 'Searching all sets…' : 'Search all sets or filter this set…'}
            style={{ width: 220 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="header-right">
            <Link to="/owned" className="tb-btn" style={{ textDecoration: 'none' }}>📦 My Collection</Link>
            <Link to="/bulk" className="tb-btn" style={{ textDecoration: 'none' }}>⚡ Bulk Add</Link>
            <Link to="/shelf" className="tb-btn" style={{ textDecoration: 'none' }}>📒 Binders</Link>
            <Link to="/analyzer" className="tb-btn" style={{ textDecoration: 'none' }}>⚖️ Analyzer</Link>
            <Link to="/convention" className="tb-btn" style={{ textDecoration: 'none' }}>🎪 Convention</Link>
            <button className={'tb-btn' + (ownedOnly ? ' active' : '')} onClick={() => setOwnedOnly(o => !o)}>
              Owned only
            </button>
            <button className="tb-btn" onClick={exportCSV}>⬇ Export CSV</button>
            <button className="tb-btn" onClick={() => setImportOpen(true)}>⬆ Import CSV</button>
            <button className="tb-btn primary" onClick={clearSet}>Clear set</button>
            <button className="tb-btn" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>
              Switch user
            </button>
          </div>
        </header>

        <div className="stats-bar">
          <div className="stat">
            <div className="stat-label">Cards owned</div>
            <div className="stat-value">
              {ownedInSet}<span style={{ color: 'var(--muted)', fontSize: 13 }}> / {set?.total ?? '—'}</span>
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Set completion</div>
            <div className="stat-value">
              {completion}%
              <div className="progress-wrap"><div className="progress-bar" style={{ width: completion + '%' }} /></div>
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Set value</div>
            <div className="stat-value gold">${setValue.toFixed(2)}</div>
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

        {/* Sort toolbar — only relevant in set-browse mode */}
        {!isSearchMode && (
          <div className="toolbar">
            <span className="sort-label">Sort:</span>
            {(['number', 'value', 'qty', 'name'] as SortMode[]).map(m => (
              <button key={m} className={'tb-btn' + (sort === m ? ' active' : '')} onClick={() => setSort(m)}>
                {m === 'number' ? 'Card #' : m === 'value' ? 'Value ↓' : m === 'qty' ? 'Qty ↓' : 'Name'}
              </button>
            ))}
          </div>
        )}

        <div id="app-wrap">
          <div id="main">

            {/* Set info banner — hidden during global search */}
            {!isSearchMode && set && (
              <div className="set-info">
                {set.images?.logo && <img className="set-logo" src={set.images.logo} alt={set.name} />}
                <div>
                  <div className="set-name">{set.name}</div>
                  <div className="set-meta">{set.series} · {set.releaseDate} · {set.total} cards</div>
                </div>
              </div>
            )}

            {/* Global search status */}
            {isSearchMode && globalSearching && <div className="loading">Searching all sets…</div>}
            {isSearchMode && !globalSearching && displayCards.length === 0 && (
              <div className="empty">No cards found for "{search.trim()}".</div>
            )}
            {isSearchMode && !globalSearching && displayCards.length > 0 && (
              <div style={{ padding: '8px 18px', color: 'var(--muted)', fontSize: 13 }}>
                {displayCards.length} result{displayCards.length !== 1 ? 's' : ''} across all sets
              </div>
            )}

            {/* Set-browse loading / empty states */}
            {!isSearchMode && cardsLoading && <div className="loading">Loading</div>}
            {!isSearchMode && !cardsLoading && displayCards.length === 0 && (
              <div className="empty">No cards match.</div>
            )}

            {/* Card grid */}
            {(!isSearchMode ? !cardsLoading : !globalSearching) && displayCards.length > 0 && (
              <div className="card-grid">
                {displayCards.map(c => {
                  const entry = coll[c.id] ?? { conds: {}, selCond: 'NM' }
                  return (
                    <CardTile
                      key={c.id} card={c} conds={entry.conds} selCond={entry.selCond}
                      onAdj={d => adj(c, d)}
                      onSetQty={q => setQty(c, q)}
                      onSelectCond={cond => selectCond(c, cond)}
                      onAdjCond={(cond, d) => adjCond(c, cond, d)}
                      onPreview={src => (src ? preview.show(src) : preview.hide())}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={runImport} />
      {preview.overlay}
    </div>
  )
}
