/**
 * FILE: BulkAddPage.tsx — high-volume bulk card entry, the main card-add hub.
 *
 * PURPOSE:
 *   The primary place to add cards to your collection and binders.
 *   Two entry modes:
 *     1. Name / number SEARCH — type any part of a name or number, pick from
 *        the live dropdown, and the card lands in the session grid below.
 *     2. QUICK ADD — type a collector number and press Enter for even faster
 *        entry when you're sorting a physical pile of known cards.
 *   The Recently Added sidebar (moved here from CollectionPage) shows every
 *   card added this session and lets you place them into binders immediately,
 *   before or after saving to the collection.
 *   "Save" merges the entire session into the existing collection in one request.
 *
 * IMPORTS EXPLAINED:
 *   useEffect/useMemo/useRef/useState — debounced search, ref-held tile Map,
 *                                       quick-add flash, sidebar session list
 *   useQuery                — load all sets once (to label search results by set name)
 *   Link                    — back to the collection
 *   getSets/searchCards     — set list + backend all-sets name/number search
 *                             (backend falls back to pokemontcg.io API if DB is empty)
 *   getCollection/bulkSave  — read existing collection before merging, then save
 *   CardTile / usePreview   — shared card tile component + hover-preview overlay
 *   RecentSidebar           — the "recently added" panel for binder placement
 *   LoginScreen             — shown when no user is logged in
 *   useToast                — bottom-right toast for success / error messages
 *   useUser                 — the currently logged-in user from context
 *   conditions helpers      — condition keys, price math, list <-> map conversions
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: backend GET /api/search, GET /api/sets, POST /api/collection/:userId/bulk
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSets, searchCards } from '../api/cards'
import { buildSetTotals, narrowByCollectorNumber } from '../lib/cardSearch'
import { bulkSave, getCollection, type BulkItem } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { HeaderNav } from '../components/HeaderNav'
import { RecentSidebar, type SessionCard } from '../components/RecentSidebar'
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

/**
 * VALUE: STYLE
 * PURPOSE: Scoped CSS for the search dropdown and quick-add flash.
 *   All selectors are prefixed with .bulk-page so they cannot leak into
 *   other pages even though this <style> block is injected into the DOM.
 */
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
  // setId -> totals lookup, used to resolve "117/123" to the one card meant.
  const setTotal = useMemo(() => buildSetTotals(sets), [sets])

  // ── Tile map: source of truth for session counts ─────────────────────────────
  // Ref-held so large sessions don't cause unnecessary re-renders on every keystroke.
  // `version` is bumped whenever the map changes to trigger memoized tile array recalc.
  const tilesRef = useRef<Map<string, Tile>>(new Map())
  const orderRef = useRef(0)
  const [version, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)

  // ── Name/number search ───────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searching, setSearching] = useState(false)
  // Distinct from "no results" — true when the API call itself errors.
  const [searchErr, setSearchErr] = useState(false)
  // Keyboard-highlighted index in the results dropdown.
  const [hi, setHi] = useState(0)
  const timer = useRef<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Add controls (shared by both search and quick-add) ───────────────────────
  const [cond, setCond] = useState<(typeof CONDS)[number]>('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [step, setStep] = useState(1)

  // ── Quick add by collector number ────────────────────────────────────────────
  const [quickNum, setQuickNum] = useState('')
  const [quickFlash, setQuickFlash] = useState<'' | 'flash-ok' | 'flash-err'>('')
  const [quickMsg, setQuickMsg] = useState<{ text: string; err: boolean } | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)

  // ── Sidebar: recently added this session ─────────────────────────────────────
  const [session, setSession] = useState<SessionCard[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // ── Save state ───────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [lastAdded, setLastAdded] = useState('')

  /**
   * PURPOSE: Debounced live search as the user types in the name/number box.
   *   Fires 250 ms after the last keystroke to avoid hammering the backend.
   *   Uses the `searchErr` flag to distinguish a real API failure from "no cards".
   */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    setHi(0)
    if (q.length < 2) { setResults([]); setSearching(false); setSearchErr(false); return }
    setSearching(true)
    setSearchErr(false)
    timer.current = window.setTimeout(async () => {
      try {
        const hits = await searchCards(q)
        // Narrow "117/123" to the right set; plain queries pass through unchanged.
        setResults(narrowByCollectorNumber(hits, q, setTotal).slice(0, 40))
        setSearchErr(false)
      } catch {
        setResults([])
        setSearchErr(true)
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query, setTotal])

  if (!user) return <div className="page-tracker bulk-page"><LoginScreen /></div>

  /**
   * PURPOSE: Add `step` copies of `card` in the current condition to the tile grid
   *   AND push one entry to the Recently Added sidebar so the card is available
   *   for binder placement without waiting for the session to be saved first.
   * @param card  The card to add
   */
  const addCard = (card: Card) => {
    const condKey = firstEd ? `${cond} 1st Ed` : cond
    const map = tilesRef.current
    const t = map.get(card.id) ?? { card, conds: {}, selCond: condKey, order: 0 }
    t.conds[condKey] = (t.conds[condKey] ?? 0) + step
    t.selCond = condKey
    t.order = ++orderRef.current
    map.set(card.id, t)
    setLastAdded(`+${step} ${card.name} (${condKey})`)
    // Push to sidebar session so it's immediately available for binder placement.
    setSession(s => [{ uid: crypto.randomUUID(), card, condKey, price: condPrice(card, condKey) }, ...s])
    setSidebarOpen(true)
    bump()
  }

  /**
   * PURPOSE: Quick-add by collector number — search backend for the exact number,
   *   prefer an exact match, and add to tiles. Faster than the name search for
   *   known numbers because there is no dropdown to click through.
   */
  const quickAdd = async () => {
    const raw = quickNum.trim()
    if (!raw) return
    try {
      const hits = await searchCards(raw)
      const card =
        hits.find(h => h.number.toLowerCase() === raw.toLowerCase()) ??
        hits.find(h => h.number.toLowerCase().startsWith(raw.toLowerCase())) ??
        hits[0] ??
        null
      if (!card) {
        setQuickFlash('flash-err')
        setQuickMsg({ text: `not found: ${raw}`, err: true })
        setTimeout(() => setQuickFlash(''), 600)
        setQuickNum('')
        return
      }
      addCard(card)
      setQuickFlash('flash-ok')
      const p = condPrice(card, firstEd ? `${cond} 1st Ed` : cond)
      setQuickMsg({ text: `✓ #${card.number} ${card.name}${p > 0 ? ' · $' + p.toFixed(2) : ''}`, err: false })
      setTimeout(() => setQuickFlash(''), 400)
      setQuickNum('')
    } catch {
      toast('Quick add failed — check the backend.')
    }
    quickRef.current?.focus()
  }

  /**
   * PURPOSE: When Enter is pressed in the name/number search box, take the
   *   keyboard-highlighted result (or the top result) and add it immediately.
   *   If no results are loaded yet, fires a fresh search and takes the top hit.
   */
  const onEnter = async () => {
    const q = query.trim()
    if (!q) return
    if (results.length) {
      addCard(results[hi] ?? results[0])
      setQuery('')
      setResults([])
      searchRef.current?.focus()
      return
    }
    try {
      const hits = await searchCards(q)
      if (hits.length) { addCard(hits[0]); setQuery(''); setResults([]) }
      else toast(`No match for "${q}"`)
    } catch { toast('Search failed — check the backend.') }
    searchRef.current?.focus()
  }

  /**
   * PURPOSE: Mutate one tile's condition counts.
   *   Deletes the tile entirely when every condition reaches zero so stale
   *   tiles don't linger in the grid after decrementing to nothing.
   * @param cardId  Which card's tile to update
   * @param fn      Mutation applied to the tile in place
   */
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

  /**
   * PURPOSE: Clear the in-progress bulk session (tile map + sidebar + last-added label).
   *   Does NOT touch the saved collection — only the unsaved session state.
   */
  const clearAll = () => {
    if (!tilesRef.current.size) return
    if (!confirm('Clear the bulk session? Your saved collection is untouched.')) return
    tilesRef.current.clear()
    setSession([])
    setLastAdded('')
    bump()
  }

  /**
   * PURPOSE: Merge the session tiles into the existing collection and POST once.
   *   Reads the current collection first so quantities are additive, not replacing.
   *   On success clears the session; on failure leaves everything intact so nothing is lost.
   */
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
        return {
          cardId: t.card.id,
          conditions: toCondList(map, t.card),
          selectedCond: prior?.selectedCond ?? baseCond(t.selCond),
        }
      })
      await bulkSave(user.id, items)
      const n = tiles.reduce((s, t) => s + totalQty(t.conds), 0)
      toast(`Saved ${n} cards across ${items.length} unique cards.`)
      tilesRef.current.clear()
      setSession([])
      setLastAdded('')
      bump()
    } catch {
      toast('Save failed — nothing was stored.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * PURPOSE: Derive the sorted tile array and session totals from the tile map.
   *   Recalculates whenever `version` is bumped (i.e., whenever a tile changes).
   *   Newest additions first so the last-added card appears at the top of the grid.
   */
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
            <button className="tb-btn" onClick={() => setSidebarOpen(o => !o)}>
              🗂 Binder{session.length > 0 && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>{session.length}</span>}
            </button>
            <button className="tb-btn" onClick={clearAll}>Clear</button>
            <button className="tb-btn primary" onClick={save} disabled={saving || tiles.length === 0}>
              {saving ? 'Saving…' : `Save${tiles.length ? ` (${totalCards})` : ''}`}
            </button>
            <HeaderNav />
          </div>
        </header>

        {/* ── Shared condition / step controls ───────────────────────────────── */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sort-label">Condition:</span>
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

        {/* ── Name / number search ────────────────────────────────────────────── */}
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
                {!searching && searchErr && (
                  <div className="bulk-hint" style={{ color: 'var(--red, #e55)' }}>
                    Search failed — check the backend.
                  </div>
                )}
                {!searching && !searchErr && results.length === 0 && (
                  <div className="bulk-hint">No matches.</div>
                )}
                {results.map((card, i) => {
                  const have = totalQty(tilesRef.current.get(card.id)?.conds ?? {})
                  return (
                    <button
                      key={card.id} className={'brow' + (i === hi ? ' hi' : '')}
                      onMouseEnter={() => setHi(i)}
                      onClick={() => { addCard(card); setQuery(''); setResults([]) }}
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
        </div>

        {/* ── Quick add by collector number ───────────────────────────────────── */}
        <div className="quick-entry">
          <label>Quick add #</label>
          <input
            ref={quickRef} type="text" placeholder="007" maxLength={12}
            autoComplete="off" spellCheck={false} className={quickFlash}
            value={quickNum} onChange={e => setQuickNum(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); quickAdd() } }}
          />
          <span className={'quick-confirm' + (quickMsg ? ' show' : '') + (quickMsg?.err ? ' err' : '')}>
            {quickMsg?.text}
          </span>
          <span className="quick-hint">Type card #, hit <b>Enter</b></span>
        </div>

        {/* ── Stats bar ───────────────────────────────────────────────────────── */}
        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Cards entered</div><div className="stat-value">{totalCards}</div></div>
          <div className="stat"><div className="stat-label">Unique cards</div><div className="stat-value">{tiles.length}</div></div>
          <div className="stat"><div className="stat-label">Session value</div><div className="stat-value gold">${totalValue.toFixed(2)}</div></div>
          {lastAdded && (
            <div className="stat">
              <div className="stat-label">Last added</div>
              <div className="stat-value" style={{ fontSize: 14, color: 'var(--green)' }}>{lastAdded}</div>
            </div>
          )}
        </div>

        {/* ── Card grid + binder sidebar ──────────────────────────────────────── */}
        <div id="app-wrap">
          <div id="main">
            {tiles.length === 0 && (
              <div className="empty">Search a card above or quick-add by number to start.</div>
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

          <RecentSidebar
            userId={user.id}
            open={sidebarOpen}
            items={session}
            onClose={() => setSidebarOpen(false)}
            onRemove={uid => setSession(s => s.filter(sc => sc.uid !== uid))}
            onRemoveMany={uids => setSession(s => s.filter(sc => !uids.includes(sc.uid)))}
            onClear={() => setSession([])}
          />
        </div>
      </div>
      {preview.overlay}
    </div>
  )
}
