/**
 * FILE: CardTile.tsx
 * LOCATION: src/components/CardTile.tsx
 *
 * PURPOSE:
 *   One card in the collection grid — thumbnail (hover = big preview),
 *   name/number/rarity/artist, price line, −/qty/+ stepper for the selected
 *   condition, condition badges with per-condition counts, and the breakdown
 *   row with per-condition values.  Stateless: the parent owns all counts and
 *   calls the backend; the tile just renders and fires callbacks.
 *
 * IMPORTS EXPLAINED:
 *   CONDS/COND_COLORS   — canonical condition order and badge colors
 *   baseCond            — strips " 1st Ed" suffix to get the base condition key
 *   basePrice/cardValue — NM price and total value across all owned conditions
 *   condPrice           — price for one specific condition key
 *   dominantCondClass   — CSS class controlling the tile border color
 *   totalQty            — sum of all condition quantities
 *   CondMap             — Record<string, number> — condition → count
 *   Card                — type-only import; zero runtime cost
 *
 * USED BY: CollectionPage, BulkAddPage
 */
import { useState } from 'react'
import { getPriceHistory } from '../api/cards'
import type { PreviewOpts } from './CardPreview'
import { CONDS, COND_COLORS, baseCond, basePrice, cardValue, condPrice, dominantCondClass, totalQty, type CondMap, type PurchaseMap } from '../lib/conditions'
import { isHolo } from '../lib/rarity'
import type { Card, PriceHistoryPoint } from '../types'

/**
 * INTERFACE: Props
 * PURPOSE: All inputs the tile needs to render and respond to user actions.
 *   Callbacks are wired by the parent so the tile itself is stateless.
 */
interface Props {
  card: Card
  /** Condition → quantity owned for this card. */
  conds: CondMap
  /** Which condition the qty stepper currently edits. */
  selCond: string
  /** Called when the user clicks +/− on the selected condition. */
  onAdj: (delta: number) => void
  /** Called when the user types directly into the qty input. */
  onSetQty: (qty: number) => void
  /** Called when the user clicks a condition badge to switch the active condition. */
  onSelectCond: (cond: string) => void
  /** Called on right-click of a condition badge — decrements that condition by 1. */
  onAdjCond: (cond: string, delta: number) => void
  /** Called on image hover — parent shows/hides the large preview overlay.
   *  `opts` carries the holo/price treatment so the zoom matches the tile. */
  onPreview: (src: string | null, opts?: PreviewOpts) => void
  /** Optional: when provided, a "To binder" button shows and calls this with the card. */
  onAddToBinder?: (card: Card) => void
  /** Optional: what the user says they paid, per condition, if the parent tracks it. */
  purchases?: PurchaseMap
  /** Optional: when provided, each owned condition gets a "log what you paid" control. */
  onSetPurchase?: (cond: string, price: number) => void
}

/**
 * Percent above/below what a card is worth now vs. what was paid for it.
 * A $0 purchase price (e.g. pulled from a pack) has no percent return in the
 * usual sense — it's Infinity, not undefined — so that's reported as such
 * rather than hidden; only an unknown market price yields no comparison at all.
 */
function gainLossPct(paid: number, market: number): number | null {
  if (market <= 0) return null
  if (paid <= 0) return market > 0 ? Infinity : null
  return ((market - paid) / paid) * 100
}

export function CardTile({ card, conds, selCond, onAdj, onSetQty, onSelectCond, onAdjCond, onPreview, onAddToBinder, purchases, onSetPurchase }: Props) {
  const [editingPurchase, setEditingPurchase] = useState<string | null>(null)
  const [purchaseInput, setPurchaseInput] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<PriceHistoryPoint[] | null>(null)
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle')

  const toggleHistory = () => {
    setHistoryOpen(open => {
      const next = !open
      if (next && history === null && historyState === 'idle') {
        setHistoryState('loading')
        getPriceHistory(card.id)
          .then(pts => { setHistory(pts); setHistoryState('idle') })
          .catch(() => setHistoryState('error'))
      }
      return next
    })
  }

  const qty = totalQty(conds)
  const price = basePrice(card)
  const priceStr = price > 0
    ? '$' + price.toFixed(2) + (qty > 1 ? ' · $' + cardValue(conds, card).toFixed(2) : '')
    : 'no price'
  const selQty = conds[selCond] ?? 0
  const value = cardValue(conds, card)
  // Condition keys actually owned, in canonical order, 1st Ed after base.
  const ownedKeys = Object.keys(conds)
    .filter(k => conds[k] > 0)
    .sort((a, b) => CONDS.indexOf(baseCond(a)) - CONDS.indexOf(baseCond(b)) || a.length - b.length)

  return (
    <div className={`pcard${qty > 0 ? ' owned' : ''} ${dominantCondClass(conds)}`}>
      <div className="pcard-top">
        {card.images?.small ? (
          <div className={'thumb-wrap' + (isHolo(card.rarity) ? ' holo' : '')}>
            <img
              className="thumb" src={card.images.small} alt={card.name} loading="lazy"
              onMouseEnter={() => onPreview(card.images.large || card.images.small, { holo: isHolo(card.rarity), price })}
              onMouseLeave={() => onPreview(null)}
            />
            {price > 0 && <span className="price-ribbon">${price.toFixed(2)}</span>}
          </div>
        ) : (
          <div className="thumb-placeholder">🃏</div>
        )}
        <div className="cinfo">
          <div className="cname" title={card.name}>{card.name}</div>
          <div className="cmeta">#{card.number} · {card.rarity || '?'}</div>
          <div className="cmeta" style={{ opacity: 0.6 }}>{card.artist ? '✏ ' + card.artist : ''}</div>
          <div className={'cprice' + (price === 0 ? ' no-price' : '')}>
            {priceStr}
            <button className="history-toggle" title="Price history" onClick={toggleHistory}>📈</button>
          </div>
          {historyOpen && (
            <div className="history-popover">
              <div className="history-popover-head">
                Price history
                <button className="history-close" onClick={() => setHistoryOpen(false)}>✕</button>
              </div>
              {historyState === 'loading' && <p className="history-msg">Loading…</p>}
              {historyState === 'error' && <p className="history-msg">Could not load history.</p>}
              {historyState === 'idle' && history !== null && history.length === 0 && (
                <p className="history-msg">
                  No history yet — snapshots start accumulating from the next time this card's price refreshes.
                </p>
              )}
              {/* A single point can't show a trend — a "chart" with one bar is
                  just a solid rectangle. Show the one snapshot as text instead. */}
              {historyState === 'idle' && history !== null && history.length === 1 && (
                <p className="history-msg">
                  Only one snapshot so far — {new Date(history[0].recordedAt).toLocaleDateString()}
                  {' · NM '}{history[0].nm != null ? '$' + history[0].nm.toFixed(2) : '—'}.
                  Check back after this card's price refreshes again to see a trend.
                </p>
              )}
              {historyState === 'idle' && history !== null && history.length > 1 && (() => {
                // Show only the most recent snapshots — a full unbounded history
                // (accumulating every ~6h forever) is more than useful in a small popover.
                const recent = history.slice(-5)
                const vals = recent.map(h => h.nm ?? 0)
                const max = Math.max(...vals, 0.01)
                return (
                  <>
                    <div className="history-chart">
                      {recent.map((h, i) => (
                        <div
                          key={i} className="history-bar"
                          style={{ height: `${Math.max(4, ((h.nm ?? 0) / max) * 100)}%` }}
                          title={`${new Date(h.recordedAt).toLocaleDateString()} — ${h.nm != null ? '$' + h.nm.toFixed(2) : 'no price'}`}
                        />
                      ))}
                    </div>
                    <p className="history-range">
                      {new Date(recent[0].recordedAt).toLocaleDateString()}
                      {' → '}
                      {new Date(recent[recent.length - 1].recordedAt).toLocaleDateString()}
                      {' · NM '}
                      {recent[0].nm != null ? '$' + recent[0].nm.toFixed(2) : '—'}
                      {' → '}
                      {recent[recent.length - 1].nm != null ? '$' + recent[recent.length - 1].nm!.toFixed(2) : '—'}
                    </p>
                  </>
                )
              })()}
            </div>
          )}
          <div className="qty-row">
            <button className="qbtn" onClick={() => onAdj(-1)}>−</button>
            <input
              className={'qty' + (selQty > 0 ? ' has-qty' : '')}
              type="number" min={0} value={selQty}
              onChange={e => onSetQty(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              aria-label={`qty for ${card.name}`}
            />
            <button className="qbtn" onClick={() => onAdj(1)}>+</button>
          </div>
          {onAddToBinder && (
            <button
              className="tb-btn"
              style={{ marginTop: 6, fontSize: 11, padding: '4px 8px', alignSelf: 'flex-start' }}
              onClick={() => onAddToBinder(card)}
              title="Add this card to one of your binders"
            >📒 To binder</button>
          )}
        </div>
      </div>
      <div className="cond-section">
        <div className="cond-row">
          {CONDS.map(c => {
            const count = (conds[c] ?? 0) + (conds[c + ' 1st Ed'] ?? 0)
            return (
              <span
                key={c}
                className={`cbtn ${c}${count > 0 ? ' has-count' : ''}${baseCond(selCond) === c ? ' sel' : ''}`}
                onClick={() => onSelectCond(c)}
                onContextMenu={e => { e.preventDefault(); onAdjCond(c, -1) }}
                title={`Select ${c} (right-click removes one)`}
              >
                <span className="cbtn-label">{c}</span>
                {count > 0 && <span className="cbtn-count">{count}</span>}
              </span>
            )
          })}
        </div>
        {ownedKeys.length > 0 && (
          <button className="details-toggle" onClick={() => setDetailsOpen(o => !o)}>
            {detailsOpen ? 'Hide details ▴' : `Details${value > 0 ? ` · $${value.toFixed(2)}` : ''} ▾`}
          </button>
        )}
        {detailsOpen && ownedKeys.length > 0 && (
          <div className="cond-breakdown-row">
            {ownedKeys.map(k => (
              <span key={k} className="cbd-item">
                <span className="cbd-dot" style={{ background: COND_COLORS[baseCond(k)] }} />
                {k}×{conds[k]}
                {condPrice(card, k) > 0 && (
                  <span className="cbd-val">${(condPrice(card, k) * conds[k]).toFixed(2)}</span>
                )}
              </span>
            ))}
            {value > 0 && <span className="cond-total">= ${value.toFixed(2)}</span>}
          </div>
        )}
        {/* Purchase price: its own row below the value breakdown, one line per
            owned condition, so "what you paid" is never squeezed into the same
            line as the market-price numbers. */}
        {detailsOpen && onSetPurchase && ownedKeys.length > 0 && (
          <div className="purchase-section">
            {ownedKeys.map(k => {
              const purchase = purchases?.[k]
              const market = condPrice(card, k)
              const pct = purchase ? gainLossPct(purchase.price, market) : null
              const diff = purchase && market > 0 ? market - purchase.price : null
              return (
                <div key={k} className="purchase-line">
                  {editingPurchase === k ? (
                    <span className="purchase-edit-row">
                      <span className="purchase-cond-label">{k}</span> paid $
                      <input
                        autoFocus type="number" min={0} step="0.01" value={purchaseInput}
                        onChange={e => setPurchaseInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const v = parseFloat(purchaseInput)
                            // >= 0, not > 0: $0 is valid (e.g. a card pulled from a pack).
                            if (!isNaN(v) && v >= 0) onSetPurchase(k, v)
                            setEditingPurchase(null)
                          } else if (e.key === 'Escape') setEditingPurchase(null)
                        }}
                        onBlur={() => setEditingPurchase(null)}
                      />
                    </span>
                  ) : purchase ? (
                    <button
                      className="purchase-line-btn"
                      title="Edit what you paid"
                      onClick={() => { setPurchaseInput(String(purchase.price)); setEditingPurchase(k) }}
                    >
                      <span className="purchase-cond-label">{k}</span>
                      <span>paid ${purchase.price.toFixed(2)}</span>
                      <span className="purchase-arrow">→</span>
                      <span className="purchase-now">${market.toFixed(2)}</span>
                      {diff !== null && (
                        <span className={diff >= 0 ? 'purchase-gain' : 'purchase-loss'}>
                          {diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}
                          {pct !== null && (
                            pct === Infinity ? ' (∞%)' : ` (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`
                          )}
                        </span>
                      )}
                    </button>
                  ) : (
                    <button
                      className="purchase-line-btn add"
                      title="Log what you paid"
                      onClick={() => { setPurchaseInput(''); setEditingPurchase(k) }}
                    >
                      <span className="purchase-cond-label">{k}</span> + log what you paid
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
