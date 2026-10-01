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
 *   (The entry form itself is shared with storage boxes — see BulkAddControls.)
 *   Save merges the whole session into the existing collection in one request.
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: api/cards, api/collection, lib/cardSearch, lib/conditions
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useReducer, useState } from 'react'
import { getSets } from '../api/cards'
import { bulkSave, getCollection, type BulkItem } from '../api/collection'
import { CardTile } from '../components/CardTile'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { HeaderNav } from '../components/HeaderNav'
import { BulkAddControls } from '../components/BulkAddControls'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  baseCond, cardValue, fromCondList, hasFirstEdition, toCondList, totalQty, type CondMap,
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

// This page's own styling, kept here rather than in a separate .css file
// since it's only ever used on this one page.
const STYLE = `
.bulk-page .unsaved{font-size:12px;color:var(--accent);margin-right:6px}
`

export function BulkAddPage() {
  const { user } = useUser()
  const toast = useToast()
  const preview = usePreview()

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // Restored from localStorage on first load — see initSession.
  const [state, dispatch] = useReducer(reducer, user?.id, initSession)

  // Saves the session back to localStorage every time it (or the user) changes.
  useEffect(() => {
    if (user) persistSession(user.id, state)
  }, [state, user])

  const [lastAdded, setLastAdded] = useState('')

  const [saving, setSaving] = useState(false)

  // The session's tiles, newest first.
  const tiles = useMemo(
    () => Object.values(state.tiles).sort((a, b) => b.order - a.order),
    [state.tiles],
  )
  const totalCards = useMemo(() => tiles.reduce((s, t) => s + totalQty(t.conds), 0), [tiles])
  const totalValue = useMemo(() => tiles.reduce((s, t) => s + cardValue(t.conds, t.card), 0), [tiles])
  // The session list can mix cards added from different sets, so (unlike a
  // single-set grid) every tile names its own set rather than relying on a
  // single banner above the grid.
  const setNameById = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  if (!user) return <div className="page-tracker bulk-page"><LoginScreen /></div>

  /** One add from the form — `step` copies of `card` under `condKey`. */
  const addCard = (card: Card, condKey: string, step: number) => {
    dispatch({ type: 'add', card, condKey, step })
    setLastAdded(`+${step} ${card.name} (${condKey})`)
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
        // A session saved locally before the 1st Ed guard existed can still
        // hold "1st Ed" keys for modern sets — folded into the plain condition.
        for (const k of Object.keys(t.conds)) {
          const key = hasFirstEdition(t.card.setId) ? k : baseCond(k)
          map[key] = (map[key] ?? 0) + t.conds[k]
        }

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
          <div className="logo">⚡ ADD <span>&amp; FILE</span></div>
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

        <BulkAddControls
          onAdd={addCard} preview={preview}
          have={cardId => totalQty(state.tiles[cardId]?.conds ?? {})}
        />

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
                    setName={setNameById.get(t.card.setId)}
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
