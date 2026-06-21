/**
 * FILE: BulkAddPage.tsx — high-volume bulk card entry, search-driven.
 *
 * PURPOSE:
 *   Add cards fast WITHOUT knowing the set. One search bar matches by name OR
 *   any part of a collector number; matching cards appear live as you type.
 *   Click a result (or press Enter to take the top hit) and it drops into the
 *   SAME card grid the collection page uses — same CardTile, same look. Counts
 *   aggregate onto one tile per card; everything saves in a single merged
 *   request at the end.
 *
 * IMPORTS EXPLAINED:
 *   useEffect/useMemo/useRef/useState — debounced search + ref-held tile Map
 *   useQuery                — load all sets once (to label results by set)
 *   Link                    — back to the collection
 *   getSets/searchCards     — set list + backend all-sets number/name search
 *   getCollection/bulkSave  — read existing collection, then merge-and-save
 *   CardTile / usePreview   — the exact landing-page tile + hover overlay
 *   conditions helpers      — condition keys, value math, list <-> map
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: backend GET /api/search (matches names AND collector numbers)
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, type BulkItem } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  baseCond, cardValue, condPrice, CONDS, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
import type { Card } from '../types'

/** One card tile in the bulk grid: a card and how many of each condition. */
interface Tile {
  card: Card
  conds: CondMap
  selCond: string
  order: number
}

/** Local stylesheet so the search panel is clean and self-contained. */
const STYLE = `
.bulk-page .bulk-search-wrap{position:relative;flex:1;min-width:240px}
.bulk-page .bulk-search{width:100%;font-size:15px;padding:11px 14px}
.bulk-page .bulk-results{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;
  max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:14px;
  background:#11131c;box-shadow:0 18px 40px rgba(0,0,0,.45)}
.bulk-page .brow{width:100%;border:0;border-bottom:1px solid var(--border);background:transparent;
  color:var(--text);padding:9px 12px;display:flex;align-items:center;gap:11px;text-align:left;cursor:pointer}
.bulk-page .brow:last-child{border-bottom:0}
.bulk-page .brow:hover,.bulk-page .brow.hi{background:rgba(255,255,255,.07)}
.bulk-page .brow img{width:38px;height:52px;object-fit:cover;border-radius:5px;background:#0008}
.bulk-page .brow .bi{flex:1;min-width:0}
.bulk-page .brow .bi b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bulk-page .brow .bi small{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.bulk-page .brow .bp{color:var(--green);font-weight:700;font-size:13px}
.bulk-page .brow .bhave{color:var(--accent);font-size:11px;font-weight:800;margin-left:6px}
.bulk-page .bulk-hint{color:var(--muted);font-size:13px;padding:10px 12px}
`

export function BulkAddPage() {
  const { user } = useUser()
  const toast = useToast()
  const preview = usePreview()
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  // Tiles are the source of truth; ref-held so big sessions don't churn state.
  const tilesRef = useRef<Map<string, Tile>>(new Map())
  const orderRef = useRef(0)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)

  // Search.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searching, setSearching] = useState(false)
  const [hi, setHi] = useState(0)            // keyboard-highlighted result index
  const timer = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Add controls.
  const [cond, setCond] = useState<(typeof CONDS)[number]>('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [lastAdded, setLastAdded] = useState('')

  // Debounced live search by name or number.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    setHi(0)
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    timer.current = window.setTimeout(async () => {
      try { const hits = await searchCards(q); setResults(hits.slice(0, 40)) }
      catch { setResults([]) }
      finally { setSearching(false) }
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  if (!user) return <div className="page-tracker bulk-page"><LoginScreen /></div>

  /** PURPOSE: Add `step` copies of a card in the chosen condition to its tile. */
  const addCard = (card: Card) => {
    const condKey = firstEd ? `${cond} 1st Ed` : cond
    const map = tilesRef.current
    const t = map.get(card.id) ?? { card, conds: {}, selCond: condKey, order: 0 }
    t.conds[condKey] = (t.conds[condKey] ?? 0) + step
    t.selCond = condKey
    t.order = ++orderRef.current
    map.set(card.id, t)
    setLastAdded(`+${step} ${card.name} (${condKey})`)
    bump()
  }

  /** PURPOSE: Enter takes the highlighted/top result; force a search if needed. */
  const onEnter = async () => {
    const q = query.trim()
    if (!q) return
    if (results.length) { addCard(results[hi] ?? results[0]); setQuery(''); setResults([]); searchRef.current?.focus(); return }
    try {
      const hits = await searchCards(q)
      if (hits.length) { addCard(hits[0]); setQuery(''); setResults([]) }
      else toast(`No match for "${q}"`)
    } catch { toast('Search failed — check the backend.') }
    searchRef.current?.focus()
  }

  /** PURPOSE: Edit one tile's conditions; drop the tile if it hits zero. */
  const editTile = (cardId: string, fn: (t: Tile) => void) => {
    const t = tilesRef.current.get(cardId)
    if (!t) return
    fn(t)
    if (totalQty(t.conds) === 0) tilesRef.current.delete(cardId)
    bump()
  }
  const onAdj = (cardId: string, d: number) => editTile(cardId, t => {
    const k = t.selCond; const n = Math.max(0, (t.conds[k] ?? 0) + d)
    if (n === 0) delete t.conds[k]; else t.conds[k] = n
  })
  const onSetQty = (cardId: string, q: number) => editTile(cardId, t => {
    if (q === 0) delete t.conds[t.selCond]; else t.conds[t.selCond] = q
  })
  const onSelectCond = (cardId: string, c: string) => editTile(cardId, t => { t.selCond = c })
  const onAdjCond = (cardId: string, c: string, d: number) => editTile(cardId, t => {
    const n = Math.max(0, (t.conds[c] ?? 0) + d)
    if (n === 0) delete t.conds[c]; else t.conds[c] = n
  })

  /** PURPOSE: Wipe the in-progress session (saved collection untouched). */
  const clearAll = () => {
    if (!tilesRef.current.size) return
    if (!confirm('Clear the bulk session? Your saved collection is untouched.')) return
    tilesRef.current.clear(); setLastAdded(''); bump()
  }

  /** PURPOSE: Merge every tile onto the existing collection and save once. */
  const save = async () => {
    const tiles = [...tilesRef.current.values()]
    if (tiles.length === 0) { toast('Nothing to save yet.'); return }
    setSaving(true)
    try {
      const existing = await getCollection(user.id)
      const byCard = new Map(existing.map(e => [e.cardId, e]))
      const items: BulkItem[] = tiles.map(t => {
        const prior = byCard.get(t.card.id)
        const map: CondMap = prior ? fromCondList(prior.conditions) : {}
        for (const k of Object.keys(t.conds)) map[k] = (map[k] ?? 0) + t.conds[k]
        return { cardId: t.card.id, conditions: toCondList(map, t.card), selectedCond: prior?.selectedCond ?? baseCond(t.selCond) }
      })
      await bulkSave(user.id, items)
      const n = tiles.reduce((s, t) => s + totalQty(t.conds), 0)
      toast(`Saved ${n} cards across ${items.length} unique cards.`)
      tilesRef.current.clear(); setLastAdded(''); bump()
    } catch {
      toast('Save failed — nothing was stored.')
    } finally {
      setSaving(false)
    }
  }

  const { tiles, totalCards, totalValue } = useMemo(() => {
    const arr = [...tilesRef.current.values()].sort((a, b) => b.order - a.order)
    let cards = 0, val = 0
    for (const t of arr) { cards += totalQty(t.conds); val += cardValue(t.conds, t.card) }
    return { tiles: arr, totalCards: cards, totalValue: val }
  }, [version])

  return (
    <div className="page-tracker bulk-page">
      <style>{STYLE}</style>
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">⚡ BULK <span>ADD</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <div className="header-right">
            <Link to="/" className="tb-btn" style={{ textDecoration: 'none' }}>← Collection</Link>
            <button className="tb-btn" onClick={clearAll}>Clear</button>
            <button className="tb-btn primary" onClick={save} disabled={saving || tiles.length === 0}>
              {saving ? 'Saving…' : `Save${tiles.length ? ` (${totalCards})` : ''}`}
            </button>
          </div>
        </header>

        {/* Search + add controls */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="bulk-search-wrap">
            <input
              ref={searchRef} className="bulk-search" autoFocus value={query}
              placeholder="Search by name or number — e.g. Charizard, 119/117, SWSH158"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onEnter() }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, results.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
                else if (e.key === 'Escape') { setQuery(''); setResults([]) }
              }}
            />
            {query.trim().length >= 2 && (
              <div className="bulk-results">
                {searching && results.length === 0 && <div className="bulk-hint">Searching…</div>}
                {!searching && results.length === 0 && <div className="bulk-hint">No matches.</div>}
                {results.map((card, i) => {
                  const have = totalQty(tilesRef.current.get(card.id)?.conds ?? {})
                  return (
                    <button
                      key={card.id} className={'brow' + (i === hi ? ' hi' : '')}
                      onMouseEnter={() => setHi(i)}
                      onClick={() => addCard(card)}
                    >
                      {card.images?.small
                        ? <img src={card.images.small} alt={card.name} loading="lazy" />
                        : <span style={{ width: 38 }} />}
                      <span className="bi">
                        <b>{card.name}{have > 0 && <span className="bhave">×{have} in session</span>}</b>
                        <small>#{card.number} · {setName.get(card.setId) ?? card.setId}</small>
                      </span>
                      <span className="bp">{condPrice(card, 'NM') > 0 ? '$' + condPrice(card, 'NM').toFixed(2) : '—'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <select value={cond} onChange={e => setCond(e.target.value as (typeof CONDS)[number])}>
            {CONDS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="tb-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={firstEd} onChange={e => setFirstEd(e.target.checked)} /> 1st Ed
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
            ×<input type="number" min={1} value={step} style={{ width: 54 }}
              onChange={e => setStep(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </label>
        </div>

        {/* Totals */}
        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Cards entered</div><div className="stat-value">{totalCards}</div></div>
          <div className="stat"><div className="stat-label">Unique cards</div><div className="stat-value">{tiles.length}</div></div>
          <div className="stat"><div className="stat-label">Session value</div><div className="stat-value gold">${totalValue.toFixed(2)}</div></div>
          {lastAdded && <div className="stat"><div className="stat-label">Last added</div><div className="stat-value" style={{ fontSize: 14, color: 'var(--green)' }}>{lastAdded}</div></div>}
        </div>

        <div id="app-wrap">
          <div id="main">
            {tiles.length === 0 && (
              <div className="empty">Search a card above and click it (or press Enter) to start adding.</div>
            )}
            {tiles.length > 0 && (
              <div className="card-grid">
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
            )}
          </div>
        </div>
      </div>
      {preview.overlay}
    </div>
  )
}
