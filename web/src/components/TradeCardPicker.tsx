/**
 * TradeCardPicker — a buyer searches the card catalog and adds the cards they'd
 * like to trade, each with a condition and quantity (no login needed).
 *
 * HOW IT WORKS
 *   Typing searches /api/search (public) after a short pause and lists the
 *   matches with picture, set, number and a condition picker. "Add" puts the
 *   card in the list below, where quantities can be changed or the card removed.
 *   Shows what the list is worth at today's market prices. The parent owns the
 *   list (`lines`); this only edits it.
 *
 * USED BY: ShopPage (request form)
 * DEPENDS ON: api/cards, lib/conditions, lib/cardSearch
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSets, searchCards } from '../api/cards'
import { buildSetTotals, narrowByCollectorNumber } from '../lib/cardSearch'
import { CONDS, condPrice } from '../lib/conditions'
import type { Card } from '../types'

/** One card the buyer offers: which card, in what condition, how many. */
export interface TradeLine { card: Card; cond: string; qty: number }

/** Most cards one request can offer (the request message has a fixed length). */
export const MAX_TRADE_CARDS = 10

type SearchState = 'idle' | 'searching' | 'none' | 'error'

export function TradeCardPicker({ lines, onChange }: { lines: TradeLine[]; onChange: (lines: TradeLine[]) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [state, setState] = useState<SearchState>('idle')
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])
  const setTotals = useMemo(() => buildSetTotals(sets), [sets])

  // Search a moment after typing stops. `stale` drops answers to older keystrokes.
  useEffect(() => {
    const needle = q.trim()
    if (needle.length < 2) return
    let stale = false
    const timer = setTimeout(async () => {
      setState('searching')
      try {
        const hits = narrowByCollectorNumber(await searchCards(needle), needle, setTotals).slice(0, 8)
        if (stale) return
        setResults(hits)
        setState(hits.length > 0 ? 'idle' : 'none')
      } catch {
        if (!stale) { setResults([]); setState('error') }
      }
    }, 300)
    return () => { stale = true; clearTimeout(timer) }
  }, [q, setTotals])

  const type = (value: string) => {
    setQ(value)
    if (value.trim().length < 2) { setResults([]); setState('idle') }
  }

  const full = lines.length >= MAX_TRADE_CARDS
  const add = (card: Card, cond: string) => {
    const at = lines.findIndex(l => l.card.id === card.id && l.cond === cond)
    if (at >= 0) onChange(lines.map((l, i) => (i === at ? { ...l, qty: Math.min(20, l.qty + 1) } : l)))
    else if (!full) onChange([...lines, { card, cond, qty: 1 }])
  }
  const setQty = (i: number, qty: number) =>
    onChange(qty < 1 ? lines.filter((_, at) => at !== i) : lines.map((l, at) => (at === i ? { ...l, qty: Math.min(20, qty) } : l)))

  const value = lines.reduce((n, l) => n + l.qty * condPrice(l.card, l.cond), 0)

  return (
    <div className="trade-picker">
      <input type="search" value={q} onChange={e => type(e.target.value)} placeholder="Search a card to trade (name or number)…"
        aria-label="Search cards to trade" />
      {state === 'searching' && <p className="trade-picker-msg">Searching…</p>}
      {state === 'none' && <p className="trade-picker-msg">No cards found — try a different name.</p>}
      {state === 'error' && <p className="trade-picker-msg">Search failed — please try again.</p>}
      {results.map(card => <TradeResult key={card.id} card={card} setName={setName.get(card.setId) ?? card.setId}
        disabled={full} onAdd={cond => add(card, cond)} />)}
      {full && <p className="trade-picker-msg">That's the most cards one request can offer ({MAX_TRADE_CARDS}).</p>}

      {lines.length > 0 && (
        <ul className="trade-picker-list" aria-label="Cards you'd trade">
          {lines.map((l, i) => (
            <li key={`${l.card.id}|${l.cond}`}>
              {l.card.images?.small && <img src={l.card.images.small} alt="" width={36} />}
              <span className="trade-picker-name">{l.card.name} <small>#{l.card.number} · {l.cond}</small></span>
              <span className="trade-picker-price">{condPrice(l.card, l.cond) > 0 ? '$' + (condPrice(l.card, l.cond) * l.qty).toFixed(2) : 'no price'}</span>
              <span className="shop-stepper">
                <button type="button" aria-label={`Remove one ${l.card.name}`} onClick={() => setQty(i, l.qty - 1)}>−</button>
                <b>{l.qty}</b>
                <button type="button" aria-label={`Add one ${l.card.name}`} disabled={l.qty >= 20} onClick={() => setQty(i, l.qty + 1)}>+</button>
              </span>
            </li>
          ))}
          <li className="trade-picker-total"><span>Your trade cards ≈ <b>${value.toFixed(2)}</b> at today's prices</span></li>
        </ul>
      )}
    </div>
  )
}

/** One search hit: picture, details, a condition picker and an Add button. */
function TradeResult({ card, setName, disabled, onAdd }: { card: Card; setName: string; disabled: boolean; onAdd: (cond: string) => void }) {
  const [cond, setCond] = useState<string>('NM')
  return (
    <div className="trade-picker-hit">
      {card.images?.small && <img src={card.images.small} alt="" width={36} />}
      <span className="trade-picker-name">{card.name} <small>{setName} · #{card.number}{card.rarity ? ` · ${card.rarity}` : ''}</small></span>
      <select value={cond} onChange={e => setCond(e.target.value)} aria-label={`Condition of ${card.name}`}>
        {CONDS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <button type="button" className="shop-btn" disabled={disabled} onClick={() => onAdd(cond)} aria-label={`Add ${card.name} to trade`}>Add</button>
    </div>
  )
}
