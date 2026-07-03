/**
 * FILE: BulkAddPage.tsx — high-volume bulk card entry.
 *
 * PURPOSE:
 *   The fast place to enter a physical pile of cards into your collection.
 *   Rewritten to fix the old page's data-loss and stale-count bugs:
 *     - Session state lives in a useReducer (one immutable source of truth),
 *       not a mutable ref with a manual re-render counter. The on-screen count
 *       and the Save button are therefore always correct.
 *     - The session is mirrored to localStorage on every change and restored on
 *       load, so navigating away — or a refresh — never loses entered cards.
 *     - A set can be selected, which makes "add by number" an instant local
 *       lookup in that set (no flaky backend number search).
 *   Three ways to add a card:
 *     1. SET + NUMBER  — pick a set, type the collector number, Enter.
 *     2. NUMBER / TOTAL — two boxes ("188" / "236") for a global number lookup
 *        when no set is selected; promos like "SWSH158" go in the left box.
 *     3. NAME SEARCH   — type a name, pick from the dropdown.
 *   "Save" merges the whole session into the existing collection in one request.
 *
 * IMPORTS EXPLAINED:
 *   useReducer/useState/useMemo/useEffect/useRef — session state, search, persistence
 *   useQuery               — load the set list, and the selected set's cards
 *   getCards/getSets/searchCards — set cards, set list, backend name/number search
 *   getCollection/bulkSave — read existing collection, then merge-save the session
 *   CardTile / usePreview  — shared tile component + hover preview overlay
 *   SetSelector / ALL_SETS — the set picker (shared with CollectionPage)
 *   LoginScreen / HeaderNav / useToast / useUser — shell + auth + feedback
 *   conditions helpers     — condition keys, price math, list <-> map conversions
 *   cardSearch helpers     — set totals + collector-number narrowing for name search
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: GET /api/sets, GET /api/cards/:setId, GET /api/search,
 *             GET /api/collection/:userId, POST /api/collection/:userId/bulk
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { getCards, getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, type BulkItem } from '../api/collection'
import { buildSetTotals, narrowByCollectorNumber } from '../lib/cardSearch'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { HeaderNav } from '../components/HeaderNav'
import { SetSelector, ALL_SETS } from '../components/SetSelector'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  baseCond, cardValue, condPrice, CONDS, fromCondList, toCondList, totalQty, type CondMap,
} from '../lib/conditions'
import type { Card } from '../types'

/* ─── Session state model ─────────────────────────────────────────────────── */

/** One card in the session: the card, how many of each condition, and the
 *  currently-selected condition for quick +/- in the tile. `order` is a counter
 *  so the most recently added card sorts to the top of the grid. */
interface Tile {
  card: Card
  conds: CondMap
  selCond: string
  order: number
}

/** The whole bulk session. Keyed by cardId so a card is merged, not duplicated. */
interface State {
  tiles: Record<string, Tile>
  nextOrder: number
}

/** Every mutation the session supports. The reducer is the ONLY place state
 *  changes, which is what keeps the count and Save button always accurate. */
type Action =
  | { type: 'add'; card: Card; condKey: string; step: number }
  | { type: 'adjSel'; cardId: string; delta: number }
  | { type: 'setQty'; cardId: string; qty: number }
  | { type: 'selectCond'; cardId: string; cond: string }
  | { type: 'adjCond'; cardId: string; cond: string; delta: number }
  | { type: 'clear' }

const EMPTY: State = { tiles: {}, nextOrder: 1 }

/**
 * PURPOSE: Apply a mutation to one tile, copying the tile so the update is
 *   immutable, and drop the tile entirely when it reaches zero total quantity.
 * @param state   Current session state
 * @param cardId  Which tile to change
 * @param fn      Edits the (already-copied) tile in place
 * @return        New state
 */
function withTile(state: State, cardId: string, fn: (t: Tile) => void): State {
  const existing = state.tiles[cardId]
  if (!existing) return state
  const tile: Tile = { ...existing, conds: { ...existing.conds } }
  fn(tile)
  const tiles = { ...state.tiles }
  if (totalQty(tile.conds) === 0) delete tiles[cardId]
  else tiles[cardId] = tile
  return { ...state, tiles }
}

/**
 * PURPOSE: The session reducer — pure, returns a new State for every action.
 * @param state   Current state
 * @param action  What happened
 * @return        Next state
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const prev = state.tiles[action.card.id]
      const conds = { ...(prev?.conds ?? {}) }
      conds[action.condKey] = (conds[action.condKey] ?? 0) + action.step
      const tile: Tile = { card: action.card, conds, selCond: action.condKey, order: state.nextOrder }
      return { tiles: { ...state.tiles, [action.card.id]: tile }, nextOrder: state.nextOrder + 1 }
    }
    case 'adjSel':
      return withTile(state, action.cardId, t => {
        const k = t.selCond
        const n = Math.max(0, (t.conds[k] ?? 0) + action.delta)
        if (n === 0) delete t.conds[k]; else t.conds[k] = n
      })
    case 'setQty':
      return withTile(state, action.cardId, t => {
        if (action.qty <= 0) delete t.conds[t.selCond]; else t.conds[t.selCond] = action.qty
      })
    case 'selectCond':
      return withTile(state, action.cardId, t => { t.selCond = action.cond })
    case 'adjCond':
      return withTile(state, action.cardId, t => {
        const n = Math.max(0, (t.conds[action.cond] ?? 0) + action.delta)
        if (n === 0) delete t.conds[action.cond]; else t.conds[action.cond] = n
      })
    case 'clear':
      return EMPTY
  }
}

/* ─── localStorage persistence ────────────────────────────────────────────── */

/** Per-user storage key so two accounts on one browser don't collide. */
const storageKey = (userId: string) => `poketracker_bulk_${userId}`

/**
 * PURPOSE: Lazy initializer for the reducer — restore a saved session if one
 *   exists for this user. Runs synchronously before any persist, so it can
 *   never be clobbered by an empty write.
 * @param userId  The logged-in user's id, or undefined if not yet known
 * @return        The restored session, or an empty one
 */
function initSession(userId: string | undefined): State {
  if (!userId) return EMPTY
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (parsed && parsed.tiles) return parsed
    }
  } catch { /* corrupt or unavailable — fall through to empty */ }
  return EMPTY
}

/**
 * PURPOSE: Mirror the session to localStorage; remove the key when empty so a
 *   cleared/saved session doesn't linger.
 */
function persistSession(userId: string, state: State) {
  try {
    if (Object.keys(state.tiles).length === 0) localStorage.removeItem(storageKey(userId))
    else localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch { /* quota or private mode — non-fatal, session still works in memory */ }
}

/* ─── Number matching helpers ─────────────────────────────────────────────── */

/**
 * PURPOSE: Does a card's printed number match what the user typed? Matches
 *   exactly (case-insensitive, e.g. "SWSH158") or numerically ignoring leading
 *   zeros for plain numbers (e.g. "007" === "7"), but never matches "7" to "7a".
 * @param cardNumber  The card's number field
 * @param typed       What the user typed in the number box
 * @return            true on a confident match
 */
function numberMatches(cardNumber: string, typed: string): boolean {
  const a = cardNumber.trim().toLowerCase()
  const b = typed.trim().toLowerCase()
  if (!b) return false
  if (a === b) return true
  // Numeric compare only when BOTH are pure digits (so "7a" never matches "7").
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return parseInt(a, 10) === parseInt(b, 10)
  return false
}

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
.bulk-page .num-entry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bulk-page .num-entry input{width:88px;text-align:center;font-size:16px;padding:10px 8px}
.bulk-page .num-entry .slash{color:var(--muted);font-weight:700}
.bulk-page .num-flash{font-size:13px;font-weight:700}
.bulk-page .num-flash.ok{color:var(--green)}
.bulk-page .num-flash.err{color:var(--red,#e55)}
.bulk-page .unsaved{font-size:12px;color:var(--accent);margin-right:6px}
`

export function BulkAddPage() {
  // CONTEXT + shared data
  const { user } = useUser()
  const toast = useToast()
  const preview = usePreview()
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])
  const setTotals = useMemo(() => buildSetTotals(sets), [sets])

  // SESSION STATE — restored from localStorage on first render.
  const [state, dispatch] = useReducer(reducer, user?.id, initSession)

  // Mirror every change back to localStorage (per user). Skipped when logged out.
  useEffect(() => {
    if (user) persistSession(user.id, state)
  }, [state, user])

  // SET SELECTION — drives the instant local "add by number" path.
  const [setId, setSetId] = useState<string | null>(null)
  const { data: setCards = [] } = useQuery({
    queryKey: ['cards', setId],
    queryFn: () => getCards(setId as string),
    enabled: !!user && !!setId && setId !== ALL_SETS,
  })

  // ADD CONTROLS — condition, 1st edition, and how many copies per add.
  const [cond, setCond] = useState<(typeof CONDS)[number]>('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [step, setStep] = useState(1)
  const [lastAdded, setLastAdded] = useState('')

  // NUMBER ENTRY — two boxes: numerator (card #) and optional denominator (total).
  const [num, setNum] = useState('')
  const [den, setDen] = useState('')
  const [numFlash, setNumFlash] = useState<{ text: string; err: boolean } | null>(null)
  const [numBusy, setNumBusy] = useState(false)
  const numRef = useRef<HTMLInputElement>(null)

  // NAME SEARCH — debounced dropdown.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState(false)
  const [hi, setHi] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  // SAVE
  const [saving, setSaving] = useState(false)

  // Debounced search. All state updates happen inside the timeout callback
  // (asynchronously), which keeps the effect body free of synchronous setState.
  // A "number/total" query (e.g. "080/198") is resolved the reliable way — find
  // the set by its total, load it, and match the number — instead of the backend
  // text search, so the Name box works for numbers too.
  useEffect(() => {
    const q = query.trim()
    const delay = q.length < 2 ? 0 : 250
    const timer = window.setTimeout(async () => {
      setHi(0)
      if (q.length < 2) { setResults([]); setSearching(false); setSearchErr(false); return }
      setSearching(true)
      setSearchErr(false)
      try {
        const slash = q.match(/^([A-Za-z0-9]+)\s*\/\s*(\d+)$/)
        if (slash) {
          // "<number>/<total>" — the total identifies the set(s) to look in.
          const [, numStr, denStr] = slash
          const candidates = sets.filter(s => String(s.printedTotal) === denStr || String(s.total) === denStr)
          const found: Card[] = []
          for (const s of candidates) {
            const cards = await getCards(s.id)
            found.push(...cards.filter(c => numberMatches(c.number, numStr)))
          }
          setResults(found.slice(0, 40))
        } else {
          const hits = await searchCards(q)
          setResults(narrowByCollectorNumber(hits, q, setTotals).slice(0, 40))
        }
      } catch {
        setResults([]); setSearchErr(true)
      } finally {
        setSearching(false)
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [query, setTotals, sets])

  // Derived session views — plain memoized reads of real state (no re-render hacks).
  const tiles = useMemo(
    () => Object.values(state.tiles).sort((a, b) => b.order - a.order),
    [state.tiles],
  )
  const totalCards = useMemo(() => tiles.reduce((s, t) => s + totalQty(t.conds), 0), [tiles])
  const totalValue = useMemo(() => tiles.reduce((s, t) => s + cardValue(t.conds, t.card), 0), [tiles])

  if (!user) return <div className="page-tracker bulk-page"><LoginScreen /></div>

  const activeSet = setId && setId !== ALL_SETS ? sets.find(s => s.id === setId) : undefined

  /** Add `step` copies of a card in the current condition to the session. */
  const addCard = (card: Card) => {
    const condKey = firstEd ? `${cond} 1st Ed` : cond
    dispatch({ type: 'add', card, condKey, step })
    setLastAdded(`+${step} ${card.name} (${condKey})`)
  }

  /** Brief confirmation shown under the number boxes. */
  const flash = (text: string, err: boolean) => {
    setNumFlash({ text, err })
    window.setTimeout(() => setNumFlash(null), err ? 1600 : 1100)
  }

  /**
   * PURPOSE: Add a card from the number boxes.
   *   - Set selected → instant local match in that set's loaded cards.
   *   - No set, but a total given → use the total to find the set(s), load each
   *     (getCards falls back to the API and pulls prices), and match the number
   *     there. This avoids the unreliable global text search entirely.
   *   - No set and no total → a bare number is ambiguous across sets, so ask for
   *     a total or a set rather than guessing.
   */
  const addByNumber = async () => {
    const n = num.trim()
    if (!n || numBusy) return

    // Fast path: a set is selected → match against its already-loaded cards.
    if (activeSet) {
      const card = setCards.find(c => numberMatches(c.number, n))
      if (card) { addCard(card); flash(`✓ #${card.number} ${card.name}`, false); setNum(''); setDen('') }
      else flash(`#${n} not found in ${activeSet.name}`, true)
      numRef.current?.focus()
      return
    }

    // Global path: the total identifies the set; a bare number can't.
    const d = den.trim()
    if (!d) { flash('add the set total on the right, or pick a set above', true); numRef.current?.focus(); return }
    const candidates = sets.filter(s => String(s.printedTotal) === d || String(s.total) === d)
    if (candidates.length === 0) { flash(`no set with total ${d}`, true); numRef.current?.focus(); return }

    setNumBusy(true)
    try {
      // Collect every card matching this number across all sets with that total.
      const matches: Card[] = []
      for (const s of candidates) {
        const cards = await getCards(s.id)
        matches.push(...cards.filter(c => numberMatches(c.number, n)))
      }
      if (matches.length === 0) {
        flash(`no card #${n}/${d}`, true)
      } else if (matches.length === 1) {
        // Unambiguous → add it directly (the fast path).
        addCard(matches[0])
        flash(`✓ #${matches[0].number} ${matches[0].name}`, false)
        setNum(''); setDen('')
      } else {
        // Several sets share this number + total. Don't guess — hand the matches
        // to the dropdown so the user picks the right set by name.
        setNum(''); setDen('')
        setQuery(`${n}/${d}`)
        searchRef.current?.focus()
        flash(`${matches.length} sets have #${n}/${d} — pick one below`, true)
      }
    } catch {
      flash('lookup failed — check the backend', true)
    } finally {
      setNumBusy(false)
      numRef.current?.focus()
    }
  }

  /** Enter in the name box: add the highlighted (or top) result. */
  const onSearchEnter = async () => {
    const q = query.trim()
    if (!q) return
    if (results.length) {
      addCard(results[hi] ?? results[0]); setQuery(''); setResults([]); searchRef.current?.focus(); return
    }
    try {
      const hits = await searchCards(q)
      if (hits.length) { addCard(hits[0]); setQuery(''); setResults([]) }
      else toast(`No match for "${q}"`)
    } catch { toast('Search failed — check the backend.') }
    searchRef.current?.focus()
  }

  /** Clear the unsaved session (does not touch the saved collection). */
  const clearAll = () => {
    if (tiles.length === 0) return
    if (!confirm('Clear the bulk session? Your saved collection is untouched.')) return
    dispatch({ type: 'clear' })
    setLastAdded('')
  }

  /**
   * PURPOSE: Merge the session into the existing collection and POST once.
   *   Reads the current collection first so quantities are additive, not
   *   replacing. On success clears the session; on failure leaves it intact.
   */
  const save = async () => {
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
      dispatch({ type: 'clear' })
      setLastAdded('')
    } catch {
      toast('Save failed — nothing was stored. Your session is still here.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-tracker bulk-page">
      <style>{STYLE}</style>
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">⚡ BULK <span>ADD</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <div className="header-right">
            {tiles.length > 0 && <span className="unsaved">{totalCards} unsaved · saved locally</span>}
            <button className="tb-btn" onClick={clearAll}>Clear</button>
            <button className="tb-btn primary" onClick={save} disabled={saving || tiles.length === 0}>
              {saving ? 'Saving…' : `Save${tiles.length ? ` (${totalCards})` : ''}`}
            </button>
            <HeaderNav />
          </div>
        </header>

        {/* ── Set picker — scopes the number entry to one set ─────────────────── */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sort-label">Set:</span>
          <SetSelector sets={sets} selectedId={setId} onSelect={setSetId} />
          {activeSet && (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              {setCards.length} cards{activeSet.printedTotal ? ` · /${activeSet.printedTotal}` : ''}
            </span>
          )}
        </div>

        {/* ── Condition / 1st Ed / step ───────────────────────────────────────── */}
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

        {/* ── Add by number — two boxes ───────────────────────────────────────── */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sort-label">No.:</span>
          <div className="num-entry">
            <input
              ref={numRef} type="text" placeholder="188" maxLength={12}
              autoComplete="off" spellCheck={false} value={num}
              onChange={e => setNum(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addByNumber() } }}
            />
            <span className="slash">/</span>
            <input
              type="text" placeholder="236" maxLength={12}
              autoComplete="off" spellCheck={false} value={den}
              onChange={e => setDen(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addByNumber() } }}
            />
            <button className="tb-btn primary" onClick={addByNumber} disabled={numBusy}>{numBusy ? '…' : 'Add'}</button>
            {numFlash && <span className={'num-flash ' + (numFlash.err ? 'err' : 'ok')}>{numFlash.text}</span>}
          </div>
          <span style={{ color: 'var(--muted)', fontSize: 12, flexBasis: '100%' }}>
            {activeSet
              ? `Type the card number and press Enter — the total box is optional when a set is picked.`
              : `Type number / set total (e.g. 080 / 198) — the total finds the set. Or pick a set above. Promos like SWSH158 go in the left box.`}
          </span>
        </div>

        {/* ── Add by name — search dropdown ───────────────────────────────────── */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sort-label">Name:</span>
          <div className="bulk-search-wrap">
            <input
              ref={searchRef} className="bulk-search" value={query}
              placeholder="Search by name — e.g. Charizard"
              onChange={e => setQuery(e.target.value)}
              onBlur={() => window.setTimeout(() => { setResults([]); setQuery('') }, 150)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onSearchEnter() }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, results.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
                else if (e.key === 'Escape') { setQuery(''); setResults([]) }
              }}
            />
            {query.trim().length >= 2 && (
              <div className="bulk-results">
                {searching && results.length === 0 && <div className="bulk-hint">Searching…</div>}
                {!searching && searchErr && (
                  <div className="bulk-hint" style={{ color: 'var(--red, #e55)' }}>Search failed — check the backend.</div>
                )}
                {!searching && !searchErr && results.length === 0 && <div className="bulk-hint">No matches.</div>}
                {results.map((card, i) => {
                  const have = totalQty(state.tiles[card.id]?.conds ?? {})
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

        {/* ── Stats ───────────────────────────────────────────────────────────── */}
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

        {/* ── Session grid ────────────────────────────────────────────────────── */}
        <div id="app-wrap">
          <div id="main">
            {tiles.length === 0 && (
              <div className="empty">Pick a set and type a number, or search by name, to start.</div>
            )}
            {tiles.length > 0 && (
              <div className="card-grid">
                {tiles.map(t => (
                  <CardTile
                    key={t.card.id} card={t.card} conds={t.conds} selCond={t.selCond}
                    onAdj={d => dispatch({ type: 'adjSel', cardId: t.card.id, delta: d })}
                    onSetQty={q => dispatch({ type: 'setQty', cardId: t.card.id, qty: q })}
                    onSelectCond={c => dispatch({ type: 'selectCond', cardId: t.card.id, cond: c })}
                    onAdjCond={(c, d) => dispatch({ type: 'adjCond', cardId: t.card.id, cond: c, delta: d })}
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
