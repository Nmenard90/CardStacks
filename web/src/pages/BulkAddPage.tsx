/**
 * FILE: BulkAddPage.tsx — high-volume bulk card entry, styled like the landing page.
 *
 * PURPOSE:
 *   Enter thousands of cards fast by collector number alone (no set picking).
 *   Each entered number resolves to a real card and appears in the SAME card
 *   grid the collection page uses — same CardTile, same look — starting from an
 *   empty grid and populating as you type. Built for scale:
 *     - one tile per unique card (counts aggregate onto the tile's conditions),
 *     - source of truth in ref-held Maps (O(1) updates, no giant re-renders),
 *     - each number resolved once and cached,
 *     - everything merged into the collection in a single save at the end.
 *
 * IMPORTS EXPLAINED:
 *   useMemo/useRef/useState — local state + ref-held tile/pending/cache Maps
 *   useQuery                — load all sets once (to disambiguate by set total)
 *   Link                    — back to the collection
 *   getSets/searchCards     — set list + backend all-sets number/name search
 *   getCollection/bulkSave  — read existing collection, then merge-and-save
 *   CardTile                — the exact landing-page card tile
 *   usePreview              — the shared hover-preview overlay
 *   conditions helpers      — condition keys, value math, list <-> map
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: backend GET /api/search (must match collector numbers), POST .../bulk
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, type BulkItem } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  baseCond, cardValue, CONDS, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
import type { Card } from '../types'

/** One card tile in the bulk grid: a card and how many of each condition. */
interface Tile {
  card: Card
  conds: CondMap          // condition key -> quantity
  selCond: string         // which condition the tile's stepper edits
  order: number           // entry order, for newest-first display
}

/** A typed number still being resolved to a card. */
interface Pending {
  raw: string                                   // what was typed, e.g. "119/117"
  adds: Array<{ condKey: string; qty: number }> // accumulated while resolving
}

export function BulkAddPage() {
  const { user } = useUser()
  const toast = useToast()
  const preview = usePreview()
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // Source of truth — ref-held so 10k entries don't churn React state per keystroke.
  const tilesRef = useRef<Map<string, Tile>>(new Map())       // cardId -> tile
  const pendingRef = useRef<Map<string, Pending>>(new Map())  // rawLower -> pending
  const cacheRef = useRef<Map<string, Card | null>>(new Map())// rawLower -> resolved card
  const notFoundRef = useRef<Map<string, number>>(new Map())  // rawLower -> attempts
  const orderRef = useRef(0)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)

  // Entry controls.
  const [num, setNum] = useState('')
  const [total, setTotal] = useState('')
  const [cond, setCond] = useState<(typeof CONDS)[number]>('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  const numRef = useRef<HTMLInputElement>(null)
  const totalRef = useRef<HTMLInputElement>(null)

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  /** PURPOSE: Add a quantity to a card's tile (creating the tile if new). */
  const addToTile = (card: Card, condKey: string, qty: number) => {
    const map = tilesRef.current
    const t = map.get(card.id) ?? { card, conds: {}, selCond: condKey, order: 0 }
    t.conds[condKey] = (t.conds[condKey] ?? 0) + qty
    t.selCond = condKey
    t.order = ++orderRef.current
    map.set(card.id, t)
  }

  /**
   * PURPOSE: Choose the single best card for a typed number from search hits.
   * @param hits Cards returned by the backend search
   * @param n    Collector-number part, lowercased
   * @param t    Optional set-total part used to disambiguate
   */
  const pickMatch = (hits: Card[], n: string, t: string): Card | null => {
    let pool = hits.filter(h => h.number.toLowerCase() === n)
    if (pool.length === 0) pool = hits
    if (t && pool.length > 1) {
      const byTotal = pool.filter(h => {
        const s = sets.find(x => x.id === h.setId)
        return !!s && (String(s.total) === t || String(s.printedTotal) === t)
      })
      if (byTotal.length) pool = byTotal
    }
    return pool[0] ?? null
  }

  /** PURPOSE: Resolve a pending number to a card, then apply its queued adds. */
  const resolve = async (raw: string, key: string) => {
    const [nPart, tPart] = raw.includes('/') ? raw.split('/') : [raw, '']
    let card: Card | null = null
    try {
      const hits = await searchCards(raw)
      card = pickMatch(hits, nPart.trim().toLowerCase(), tPart.trim())
    } catch { card = null }
    cacheRef.current.set(key, card)
    const p = pendingRef.current.get(key)
    pendingRef.current.delete(key)
    if (p) {
      if (card) p.adds.forEach(a => addToTile(card!, a.condKey, a.qty))
      else notFoundRef.current.set(raw, (notFoundRef.current.get(raw) ?? 0) + p.adds.reduce((s, a) => s + a.qty, 0))
    }
    bump()
  }

  /** PURPOSE: Commit the current number/total into the grid (or bump a count). */
  const commit = () => {
    const n = num.trim()
    if (!n) return
    const t = total.trim()
    const raw = t ? `${n}/${t}` : n
    const condKey = firstEd ? `${cond} 1st Ed` : cond
    const key = raw.toLowerCase()

    if (cacheRef.current.has(key)) {
      const card = cacheRef.current.get(key)
      if (card) addToTile(card, condKey, step)
      else notFoundRef.current.set(raw, (notFoundRef.current.get(raw) ?? 0) + step)
    } else {
      const p = pendingRef.current.get(key)
      if (p) {
        const existing = p.adds.find(a => a.condKey === condKey)
        if (existing) existing.qty += step
        else p.adds.push({ condKey, qty: step })
      } else {
        pendingRef.current.set(key, { raw, adds: [{ condKey, qty: step }] })
        void resolve(raw, key)
      }
    }
    setNum(''); setTotal(''); bump(); numRef.current?.focus()
  }

  /** PURPOSE: Edit one tile's conditions; drop the tile if it hits zero total. */
  const editTile = (cardId: string, fn: (t: Tile) => void) => {
    const t = tilesRef.current.get(cardId)
    if (!t) return
    fn(t)
    if (totalQty(t.conds) === 0) tilesRef.current.delete(cardId)
    bump()
  }
  const onAdj = (cardId: string, delta: number) => editTile(cardId, t => {
    const k = t.selCond
    const next = Math.max(0, (t.conds[k] ?? 0) + delta)
    if (next === 0) delete t.conds[k]; else t.conds[k] = next
  })
  const onSetQty = (cardId: string, qty: number) => editTile(cardId, t => {
    if (qty === 0) delete t.conds[t.selCond]; else t.conds[t.selCond] = qty
  })
  const onSelectCond = (cardId: string, c: string) => editTile(cardId, t => { t.selCond = c })
  const onAdjCond = (cardId: string, c: string, delta: number) => editTile(cardId, t => {
    const next = Math.max(0, (t.conds[c] ?? 0) + delta)
    if (next === 0) delete t.conds[c]; else t.conds[c] = next
  })

  /** PURPOSE: Wipe the in-progress session (does not touch the saved collection). */
  const clearAll = () => {
    if (!tilesRef.current.size && !notFoundRef.current.size) return
    if (!confirm('Clear the entire bulk session? Your saved collection is untouched.')) return
    tilesRef.current.clear(); pendingRef.current.clear(); notFoundRef.current.clear(); bump()
  }

  /**
   * PURPOSE: Merge every tile into the existing collection and save once.
   *          bulkSave REPLACES each card it receives, so we read current
   *          conditions first and add the session counts on top — only the
   *          entered cards are sent, leaving the rest of the collection intact.
   */
  const save = async () => {
    const tiles = [...tilesRef.current.values()]
    if (tiles.length === 0) { toast('Nothing to save yet.'); return }
    setSaving(true)
    try {
      const existing = await getCollection(user.id)
      const existingByCard = new Map(existing.map(e => [e.cardId, e]))
      const items: BulkItem[] = tiles.map(t => {
        const prior = existingByCard.get(t.card.id)
        const map: CondMap = prior ? fromCondList(prior.conditions) : {}
        for (const k of Object.keys(t.conds)) map[k] = (map[k] ?? 0) + t.conds[k]
        return {
          cardId: t.card.id,
          conditions: toCondList(map, t.card),
          selectedCond: prior?.selectedCond ?? baseCond(t.selCond),
        }
      })
      await bulkSave(user.id, items)
      const totalCards = tiles.reduce((s, t) => s + totalQty(t.conds), 0)
      toast(`Saved ${totalCards} cards across ${items.length} unique cards.`)
      tilesRef.current.clear(); pendingRef.current.clear(); notFoundRef.current.clear(); bump()
    } catch {
      toast('Save failed — nothing was stored.')
    } finally {
      setSaving(false)
    }
  }

  // Derived view, recomputed on each bump.
  const { tiles, totalCards, totalValue, resolving, notFound } = useMemo(() => {
    const arr = [...tilesRef.current.values()].sort((a, b) => b.order - a.order)
    let cards = 0, val = 0
    for (const t of arr) { cards += totalQty(t.conds); val += cardValue(t.conds, t.card) }
    return {
      tiles: arr, totalCards: cards, totalValue: val,
      resolving: [...pendingRef.current.values()],
      notFound: [...notFoundRef.current.keys()],
    }
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page-tracker">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">⚡ BULK <span>ADD</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <div className="header-right">
            <Link to="/" className="tb-btn" style={{ textDecoration: 'none' }}>← Collection</Link>
            <button className="tb-btn" onClick={clearAll}>Clear session</button>
            <button className="tb-btn primary" onClick={save} disabled={saving || tiles.length === 0}>
              {saving ? 'Saving…' : 'Save to collection'}
            </button>
          </div>
        </header>

        {/* Entry bar */}
        <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={numRef} value={num} autoFocus placeholder="number (e.g. 119)"
            style={{ width: 150 }}
            onChange={e => {
              const v = e.target.value
              if (v.includes('/')) { const [a, b] = v.split('/'); setNum(a); setTotal(b ?? ''); totalRef.current?.focus() }
              else setNum(v)
            }}
            onKeyDown={e => {
              if (e.key === '/') { e.preventDefault(); totalRef.current?.focus() }
              else if (e.key === 'Enter') commit()
            }}
          />
          <span style={{ opacity: 0.5 }}>/</span>
          <input
            ref={totalRef} value={total} placeholder="set total (opt.)" style={{ width: 130 }}
            onChange={e => setTotal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit() }}
          />
          <select value={cond} onChange={e => setCond(e.target.value as (typeof CONDS)[number])}>
            {CONDS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="tb-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={firstEd} onChange={e => setFirstEd(e.target.checked)} /> 1st Ed
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
            ×<input
              type="number" min={1} value={step} style={{ width: 56 }}
              onChange={e => setStep(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
          <button className="tb-btn primary" onClick={commit}>Add</button>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)' }}>
            Type a number, <b>/</b> for the set total, <b>Enter</b> to add.
          </span>
        </div>

        {/* Totals */}
        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Cards entered</div><div className="stat-value">{totalCards}</div></div>
          <div className="stat"><div className="stat-label">Unique cards</div><div className="stat-value">{tiles.length}</div></div>
          <div className="stat"><div className="stat-label">Session value</div><div className="stat-value gold">${totalValue.toFixed(2)}</div></div>
          {resolving.length > 0 && (
            <div className="stat"><div className="stat-label">Resolving</div><div className="stat-value">{resolving.length}</div></div>
          )}
          {notFound.length > 0 && (
            <div className="stat"><div className="stat-label">Not found</div><div className="stat-value" style={{ color: '#fca5a5' }}>{notFound.length}</div></div>
          )}
        </div>

        {notFound.length > 0 && (
          <div className="toolbar" style={{ color: '#fca5a5', fontSize: 13 }}>
            Not found: {notFound.slice(0, 12).join(', ')}{notFound.length > 12 ? ` +${notFound.length - 12} more` : ''}
            <button className="tb-btn" style={{ marginLeft: 'auto' }} onClick={() => { notFoundRef.current.clear(); bump() }}>Dismiss</button>
          </div>
        )}

        <div id="app-wrap">
          <div id="main">
            {tiles.length === 0 && resolving.length === 0 && (
              <div className="empty">Start typing collector numbers above — cards appear here.</div>
            )}
            <div className="card-grid">
              {resolving.map(p => (
                <div key={p.raw} className="pcard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140, opacity: 0.55 }}>
                  resolving #{p.raw}…
                </div>
              ))}
              {tiles.map(t => (
                <CardTile
                  key={t.card.id} card={t.card} conds={t.conds} selCond={t.selCond}
                  onAdj={d => onAdj(t.card.id, d)}
                  onSetQty={q => onSetQty(t.card.id, q)}
                  onSelectCond={c => onSelectCond(t.card.id, c)}
                  onAdjCond={(c, d) => onAdjCond(t.card.id, c, d)}
                  onPreview={src => (src ? preview.show(src) : preview.hide())}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {preview.overlay}
    </div>
  )
}
