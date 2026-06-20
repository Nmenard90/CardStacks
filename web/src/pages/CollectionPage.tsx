/**
 * FILE: CollectionPage.tsx
 * LOCATION: src/pages/CollectionPage.tsx
 *
 * PURPOSE:
 *   The main tracker — a full-parity port of the old index.html:
 *   header (set selector, card search, page links, owned-only, CSV
 *   export/import, clear set, switch user), the five-stat bar, sort
 *   toolbar, set info + quick-add row, the condition-aware card grid,
 *   the Recently Added sidebar, and the hover preview overlay.
 *
 *   Data model: a local map cardId → {conds, selCond} mirrors the
 *   backend collection; every mutation updates the map optimistically
 *   and POSTs the card's full condition list to the Scala API.
 *
 * USED BY: App (route "/")
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
import { RecentSidebar, type SessionCard } from '../components/RecentSidebar'
import { SetSelector } from '../components/SetSelector'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  basePrice, cardValue, condPrice, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
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
  const { user, setUser } = useUser()
  const toast = useToast()
  const qc = useQueryClient()
  const preview = usePreview()

  // ── UI state, mirroring the old page's globals ─────────────────────────
  const [setId, setSetId] = useState<string | null>(() => localStorage.getItem('poketracker_set'))
  const [search, setSearch] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [sort, setSort] = useState<SortMode>('number')
  const [importOpen, setImportOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [session, setSession] = useState<SessionCard[]>([])
  // Quick-add row state.
  const [quick, setQuick] = useState('')
  const [quickCond, setQuickCond] = useState('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [quickMsg, setQuickMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [quickFlash, setQuickFlash] = useState<'' | 'flash-ok' | 'flash-err'>('')
  const quickRef = useRef<HTMLInputElement>(null)

  // ── Server data ────────────────────────────────────────────────────────
  const userId = user?.id ?? ''

  // The session list belongs to one login — switching users must not
  // carry the previous person's "Recently Added" cards over. Reset uses
  // React's prev-value-during-render pattern rather than an effect, so
  // the stale list never paints for the new user.
  const [sessionOwner, setSessionOwner] = useState(userId)
  if (sessionOwner !== userId) {
    setSessionOwner(userId)
    setSession([])
    setSidebarOpen(false)
  }

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // The active set: the stored choice when it's valid, else the newest set.
  // Derived rather than synced in an effect so there is no flash of nothing.
  const activeSetId = useMemo(() => {
    if (setId && sets.some(s => s.id === setId)) return setId
    if (sets.length === 0) return null
    return [...sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0].id
  }, [sets, setId])
  useEffect(() => { if (activeSetId) localStorage.setItem('poketracker_set', activeSetId) }, [activeSetId])

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['cards', activeSetId], queryFn: () => getCards(activeSetId!), enabled: !!user && !!activeSetId,
  })
  const { data: stats } = useQuery({
    queryKey: ['stats', userId], queryFn: () => getStats(userId), enabled: !!user,
  })

  // Local collection map, seeded from the backend once per user.
  const [coll, setColl] = useState<Record<string, Entry>>({})
  useEffect(() => {
    if (!userId) return
    getCollection(userId)
      .then(entries => {
        const m: Record<string, Entry> = {}
        for (const e of entries) m[e.cardId] = { conds: fromCondList(e.conditions), selCond: e.selectedCond || 'NM' }
        setColl(m)
      })
      .catch(() => toast('Could not load your collection.'))
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])

  // ── Persistence: optimistic local update + POST, like the old saveOne ──
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

  /** +/− on the selected condition; + also feeds the session sidebar. */
  const adj = (card: Card, delta: number) => {
    const entry = coll[card.id] ?? { conds: {}, selCond: 'NM' }
    const key = entry.selCond
    mutate(card, e => {
      const next = Math.max(0, (e.conds[key] ?? 0) + delta)
      if (next === 0) delete e.conds[key]; else e.conds[key] = next
      return e
    })
    if (delta > 0) {
      setSession(s => [{ uid: crypto.randomUUID(), card, condKey: key, price: condPrice(card, key) }, ...s])
      setSidebarOpen(true)
    }
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

  // ── Quick add: Enter on a card number adds one in the chosen condition ─
  const quickAdd = async () => {
    const raw = quick.trim()
    if (!raw) return
    // A quick-add entry may be a bare number ("158"), a full collector number
    // ("SWSH158", "TG01"), or the printed "number/total" form ("158/198").
    // Split the "/total" off so we can match the number and, if multiple sets
    // share that number, use the total to pick the right set.
    const [numPart, totalPart] = raw.includes('/') ? raw.split('/') : [raw, '']
    const num = numPart.trim().toLowerCase()
    const total = totalPart.trim()

    // 1) Try the currently-loaded set first — instant, no network call.
    let card: Card | null =
      cards.find(c => c.number.toLowerCase() === num) ||
      cards.find(c => /^\d+$/.test(num) && /^\d+$/.test(c.number) && parseInt(c.number, 10) === parseInt(num, 10)) ||
      cards.find(c => c.number.toLowerCase().startsWith(num)) || null

    // 2) Not in this set — search every set by number/name via the backend,
    //    so bulk entry works without first picking the right set.
    if (!card) {
      try {
        const hits = await searchCards(raw)
        // Prefer an exact collector-number match over name/partial hits.
        let pool = hits.filter(h => h.number.toLowerCase() === num)
        if (pool.length === 0) pool = hits
        // If a set size was given ("/198"), disambiguate by the set's total.
        if (total && pool.length > 1) {
          const byTotal = pool.filter(h => {
            const s = sets.find(x => x.id === h.setId)
            return !!s && (String(s.total) === total || String(s.printedTotal) === total)
          })
          if (byTotal.length) pool = byTotal
        }
        card = pool[0] ?? null
      } catch { /* fall through to the not-found path below */ }
    }

    if (!card) {
      setQuickFlash('flash-err')
      setQuickMsg({ text: 'not found: ' + raw, err: true })
      setTimeout(() => setQuickFlash(''), 600)
      setQuick('')
      return
    }
    const key = firstEd ? quickCond + ' 1st Ed' : quickCond
    mutate(card, e => { e.conds[key] = (e.conds[key] ?? 0) + 1; return e })
    setSession(s => [{ uid: crypto.randomUUID(), card, condKey: key, price: condPrice(card, key) }, ...s])
    setSidebarOpen(true)
    setQuickFlash('flash-ok')
    const p = condPrice(card, key)
    setQuickMsg({ text: `✓ #${card.number} ${card.name} (${key})${p > 0 ? ' · $' + p.toFixed(2) : ''}`, err: false })
    setTimeout(() => setQuickFlash(''), 400)
    setQuick('')
    quickRef.current?.focus()
  }

  // ── CSV export / import / clear set ────────────────────────────────────
  const exportCSV = () => {
    const rows: (string | number)[][] = [['Card ID', 'Name', 'Set', 'Number', 'Rarity', 'Condition', 'Quantity', 'Market Price', 'Total Value']]
    for (const [id, e] of Object.entries(coll)) {
      const card = cardById.get(id)
      for (const [cond, q] of Object.entries(e.conds)) {
        if (q <= 0) continue
        const p = condPrice(card, cond)
        rows.push([id, card?.name ?? '', card?.setId ?? id.split('-')[0], card?.number ?? '', card?.rarity ?? '', cond, q, p.toFixed(2), (p * q).toFixed(2)])
      }
    }
    if (rows.length === 1) { toast('Nothing to export yet.'); return }
    downloadCSV(`pokemon_collection_${user!.username}_${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast(`Exported ${rows.length - 1} rows.`)
  }

  const runImport = async (rows: ImportRow[]): Promise<string> => {
    // Merge rows by card so multiple condition lines combine.
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
      for (const [cardId, conds] of byCard) next[cardId] = { conds, selCond: prev[cardId]?.selCond ?? 'NM' }
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

  // ── Derived view data ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let list = cards.filter(c => {
      if (ownedOnly && totalQty(coll[c.id]?.conds ?? {}) === 0) return false
      if (q && !c.name.toLowerCase().includes(q) && !c.number.includes(q)) return false
      return true
    })
    const val = (c: Card) => cardValue(coll[c.id]?.conds ?? {}, c) || basePrice(c)
    const qty = (c: Card) => totalQty(coll[c.id]?.conds ?? {})
    list = [...list]
    if (sort === 'number') list.sort((a, b) => numKey(a.number) - numKey(b.number) || a.number.localeCompare(b.number))
    if (sort === 'value') list.sort((a, b) => val(b) - val(a))
    if (sort === 'qty') list.sort((a, b) => qty(b) - qty(a))
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [cards, coll, search, ownedOnly, sort])

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
          <SetSelector sets={sets} selectedId={activeSetId} onSelect={setSetId} />
          <input
            type="text" placeholder="Search cards…" style={{ width: 160 }}
            value={search} onChange={e => setSearch(e.target.value)}
          />
          <div className="header-right">
            <Link to="/shelf" className="tb-btn" style={{ textDecoration: 'none' }}>📒 Binders</Link>
            <Link to="/analyzer" className="tb-btn" style={{ textDecoration: 'none' }}>⚖️ Analyzer</Link>
            <Link to="/convention" className="tb-btn" style={{ textDecoration: 'none' }}>🎪 Convention</Link>
            <button className={'tb-btn' + (ownedOnly ? ' active' : '')} onClick={() => setOwnedOnly(o => !o)}>Owned only</button>
            <button className="tb-btn" onClick={exportCSV}>⬇ Export CSV</button>
            <button className="tb-btn" onClick={() => setImportOpen(true)}>⬆ Import CSV</button>
            <button className="tb-btn primary" onClick={clearSet}>Clear set</button>
            <button className="tb-btn" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>Switch user</button>
          </div>
        </header>

        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Cards owned</div><div className="stat-value">{ownedInSet}<span style={{ color: 'var(--muted)', fontSize: 13 }}> / {set?.total ?? '—'}</span></div></div>
          <div className="stat"><div className="stat-label">Set completion</div><div className="stat-value">{completion}%<div className="progress-wrap"><div className="progress-bar" style={{ width: completion + '%' }} /></div></div></div>
          <div className="stat"><div className="stat-label">Set value</div><div className="stat-value gold">${setValue.toFixed(2)}</div></div>
          <div className="stat"><div className="stat-label">Total collection</div><div className="stat-value gold">${(stats?.totalValue ?? 0).toFixed(2)}</div></div>
          <div className="stat"><div className="stat-label">Sets entered</div><div className="stat-value">{stats?.setsEntered ?? '—'}</div></div>
        </div>

        <div className="toolbar">
          <span className="sort-label">Sort:</span>
          {(['number', 'value', 'qty', 'name'] as SortMode[]).map(m => (
            <button key={m} className={'tb-btn' + (sort === m ? ' active' : '')} onClick={() => setSort(m)}>
              {m === 'number' ? 'Card #' : m === 'value' ? 'Value ↓' : m === 'qty' ? 'Quantity ↓' : 'Name'}
            </button>
          ))}
        </div>

        <div id="app-wrap">
          <div id="main">
            {set && (
              <div className="set-info">
                {set.images?.logo && <img className="set-logo" src={set.images.logo} alt={set.name} />}
                <div>
                  <div className="set-name">{set.name}</div>
                  <div className="set-meta">{set.series} · {set.releaseDate} · {set.total} cards</div>
                </div>
              </div>
            )}

            <div className="quick-entry">
              <label>Quick add</label>
              <input
                ref={quickRef} type="text" placeholder="007" maxLength={10}
                autoComplete="off" spellCheck={false} className={quickFlash}
                value={quick} onChange={e => setQuick(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); quickAdd() } }}
              />
              <select className="cond-select" value={quickCond} onChange={e => setQuickCond(e.target.value)}>
                {['NM', 'LP', 'MP', 'HP', 'DMG'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="first-ed-label">
                <input type="checkbox" checked={firstEd} onChange={e => setFirstEd(e.target.checked)} /> 1st Ed
              </label>
              <span className={'quick-confirm' + (quickMsg ? ' show' : '') + (quickMsg?.err ? ' err' : '')}>
                {quickMsg?.text}
              </span>
              <span className="quick-hint">Type card #, hit <b>Enter</b></span>
            </div>

            {cardsLoading && <div className="loading">Loading</div>}
            {!cardsLoading && filtered.length === 0 && <div className="empty">No cards match.</div>}
            {!cardsLoading && filtered.length > 0 && (
              <div className="card-grid">
                {filtered.map(c => {
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

          <RecentSidebar
            userId={userId} open={sidebarOpen} items={session}
            onClose={() => setSidebarOpen(false)}
            onRemove={uid => setSession(s => s.filter(sc => sc.uid !== uid))}
            onRemoveMany={uids => setSession(s => s.filter(sc => !uids.includes(sc.uid)))}
            onClear={() => setSession([])}
          />
        </div>
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={runImport} />
      {preview.overlay}
    </div>
  )
}
