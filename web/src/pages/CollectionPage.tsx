/**
 * FILE: CollectionPage.tsx
 * LOCATION: src/pages/CollectionPage.tsx
 *
 * PURPOSE:
 *   Main collection page — two modes toggled by tabs in the header:
 *
 *   BROWSE SETS mode:
 *     Shows all cards in the selected set. When the search box has 2+ chars,
 *     switches to a global cross-set search (all sets, backed by pokemontcg.io
 *     fallback). The SetSelector is only shown in this mode.
 *
 *   MY COLLECTION mode:
 *     Shows every card owned across ALL sets in one view. Search is a local
 *     filter. Sort by name, qty, value, or set. Loads from
 *     GET /api/collection/:userId/owned on first switch.
 *
 * USED BY: App.tsx (route "/")
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCards, getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, getOwnedCards, getStats, saveEntry } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { ImportModal } from '../components/ImportModal'
import { LoginScreen } from '../components/LoginScreen'
import { NavMenu } from '../components/NavMenu'
import { SetSelector } from '../components/SetSelector'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  basePrice, cardValue, condPrice, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
import { downloadCSV, type ImportRow } from '../lib/csv'
import type { Card } from '../types'

interface Entry { conds: CondMap; selCond: string }
type SortMode = 'number' | 'value' | 'qty' | 'name'

const numKey = (n: string) => {
  const m = n.match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
}

const TAB_STYLE = `
.mode-tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); }
.mode-tab {
  padding: 10px 22px; font-size: 14px; font-weight: 600; cursor: pointer;
  background: transparent; border: 0; border-bottom: 2px solid transparent;
  color: var(--muted); transition: color .15s, border-color .15s; font-family: inherit;
}
.mode-tab.active { color: var(--text); border-bottom-color: var(--accent); }
.mode-tab:hover:not(.active) { color: var(--text); }
`

export function CollectionPage() {
  const { user, setUser } = useUser()
  const toast = useToast()
  const qc = useQueryClient()
  const preview = usePreview()

  // ── Page mode ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'browse' | 'owned'>('browse')

  // ── UI state ──────────────────────────────────────────────────────────────
  const [setId, setSetId] = useState<string | null>(() => localStorage.getItem('poketracker_set'))
  const [search, setSearch] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('number')
  const [importOpen, setImportOpen] = useState(false)

  // ── Global search (browse mode only) ─────────────────────────────────────
  const [globalHits, setGlobalHits] = useState<Card[]>([])
  const [globalSearching, setGlobalSearching] = useState(false)
  const globalTimer = useRef<number | null>(null)

  // ── My Collection state ───────────────────────────────────────────────────
  const [ownedCards, setOwnedCards] = useState<Card[]>([])
  const [ownedLoading, setOwnedLoading] = useState(false)
  const [ownedLoaded, setOwnedLoaded] = useState(false)

  const userId = user?.id ?? ''

  // ── Server data ───────────────────────────────────────────────────────────
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  const activeSetId = useMemo(() => {
    if (setId && sets.some(s => s.id === setId)) return setId
    if (sets.length === 0) return null
    return [...sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0].id
  }, [sets, setId])

  useEffect(() => {
    if (activeSetId) localStorage.setItem('poketracker_set', activeSetId)
  }, [activeSetId])

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

  // ── Local collection map (optimistic, shared across modes) ────────────────
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
        setOwnedLoaded(false)
      })
      .catch(() => toast('Could not load your collection.'))
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])

  // ── Load all owned cards when switching to My Collection mode ─────────────
  useEffect(() => {
    if (mode !== 'owned' || ownedLoaded || ownedLoading || !userId) return
    setOwnedLoading(true)
    getOwnedCards(userId)
      .then(owned => {
        setOwnedCards(owned.map(o => o.card))
        setColl(prev => {
          const m = { ...prev }
          for (const o of owned) {
            m[o.cardId] = { conds: fromCondList(o.conditions), selCond: o.selectedCond || 'NM' }
          }
          return m
        })
        setOwnedLoaded(true)
      })
      .catch(() => toast('Could not load your full collection.'))
      .finally(() => setOwnedLoading(false))
  }, [mode, ownedLoaded, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global search debounce (browse mode only) ─────────────────────────────
  useEffect(() => {
    if (mode !== 'browse') { setGlobalHits([]); setGlobalSearching(false); return }
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
  }, [search, mode])

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

  // ── Derived display cards ─────────────────────────────────────────────────
  const isSearchMode = mode === 'browse' && search.trim().length >= 2

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

  const ownedDisplay = useMemo(() => {
    if (mode !== 'owned') return []
    const q = search.trim().toLowerCase()
    let list = ownedCards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0)
    if (q) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.number.toLowerCase().includes(q) ||
        c.setId.toLowerCase().includes(q)
      )
    }
    if (sort === 'name')   list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'value')  list.sort((a, b) => cardValue(coll[b.id]?.conds ?? {}, b) - cardValue(coll[a.id]?.conds ?? {}, a) || basePrice(b) - basePrice(a))
    if (sort === 'qty')    list.sort((a, b) => totalQty(coll[b.id]?.conds ?? {}) - totalQty(coll[a.id]?.conds ?? {}))
    if (sort === 'number') list.sort((a, b) => a.setId.localeCompare(b.setId) || numKey(a.number) - numKey(b.number))
    return list
  }, [mode, ownedCards, coll, search, sort])

  const displayCards = mode === 'owned'
    ? ownedDisplay
    : isSearchMode
      ? globalHits.filter(c => !ownedOnly || totalQty(coll[c.id]?.conds ?? {}) > 0)
      : filtered

  const set = sets.find(s => s.id === activeSetId)
  const ownedInSet = cards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0).length
  const setValue = cards.reduce((sum, c) => sum + cardValue(coll[c.id]?.conds ?? {}, c), 0)
  const completion = set && set.total > 0 ? Math.round((ownedInSet / set.total) * 100) : 0

  const gridReady = mode === 'owned'
    ? !ownedLoading
    : isSearchMode ? !globalSearching : !cardsLoading

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  return (
    <div className="page-tracker">
      <style>{TAB_STYLE}</style>
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">POKÉDEX <span>TRACKER</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          {/* SetSelector only visible in Browse Sets mode */}
          {mode === 'browse' && (
            <SetSelector
              sets={sets}
              selectedId={activeSetId}
              onSelect={id => { setSetId(id); setSearch('') }}
            />
          )}
          <input
            type="text"
            placeholder={
              mode === 'owned'
                ? 'Filter by name, number, or set…'
                : isSearchMode
                  ? 'Searching all sets…'
                  : 'Search all sets…'
            }
            style={{ width: 220 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <NavMenu current="/" />
        </header>

        {/* Mode tabs */}
        <div className="mode-tabs">
          <button
            className={'mode-tab' + (mode === 'browse' ? ' active' : '')}
            onClick={() => { setMode('browse'); setSearch('') }}
          >
            Browse Sets
          </button>
          <button
            className={'mode-tab' + (mode === 'owned' ? ' active' : '')}
            onClick={() => { setMode('owned'); setSearch('') }}
          >
            My Collection
            {stats && stats.uniqueCards > 0 && (
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 12 }}>
                ({stats.uniqueCards})
              </span>
            )}
          </button>
        </div>

        {/* Stats bar */}
        <div className="stats-bar">
          {mode === 'browse' ? (
            <>
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
            </>
          ) : (
            <>
              <div className="stat">
                <div className="stat-label">Unique cards</div>
                <div className="stat-value">{stats?.uniqueCards ?? ownedCards.length}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Total copies</div>
                <div className="stat-value">{stats?.totalCards ?? 0}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Total value</div>
                <div className="stat-value gold">${(stats?.totalValue ?? 0).toFixed(2)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Sets</div>
                <div className="stat-value">{stats?.setsEntered ?? 0}</div>
              </div>
              {search && (
                <div className="stat">
                  <div className="stat-label">Showing</div>
                  <div className="stat-value">{displayCards.length} of {ownedCards.filter(c => totalQty(coll[c.id]?.conds ?? {}) > 0).length}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          {mode === 'browse' && !isSearchMode && (
            <>
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
            </>
          )}
          {mode === 'owned' && (
            <>
              <span className="sort-label">Sort:</span>
              {(['name', 'qty', 'value', 'number'] as SortMode[]).map(m => (
                <button key={m} className={'tb-btn' + (sort === m ? ' active' : '')} onClick={() => setSort(m as SortMode)}>
                  {m === 'name' ? 'Name' : m === 'qty' ? 'Qty ↓' : m === 'value' ? 'Value ↓' : 'By Set'}
                </button>
              ))}
              <button className="tb-btn" onClick={exportCSV}>⬇ Export CSV</button>
            </>
          )}
        </div>

        <div id="app-wrap">
          <div id="main">

            {/* ── Browse Sets mode ─────────────────────────────────── */}
            {mode === 'browse' && (
              <>
                {!isSearchMode && set && (
                  <div className="set-info">
                    {set.images?.logo && <img className="set-logo" src={set.images.logo} alt={set.name} />}
                    <div>
                      <div className="set-name">{set.name}</div>
                      <div className="set-meta">{set.series} · {set.releaseDate} · {set.total} cards</div>
                    </div>
                  </div>
                )}
                {isSearchMode && globalSearching && <div className="loading">Searching all sets…</div>}
                {isSearchMode && !globalSearching && displayCards.length === 0 && (
                  <div className="empty">No cards found for "{search.trim()}".</div>
                )}
                {isSearchMode && !globalSearching && displayCards.length > 0 && (
                  <div style={{ padding: '8px 18px', color: 'var(--muted)', fontSize: 13 }}>
                    {displayCards.length} result{displayCards.length !== 1 ? 's' : ''} across all sets
                  </div>
                )}
                {!isSearchMode && cardsLoading && <div className="loading">Loading</div>}
                {!isSearchMode && !cardsLoading && displayCards.length === 0 && (
                  <div className="empty">No cards match.</div>
                )}
              </>
            )}

            {/* ── My Collection mode ──────────────────────────────── */}
            {mode === 'owned' && (
              <>
                {ownedLoading && <div className="loading">Loading your collection…</div>}
                {!ownedLoading && ownedCards.length === 0 && (
                  <div className="empty">
                    You don't own any cards yet. Use the Browse Sets tab to add cards.
                  </div>
                )}
                {!ownedLoading && ownedCards.length > 0 && ownedDisplay.length === 0 && (
                  <div className="empty">
                    {search ? `No cards match "${search}".` : 'No owned cards.'}
                  </div>
                )}
              </>
            )}

            {/* ── Card grid (both modes) ───────────────────────────── */}
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
