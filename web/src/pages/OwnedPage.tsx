/**
 * FILE: OwnedPage.tsx
 * LOCATION: src/pages/OwnedPage.tsx
 *
 * PURPOSE:
 *   Shows every card the user owns across all sets in one unified view.
 *   Cards are loaded from GET /api/collection/:userId/owned which JOIN-fetches
 *   card details server-side so there are no per-card requests.
 *   Supports local search (name/number/set), sort (name/qty/value/set), and
 *   the same +/− quantity adjustments as CollectionPage.
 *
 * USED BY: App.tsx (route "/owned")
 * DEPENDS ON: GET /api/collection/:userId/owned, POST /api/collection/:userId/:cardId
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getOwnedCards, saveEntry } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { basePrice, cardValue, fromCondList, toCondList, totalQty, type CondMap } from '../lib/conditions'
import type { Card, OwnedCard } from '../types'

interface Entry { conds: CondMap; selCond: string }
type SortMode = 'name' | 'qty' | 'value' | 'set'

export function OwnedPage() {
  const { user, setUser } = useUser()
  const toast = useToast()
  const preview = usePreview()

  const [cards, setCards] = useState<Card[]>([])
  const [coll, setColl] = useState<Record<string, Entry>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('name')

  const userId = user?.id ?? ''

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    getOwnedCards(userId)
      .then((owned: OwnedCard[]) => {
        setCards(owned.map(o => o.card))
        const m: Record<string, Entry> = {}
        for (const o of owned) {
          m[o.cardId] = { conds: fromCondList(o.conditions), selCond: o.selectedCond || 'NM' }
        }
        setColl(m)
      })
      .catch(() => toast('Could not load your collection.'))
      .finally(() => setLoading(false))
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (card: Card, entry: Entry) => {
    saveEntry(userId, card.id, toCondList(entry.conds, card), entry.selCond)
      .catch(() => toast('Save failed — change not stored.'))
  }

  const mutate = (card: Card, fn: (e: Entry) => Entry) => {
    setColl(prev => {
      const cur = prev[card.id] ?? { conds: {}, selCond: 'NM' }
      const next = fn({ conds: { ...cur.conds }, selCond: cur.selCond })
      persist(card, next)
      // Remove from the local card list if all quantities drop to zero
      if (totalQty(next.conds) === 0) {
        setCards(cs => cs.filter(c => c.id !== card.id))
      }
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

  const totalCards = useMemo(() =>
    Object.values(coll).reduce((sum, e) => sum + totalQty(e.conds), 0),
  [coll])

  const totalValue = useMemo(() =>
    cards.reduce((sum, c) => sum + cardValue(coll[c.id]?.conds ?? {}, c), 0),
  [cards, coll])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q
      ? cards.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.number.toLowerCase().includes(q) ||
          c.setId.toLowerCase().includes(q)
        )
      : [...cards]

    if (sort === 'name')  list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'qty')   list.sort((a, b) => totalQty(coll[b.id]?.conds ?? {}) - totalQty(coll[a.id]?.conds ?? {}))
    if (sort === 'value') list.sort((a, b) => cardValue(coll[b.id]?.conds ?? {}, b) - cardValue(coll[a.id]?.conds ?? {}, a) || basePrice(b) - basePrice(a))
    if (sort === 'set')   list.sort((a, b) => a.setId.localeCompare(b.setId) || parseInt(a.number) - parseInt(b.number))
    return list
  }, [cards, coll, search, sort])

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  return (
    <div className="page-tracker">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">MY <span>COLLECTION</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <input
            type="text"
            placeholder="Search by name, number, or set…"
            style={{ width: 260 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="header-right">
            <Link to="/" className="tb-btn" style={{ textDecoration: 'none' }}>🗂 Set Browser</Link>
            <Link to="/bulk" className="tb-btn" style={{ textDecoration: 'none' }}>⚡ Bulk Add</Link>
            <Link to="/shelf" className="tb-btn" style={{ textDecoration: 'none' }}>📒 Binders</Link>
            <button className="tb-btn" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>
              Switch user
            </button>
          </div>
        </header>

        <div className="stats-bar">
          <div className="stat">
            <div className="stat-label">Unique cards</div>
            <div className="stat-value">{cards.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total copies</div>
            <div className="stat-value">{totalCards}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total value</div>
            <div className="stat-value gold">${totalValue.toFixed(2)}</div>
          </div>
          {search && (
            <div className="stat">
              <div className="stat-label">Showing</div>
              <div className="stat-value">{displayed.length} of {cards.length}</div>
            </div>
          )}
        </div>

        <div className="toolbar">
          <span className="sort-label">Sort:</span>
          {(['name', 'qty', 'value', 'set'] as SortMode[]).map(m => (
            <button key={m} className={'tb-btn' + (sort === m ? ' active' : '')} onClick={() => setSort(m)}>
              {m === 'name' ? 'Name' : m === 'qty' ? 'Qty ↓' : m === 'value' ? 'Value ↓' : 'Set'}
            </button>
          ))}
        </div>

        <div id="app-wrap">
          <div id="main">
            {loading && <div className="loading">Loading your collection…</div>}
            {!loading && cards.length === 0 && (
              <div className="empty">You don't own any cards yet. Use <Link to="/bulk">Bulk Add</Link> to get started.</div>
            )}
            {!loading && cards.length > 0 && displayed.length === 0 && (
              <div className="empty">No cards match "{search}".</div>
            )}
            {!loading && displayed.length > 0 && (
              <div className="card-grid">
                {displayed.map(c => {
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
      {preview.overlay}
    </div>
  )
}
