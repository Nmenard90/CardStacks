/**
 * FILE: CollectionPage.tsx
 * LOCATION: src/pages/CollectionPage.tsx
 *
 * PURPOSE:
 *   The main page for finding and logging cards. There are two ways to find a
 *   card, and finding one NEVER requires picking a set first:
 *     - Search box (primary): type any name or number and the backend searches
 *       every set at once. With 2+ characters the grid shows cross-set results.
 *     - Set browser (optional): the SetSelector narrows the grid to a single set
 *       when you want to work through one. It is a convenience, not a gate.
 *   Quantity edits are optimistic: the local map updates immediately and the
 *   change is POSTed to the Scala API.
 *
 *   "My Collection" (every owned card across all sets) is its own page at /owned.
 *   Quick-add and the Recently Added sidebar live on the Bulk Add page (/bulk).
 *
 * IMPORTS EXPLAINED:
 *   useQuery/useQueryClient — cache sets/cards/stats; invalidate stats on save
 *   getCards/getSets/searchCards — one set's cards, set list, all-sets search
 *   bulkSave/getCollection/getStats/saveEntry — collection read + writes
 *   CardTile        — one card cell (thumbnail, price, +/- stepper, conditions)
 *   usePreview      — large hover-image overlay
 *   HeaderNav       — shared, always-visible page navigation
 *   ImportModal     — CSV import dialog
 *   LoginScreen     — shown when nobody is signed in
 *   SetSelector     — optional set picker for browsing one set
 *   useToast/useUser — notifications + current session
 *   conditions.*    — price/quantity helpers shared across the app
 *   csv.*           — CSV export/import helpers
 *
 * USED BY: App.tsx (route "/")
 * DEPENDS ON: GET /api/sets, /api/cards/:setId, /api/search,
 *             GET /api/collection/:userId (+ /stats), POST .../:cardId, .../bulk
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCards, getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, getStats, saveEntry } from '../api/collection'
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
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

export function CollectionPage() {
  // 1) Context hooks
  const { user } = useUser()
  const toast = useToast()
  const qc = useQueryClient()
  const preview = usePreview()

  // 2) State
  const [setId, setSetId] = useState<string | null>(() => localStorage.getItem('poketracker_set'))
  const [search, setSearch] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('number')
  const [importOpen, setImportOpen] = useState(false)
  // The card whose "add to binder" picker is open (null = closed).
  const [binderCard, setBinderCard] = useState<Card | null>(null)

  // Cross-set search results, populated only while the box holds 2+ characters.
  const [globalHits, setGlobalHits] = useState<Card[]>([])
  const [globalSearching, setGlobalSearching] = useState(false)
  const globalTimer = useRef<number | null>(null)

  const userId = user?.id ?? ''

  // 3) Server data
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // Active set: the stored choice when still valid, else the newest set.
  // Derived (not synced via an effect) so there is no flash of an empty grid.
  const activeSetId = useMemo(() => {
    if (setId === ALL_SETS) return ALL_SETS
    if (setId && sets.some(s => s.id === setId)) return setId
    if (sets.length === 0) return null
    return [...sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0].id
  }, [sets, setId])

  // setId -> totals lookup, used to resolve "117/123" to the one card meant.
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

  // Local collection map, seeded once per user from the backend.
  const [coll, setColl] = useState<Record<string, Entry>>({})

  // 4) Effects
  useEffect(() => {
    if (activeSetId) localStorage.setItem('poketracker_set', activeSetId)
  }, [activeSetId])

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

  // Debounced cross-set search. Runs whenever the box holds 2+ characters,
  // independent of which set (if any) is selected — finding a card never
  // depends on the set browser.
  useEffect(() => {
    if (globalTimer.current) clearTimeout(globalTimer.current)
    const q = search.trim()
    // All setState calls inside the timer callback — no synchronous setState in the effect body.
    globalTimer.current = window.setTimeout(async () => {
      if (q.length < 2 || activeSetId !== ALL_SETS) {
        setGlobalHits([])
        setGlobalSearching(false)
        return
      }
      setGlobalSearching(true)
      try { setGlobalHits(narrowByCollectorNumber(await searchCards(q), q, setTotals)) }
      catch { setGlobalHits([]); toast('Search failed - please try again.') }
      finally { setGlobalSearching(false) }
    }, 300)
    return () => { if (globalTimer.current) clearTimeout(globalTimer.current) }
  }, [search, setTotals, activeSetId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])

  // 5) Event handlers / persistence
  const persist = (card: Card, entry: Entry) => {
    saveEntry(userId, card.id, toCondList(entry.conds, card), entry.selCond)
      .then(() => qc.invalidateQueries({ queryKey: ['stats', userId] }))
      .catch(() => toast('Save failed - change not stored.'))
  }
  const mutate = (card: Card, fn: (e: Entry) => Entry) => {
    setColl(prev => {
      const cur = prev[card.id] ?? { conds: {}, selCond: 'NM' }
      const next = fn({ conds: { ...cur.conds }, selCond: cur.selCond })
      persist(card, next)
      return { ...prev, [card.id]: next }
    })
  }
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

  // CSV export / import / clear set
  const exportCSV = () => {
    const rows: (string | number)[][] = [[
      'Card ID', 'Name', 'Set', 'Number', 'Rarity',
      'Condition', 'Quantity', 'Market Price', 'Total Value',
    ]]
    for (const [id, e] of Object.entries(coll)) {
      const card = cardById.get(id)
      for (const [cond, qn] of Object.entries(e.conds)) {
        if (qn <= 0) continue
        const p = condPrice(card, cond)
        rows.push([
          id, card?.name ?? '', card?.setId ?? id.split('-')[0],
          card?.number ?? '', card?.rarity ?? '',
          cond, qn, p.toFixed(2), (p * qn).toFixed(2),
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

  // 6) Derived values
  // Search mode kicks in at 2+ characters and is independent of the set browser.
  const isSearchMode = search.trim().length >= 2
  // All Sets mode searches every set; otherwise search stays inside the set.
  const allSets = activeSetId === ALL_SETS

  const filtered = useMemo(() => {
    const list = ownedOnly
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

  // Within-set search (client-side) used when a specific set is selected.
  const withinSetHits = useMemo(() => {
    if (!isSearchMode || allSets) return []
    const ql = search.trim().toLowerCase()
    const num = search.trim().match(/^(\d+)/)?.[1]
    return cards.filter(c =>
      c.name.toLowerCase().includes(ql) ||
      (!!num && (c.number === num || parseInt(c.number, 10) === parseInt(num, 10)))
    )
  }, [cards, search, isSearchMode, allSets])

  // While searching: All Sets -> backend hits, else within-set hits. Else the set grid.
  const displayCards = isSearchMode
    ? (allSets ? globalHits : withinSetHits).filter(c => !ownedOnly || totalQty(coll[c.id]?.conds ?? {}) > 0)
    : filtered

  const set = sets.find(s => s.id === activeSetId)
  const ownedInSet = cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0).length
  const setValue = cards.reduce((sum, c) => sum + cardValue(coll[c.id]?.conds ?? {}, c), 0)
  const completion = set && set.total > 0 ? Math.round((ownedInSet / set.total) * 100) : 0
  const gridReady = isSearchMode ? (allSets ? !globalSearching : true) : !cardsLoading

  // 7) Login guard
  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  // 8) Render
  return (
    <div className="page-tracker">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">POKÉDEX <span>TRACKER</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          {/* Primary way to find a card: searches every set, no set required. */}
          <input
            type="text"
            placeholder={allSets ? 'Search every set by name or number' : `Search within ${set?.name ?? 'this set'}`}
            style={{ width: 300 }}
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

        {/* Toolbar */}
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

            {/* All Sets selected with nothing typed yet: prompt to browse or search. */}
            {!isSearchMode && allSets && (
              <div className="empty">Pick a set above to browse it, or type a name or number to search every set.</div>
            )}

            {/* Search-mode status lines */}
            {isSearchMode && allSets && globalSearching && <div className="loading">Searching all sets…</div>}
            {isSearchMode && gridReady && displayCards.length > 0 && (
              <div style={{ padding: '8px 18px', color: 'var(--muted)', fontSize: 13 }}>
                {displayCards.length} result{displayCards.length !== 1 ? 's' : ''} {allSets ? 'across all sets' : `in ${set?.name ?? 'this set'}`}
              </div>
            )}
            {isSearchMode && gridReady && displayCards.length === 0 && (
              <div className="empty">No cards found for "{search.trim()}"{allSets ? '' : ` in ${set?.name ?? 'this set'}`}.</div>
            )}

            {/* Browse-mode status lines (specific set only) */}
            {!isSearchMode && !allSets && cardsLoading && <div className="loading">Loading</div>}
            {!isSearchMode && !allSets && !cardsLoading && set && displayCards.length === 0 && (
              <div className="empty">No cards match.</div>
            )}

            {/* Card grid (shared by both modes) */}
            {gridReady && displayCards.length > 0 && (
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
                      onAddToBinder={() => setBinderCard(c)}
                    />
                  )
                })}
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
