/**
 * BulkAddPage — high-volume bulk card entry.
 *
 * HOW IT WORKS
 *   The session's state lives in one place with one set of rules for
 *   changing it (`reducer` below), so the on-screen count and the Save
 *   button can never drift out of sync. The session is mirrored to
 *   localStorage on every change and restored on load, so navigating away
 *   — or a refresh — never loses entered cards. Three ways to add a card:
 *     1. SET + NUMBER   — pick a set, type the collector number, Enter.
 *        Instant local lookup, no backend search.
 *     2. NUMBER / TOTAL — two boxes ("188" / "236") for a global number
 *        lookup when no set is selected; promos like "SWSH158" go in the left box.
 *     3. NAME SEARCH    — type a name, pick from the dropdown.
 *   Save merges the whole session into the existing collection in one request.
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: api/cards, api/collection, lib/cardSearch, lib/conditions
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react'
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
 *  currently-selected condition for quick +/- in the tile. `order` is a
 *  counter so the most recently added card sorts to the top of the grid. */
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

/**
 * Every change the session can go through — adding a card, adjusting a
 * quantity, clearing everything, etc. Each one is a plain object with a
 * `type` field saying which change it is. All state changes go through
 * `reducer` below, which is the only place that's allowed to build the
 * next version of the session — that's what keeps the count and Save
 * button always correct.
 */
type Action =
  | { type: 'add'; card: Card; condKey: string; step: number }
  | { type: 'adjSel'; cardId: string; delta: number }
  | { type: 'setQty'; cardId: string; qty: number }
  | { type: 'selectCond'; cardId: string; cond: string }
  | { type: 'adjCond'; cardId: string; cond: string; delta: number }
  | { type: 'clear' }

const EMPTY: State = { tiles: {}, nextOrder: 1 }

/**
 * Changes one tile, working on a fresh copy of it so the original is
 * never touched directly. Removes the tile entirely if it ends up with
 * zero copies across every condition.
 *
 * @param fn  Makes the actual change, directly on the fresh copy handed to it.
 */
function withTile(state: State, cardId: string, fn: (t: Tile) => void): State {
  const existing = state.tiles[cardId]
  if (!existing) return state

  // A fresh copy — including its own fresh copy of `conds`, since that's
  // what `fn` is about to change.
  const tile: Tile = { ...existing, conds: { ...existing.conds } }
  fn(tile)

  const tiles = { ...state.tiles }
  if (totalQty(tile.conds) === 0) delete tiles[cardId]
  else tiles[cardId] = tile

  return { ...state, tiles }
}

/**
 * Takes the current session plus one Action (see above) and returns the
 * new session that should result. Never changes the old session directly
 * — always builds and returns a new one. Every possible change to the
 * session goes through here, which is what keeps the numbers on screen trustworthy.
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const prev = state.tiles[action.card.id]

      // Starts from the card's existing quantities if it's already in the
      // session, or an empty set of quantities if it's brand new.
      const conds = { ...(prev?.conds ?? {}) }
      conds[action.condKey] = (conds[action.condKey] ?? 0) + action.step

      // The newest tile always gets the current nextOrder, so it sorts first.
      const tile: Tile = { card: action.card, conds, selCond: action.condKey, order: state.nextOrder }
      return { tiles: { ...state.tiles, [action.card.id]: tile }, nextOrder: state.nextOrder + 1 }
    }

    // The tile's own +/- buttons — changes whichever condition is selected.
    case 'adjSel':
      return withTile(state, action.cardId, t => {
        const k = t.selCond
        const n = Math.max(0, (t.conds[k] ?? 0) + action.delta)
        if (n === 0) delete t.conds[k]; else t.conds[k] = n
      })

    // Types an exact quantity in directly.
    case 'setQty':
      return withTile(state, action.cardId, t => {
        if (action.qty <= 0) delete t.conds[t.selCond]; else t.conds[t.selCond] = action.qty
      })

    // Changes which condition a tile's +/- buttons currently target.
    case 'selectCond':
      return withTile(state, action.cardId, t => { t.selCond = action.cond })

    // Right-click on a condition badge — adjusts THAT condition directly,
    // regardless of which one is currently selected.
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
 * Restores a saved session for this user, if one exists. Runs once, right
 * when the page first loads, before anything gets saved back — so it can
 * never accidentally overwrite a real saved session with an empty one.
 */
function initSession(userId: string | undefined): State {
  if (!userId) return EMPTY

  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (raw) {
      const parsed = JSON.parse(raw) as State
      // A basic sanity check that this really looks like a saved session.
      if (parsed && parsed.tiles) return parsed
    }
  } catch { /* corrupt or unavailable — fall through to empty */ }

  return EMPTY
}

/** Mirrors the session to localStorage; removes the key when empty so a cleared/saved session doesn't linger. */
function persistSession(userId: string, state: State) {
  try {
    if (Object.keys(state.tiles).length === 0) localStorage.removeItem(storageKey(userId))
    else localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch { /* quota or private mode — non-fatal, session still works in memory */ }
}

/* ─── Number matching helpers ─────────────────────────────────────────────── */

/**
 * Strips leading zeros from the trailing digit run of a collector number,
 * keeping any letter prefix — "007" -> "7", "SWSH001" -> "SWSH1", "GG01"
 * -> "GG1". A number that doesn't fit that shape (like "7a", which has a
 * letter AFTER the digits) is left unchanged, which is what keeps "7a"
 * from ever matching "7".
 */
function stripLeadingZeros(number: string): string {
  return number.replace(/^([a-z]*)0*(\d+)$/, '$1$2')
}

/**
 * Does a card's printed number match what the user typed? Matches
 * exactly (ignoring case), or with leading zeros ignored, so "007"
 * matches "7" and "SWSH001" matches "SWSH1". Never matches "7" to "7a".
 */
function numberMatches(cardNumber: string, typed: string): boolean {
  const a = cardNumber.trim().toLowerCase()
  const b = typed.trim().toLowerCase()
  if (!b) return false
  if (a === b) return true
  return stripLeadingZeros(a) === stripLeadingZeros(b)
}

// This page's own styling, kept here rather than in a separate .css file
// since it's only ever used on this one page.
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
.bulk-page .num-entry input{width:120px;text-align:center;font-size:16px;padding:10px 8px}
.bulk-page .num-flash{font-size:13px;font-weight:700}
.bulk-page .num-flash.ok{color:var(--green)}
.bulk-page .num-flash.err{color:var(--red,#e55)}
.bulk-page .unsaved{font-size:12px;color:var(--accent);margin-right:6px}
`

export function BulkAddPage() {
  const { user } = useUser()
  const toast = useToast()
  const preview = usePreview()

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // setId -> set name, so a search result can show its set's name without
  // another network request.
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  const setTotals = useMemo(() => buildSetTotals(sets), [sets])

  // Restored from localStorage on first load — see initSession.
  const [state, dispatch] = useReducer(reducer, user?.id, initSession)

  // Saves the session back to localStorage every time it (or the user) changes.
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

  // NUMBER ENTRY — one box. Accepts a bare number ("7") when a set is
  // picked, or "number/total" ("080/198") to find the set globally — same
  // "N/D" parsing the Name search box already does, so there's only ever
  // one field to type into and Enter always submits.
  const [numInput, setNumInput] = useState('')
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

  const [saving, setSaving] = useState(false)

  // Waits a moment after typing stops before actually searching, so the
  // backend isn't hit on every keystroke. A "number/total" query (e.g.
  // "080/198") is resolved by finding the set by its total, loading it,
  // and matching the number — more reliable than the plain text search.
  useEffect(() => {
    const q = query.trim()
    const delay = q.length < 2 ? 0 : 250
    const timer = window.setTimeout(async () => {
      setHi(0)
      if (q.length < 2) { setResults([]); setSearching(false); setSearchErr(false); return }
      setSearching(true)
      setSearchErr(false)
      try {
        // Checks whether the whole typed text is "number/total".
        const slash = q.match(/^([A-Za-z0-9]+)\s*\/\s*(\d+)$/)
        if (slash) {
          const [, numStr, denStr] = slash

          // Finds every set whose printed or real total matches what was typed.
          const candidates = sets.filter(s => String(s.printedTotal) === denStr || String(s.total) === denStr)
          const found: Card[] = []
          for (const s of candidates) {
            const cards = await getCards(s.id)
            found.push(...cards.filter(c => numberMatches(c.number, numStr)))
          }
          setResults(found.slice(0, 40))
        } else {
          // A normal name/number search, then the same narrowing used on
          // the main Collection page.
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

  // The session's tiles, newest first.
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
    // Errors stay visible longer (1.6s) than confirmations (1.1s), so
    // there's more time to actually read what went wrong.
    window.setTimeout(() => setNumFlash(null), err ? 1600 : 1100)
  }

  /**
   * Lets the whole add flow run from the number field without ever
   * leaving the physical numpad — none of `+ - * .` are valid characters
   * in a real collector number, so binding them here can't collide with
   * typing an actual number. `*` cycles Condition, `+`/`-` adjust the
   * quantity step, `.` toggles 1st Ed.
   */
  const onNumKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addByNumber(); return }
    if (e.key === '*') {
      e.preventDefault()
      // Moves to the next condition, wrapping back to the first after the last.
      setCond(c => CONDS[(CONDS.indexOf(c) + 1) % CONDS.length])
    } else if (e.key === '+') {
      e.preventDefault()
      setStep(s => s + 1)
    } else if (e.key === '-') {
      e.preventDefault()
      setStep(s => Math.max(1, s - 1))
    } else if (e.key === '.') {
      e.preventDefault()
      setFirstEd(f => !f)
    }
  }

  /**
   * Adds a card from the number box. Parses `numInput` as either a bare
   * number ("7") or "number/total" ("080/198"):
   *   - Set selected → instant local match in that set's cards (any
   *     "/total" typed is ignored — the set already picks it).
   *   - No set, but a total given → uses the total to find the set(s),
   *     loads each, and matches the number there.
   *   - No set and no total → a bare number is ambiguous across sets, so
   *     this asks for a total or a set instead of guessing.
   */
  const addByNumber = async () => {
    const raw = numInput.trim()
    if (!raw || numBusy) return

    const slash = raw.match(/^([A-Za-z0-9]+)\s*\/\s*(\d+)$/)
    const n = slash ? slash[1] : raw
    const d = slash ? slash[2] : ''

    // Fast path: a set is selected, so just match against its own cards.
    if (activeSet) {
      const card = setCards.find(c => numberMatches(c.number, n))
      if (card) { addCard(card); flash(`✓ #${card.number} ${card.name}`, false); setNumInput('') }
      else flash(`#${n} not found in ${activeSet.name}`, true)
      numRef.current?.focus()
      return
    }

    // No set selected — the total is what identifies which set(s) to look in.
    if (!d) { flash('type number/total (e.g. 7/198), or pick a set above', true); numRef.current?.focus(); return }
    const candidates = sets.filter(s => String(s.printedTotal) === d || String(s.total) === d)
    if (candidates.length === 0) { flash(`no set with total ${d}`, true); numRef.current?.focus(); return }

    setNumBusy(true)
    try {
      const matches: Card[] = []
      for (const s of candidates) {
        const cards = await getCards(s.id)
        matches.push(...cards.filter(c => numberMatches(c.number, n)))
      }
      if (matches.length === 0) {
        flash(`no card #${n}/${d}`, true)
        numRef.current?.focus()
      } else if (matches.length === 1) {
        addCard(matches[0])
        flash(`✓ #${matches[0].number} ${matches[0].name}`, false)
        setNumInput('')
        numRef.current?.focus()
      } else {
        // Several sets share this number + total — don't guess. Hand it
        // to the name search dropdown so the user can pick by set name.
        // Focus stays on the search box: refocusing the number box here
        // would blur the search box and clear the results we just set.
        setNumInput('')
        setQuery(`${n}/${d}`)
        searchRef.current?.focus()
        flash(`${matches.length} sets have #${n}/${d} — pick one below`, true)
      }
    } catch {
      flash('lookup failed — check the backend', true)
      numRef.current?.focus()
    } finally {
      setNumBusy(false)
    }
  }

  /** Enter in the name box: add the highlighted (or top) result. */
  const onSearchEnter = async () => {
    const q = query.trim()
    if (!q) return
    if (results.length) {
      addCard(results[hi] ?? results[0]); setQuery(''); setResults([]); searchRef.current?.focus(); return
    }
    // No dropdown results yet (Enter pressed before the debounced search
    // even ran) — do a fresh, immediate search right now instead.
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
   * Merges the session into the existing collection and sends it as one
   * request. Reads the current collection first so quantities are ADDED
   * on top, not replaced. Clears the session on success; leaves it
   * untouched on failure so nothing is ever lost.
   */
  const save = async () => {
    if (tiles.length === 0) { toast('Nothing to save yet.'); return }
    setSaving(true)
    try {
      const existing = await getCollection(user.id)
      const byCard = new Map(existing.map(e => [e.cardId, e]))

      const items: BulkItem[] = tiles.map(t => {
        const prior = byCard.get(t.card.id)

        // Starts from what's already saved (if anything), then adds the
        // session's newly-entered quantities on top — this is what makes
        // the save additive rather than a plain overwrite.
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
      // Nothing was lost — the session is left intact so Save can just be tried again.
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

        {/* ── Add by number — one box, Enter always submits ──────────────────── */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sort-label">No.:</span>
          <div className="num-entry">
            <input
              ref={numRef} type="text" placeholder={activeSet ? '7' : '80/198'} maxLength={16}
              autoComplete="off" spellCheck={false} value={numInput}
              onChange={e => setNumInput(e.target.value)}
              onKeyDown={onNumKeyDown}
            />
            <button className="tb-btn primary" onClick={addByNumber} disabled={numBusy}>{numBusy ? '…' : 'Add'}</button>
            {numFlash && <span className={'num-flash ' + (numFlash.err ? 'err' : 'ok')}>{numFlash.text}</span>}
          </div>
          <span style={{ color: 'var(--muted)', fontSize: 12, flexBasis: '100%' }}>
            {activeSet
              ? `Type the card number and press Enter. A "/total" is accepted but ignored — the set already picks it.`
              : `Type number/total (e.g. 80/198) and press Enter — the total finds the set. Or pick a set above. Promos like SWSH158 go in alone.`}
            {' · numpad-only: '}<b>*</b>{' cond · '}<b>+</b>/<b>-</b>{' qty · '}<b>.</b>{' 1st ed'}
          </span>
        </div>

        {/* ── Add by name — search dropdown ───────────────────────────────────── */}
        <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="sort-label">Name:</span>
          <div className="bulk-search-wrap">
            <input
              ref={searchRef} className="bulk-search" type="text" value={query}
              placeholder="Search by name — e.g. Charizard"
              onChange={e => setQuery(e.target.value)}
              // A short delay before clearing on blur: clicking a dropdown
              // result also briefly blurs this box just before the click
              // registers, so clearing instantly would make the click miss.
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
                  // How many are already in the CURRENT session (not the saved collection).
                  const have = totalQty(state.tiles[card.id]?.conds ?? {})
                  return (
                    <button
                      key={card.id} className={'brow' + (i === hi ? ' hi' : '')}
                      onMouseEnter={() => setHi(i)}
                      onClick={() => { addCard(card); setQuery(''); setResults([]) }}
                    >
                      {card.images?.small
                        ? <img
                            src={card.images.small} alt={card.name} loading="lazy"
                            onMouseEnter={() => preview.show(card.images.large || card.images.small)}
                            onMouseLeave={() => preview.hide()}
                          />
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
                {/* Each tile's callbacks dispatch an Action to the reducer
                    above, instead of calling a state-updating function directly. */}
                {tiles.map(t => (
                  <CardTile
                    key={t.card.id} card={t.card} conds={t.conds} selCond={t.selCond}
                    onAdj={d => dispatch({ type: 'adjSel', cardId: t.card.id, delta: d })}
                    onSetQty={q => dispatch({ type: 'setQty', cardId: t.card.id, qty: q })}
                    onSelectCond={c => dispatch({ type: 'selectCond', cardId: t.card.id, cond: c })}
                    onAdjCond={(c, d) => dispatch({ type: 'adjCond', cardId: t.card.id, cond: c, delta: d })}
                    onPreview={(src, opts) => (src ? preview.show(src, opts) : preview.hide())}
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
