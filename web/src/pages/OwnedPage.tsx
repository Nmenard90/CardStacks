/**
 * OwnedPage — every card the user owns, across all sets, in one place.
 *
 * HOW IT WORKS
 *   Cards are loaded from GET /api/collection/:userId/owned, which fetches
 *   card details on the backend so there are no per-card requests.
 *   Supports local search (name/number/set) and sort (name/qty/value/set),
 *   plus the same +/- quantity adjustments as CollectionPage. Browsing by
 *   physical storage location lives on ShelfPage now, not here.
 *
 * USED BY: App.tsx (route "/owned")
 * DEPENDS ON: api/collection
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getOwnedCards, saveEntry } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { Mascot } from '../components/Mascot'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { HeaderNav } from '../components/HeaderNav'
import { basePrice, cardValue, fromCondList, fromPurchaseList, toCondList, totalQty, type CondMap, type PurchaseMap } from '../lib/conditions'
import type { Card, OwnedCard } from '../types'

/** Local per-card editing state: the condition/quantity map, plus which condition tab is active. */
interface Entry { conds: CondMap; selCond: string }
type SortMode = 'name' | 'qty' | 'value' | 'set'

export function OwnedPage() {
  const { user } = useUser()
  const toast = useToast()
  const preview = usePreview()
  const qc = useQueryClient()

  const [cards, setCards] = useState<Card[]>([])

  // Lookup tables keyed by card ID, for hundreds of cards' worth of local state.
  const [coll, setColl] = useState<Record<string, Entry>>({})
  const [purchases, setPurchases] = useState<Record<string, PurchaseMap>>({})

  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('name')

  const userId = user?.id ?? ''

  // Reads through the same ['owned', userId] cache entry AnalyzerPage and
  // BinderViewPage use, so this page can't show a different price snapshot
  // for a card than they do.
  const { data: owned, isError: ownedError } = useQuery({
    queryKey: ['owned', userId],
    queryFn: () => getOwnedCards(userId),
    enabled: !!userId,
  })

  // Local state (cards/coll/purchases) still drives the page, so the
  // existing optimistic +/- and delete-on-zero-qty logic below is
  // untouched — this re-syncs it whenever the shared query's data changes
  // (including a refresh triggered from another page). Done as a
  // render-time comparison, not an effect, to avoid re-triggering the
  // set-state-in-effect issue already fixed elsewhere in this codebase.
  const [syncedOwned, setSyncedOwned] = useState<OwnedCard[] | undefined>(undefined)
  if (owned && owned !== syncedOwned) {
    setSyncedOwned(owned)
    setCards(owned.map(o => o.card))

    const m: Record<string, Entry> = {}
    const p: Record<string, PurchaseMap> = {}
    for (const o of owned) {
      m[o.cardId] = { conds: fromCondList(o.conditions), selCond: o.selectedCond || 'NM' }
      p[o.cardId] = fromPurchaseList(o.conditions)
    }
    setColl(m)
    setPurchases(p)
    setLoading(false)
  }

  // Same render-time-comparison treatment as the sync block above. Keyed by
  // userId (not a plain boolean) so switching accounts after a failed fetch
  // can still show a fresh error for the new account instead of staying
  // silently suppressed.
  const [erroredOwned, setErroredOwned] = useState<string | null>(null)
  if (ownedError && erroredOwned !== userId) {
    setErroredOwned(userId)
    toast('Could not load your collection.')
    setLoading(false)
  }

  /** Writes a local edit into the shared ['owned', userId] cache entry too
   *  (the same key AnalyzerPage/BinderViewPage read), so a sibling page's
   *  refetch landing between this edit and its saveEntry persistence can't
   *  push a stale snapshot back over it the next time this page re-syncs
   *  from that cache. */
  const syncCache = (card: Card, entry: Entry, purchaseMap: PurchaseMap) => {
    qc.setQueryData<OwnedCard[]>(['owned', userId], prev => {
      if (!prev) return prev
      if (totalQty(entry.conds) === 0) return prev.filter(o => o.cardId !== card.id)
      const conditions = toCondList(entry.conds, card, purchaseMap)
      const existing = prev.find(o => o.cardId === card.id)
      const updated: OwnedCard = existing
        ? { ...existing, conditions, selectedCond: entry.selCond }
        : { cardId: card.id, conditions, selectedCond: entry.selCond, updatedAt: new Date().toISOString(), card }
      return existing ? prev.map(o => (o.cardId === card.id ? updated : o)) : [...prev, updated]
    })
  }

  const persist = (card: Card, entry: Entry) => {
    saveEntry(userId, card.id, toCondList(entry.conds, card, purchases[card.id]), entry.selCond)
      .catch(() => toast('Save failed — change not stored.'))
  }

  /** Logs (or updates) what the user says they paid for one condition of a card. */
  const setPurchase = (card: Card, cond: string, price: number) => {
    setPurchases(prev => {
      const next = { ...prev, [card.id]: { ...prev[card.id], [cond]: { price, purchasedAt: new Date().toISOString() } } }
      const entry = coll[card.id] ?? { conds: {}, selCond: 'NM' }
      saveEntry(userId, card.id, toCondList(entry.conds, card, next[card.id]), entry.selCond)
        .catch(() => toast('Save failed — purchase price not stored.'))
      syncCache(card, entry, next[card.id])
      return next
    })
  }

  /** Changes one card's entry, saves it, and drops the card from the list if it's now fully removed. */
  const mutate = (card: Card, fn: (e: Entry) => Entry) => {
    setColl(prev => {
      const cur = prev[card.id] ?? { conds: {}, selCond: 'NM' }
      const next = fn({ conds: { ...cur.conds }, selCond: cur.selCond })
      persist(card, next)
      syncCache(card, next, purchases[card.id])

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

  // Only switches which condition tab is active — nothing owned changes,
  // so this doesn't go through mutate/persist.
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

  // The final list shown on screen, after search and sorting.
  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? cards.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.number.toLowerCase().includes(q) ||
          c.setId.toLowerCase().includes(q)
        )
      : [...cards]

    if (sort === 'name')  list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'qty')   list.sort((a, b) => totalQty(coll[b.id]?.conds ?? {}) - totalQty(coll[a.id]?.conds ?? {}))
    // Ties broken by base NM price.
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
            className="header-search"
            placeholder="Search by name, number, or set…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <HeaderNav />
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
              <div className="empty">
                <Mascot size={80} mood="sleepy" caption={<>You don't own any cards yet. Use <Link to="/bulk">Bulk Add</Link> to get started.</>} />
              </div>
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
                      onPreview={(src, opts) => (src ? preview.show(src, opts) : preview.hide())}
                      purchases={purchases[c.id]}
                      onSetPurchase={(cond, price) => setPurchase(c, cond, price)}
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
