/**
 * One card in the collection grid — thumbnail (hover = big preview),
 * name/number/rarity/artist, price line, −/qty/+ stepper for the selected
 * condition, condition badges with per-condition counts, and a breakdown
 * row with per-condition values. Stateless: the parent owns all counts
 * and calls the backend; this tile just renders and reports what the
 * user clicked.
 *
 * USED BY: CollectionPage, BulkAddPage
 */

import { useState } from 'react'
import { getPriceHistory } from '../api/cards'
import { CardThumb } from './CardThumb'
import type { PreviewOpts } from './CardPreview'
import { CONDS, COND_COLORS, baseCond, basePrice, cardValue, condPrice, dominantCondClass, totalQty, type CondMap, type PurchaseMap } from '../lib/conditions'
import type { Card, PriceHistoryPoint } from '../types'

interface Props {
  card: Card
  conds: CondMap
  /** Which condition the qty stepper currently edits. */
  selCond: string
  onAdj: (delta: number) => void
  onSetQty: (qty: number) => void
  onSelectCond: (cond: string) => void
  /** Right-click on a condition badge — decrements that condition by 1. */
  onAdjCond: (cond: string, delta: number) => void
  /** Hover shows/hides the big preview; `opts` carries holo/price so the zoom matches the tile. */
  onPreview: (src: string | null, opts?: PreviewOpts) => void
  /** If given, a "To binder" button shows and calls this with the card. */
  onAddToBinder?: (card: Card) => void
  purchases?: PurchaseMap
  /** If given, each owned condition gets a "log what you paid" control. */
  onSetPurchase?: (cond: string, price: number) => void
  /** Which set this card is from, shown on the tile — only meaningful (and
   *  only passed) where a grid can mix cards from more than one set: cross-set
   *  search/browse, and the bulk-add session list. Browsing one set already
   *  says its name once in the banner above the grid, so tiles there leave
   *  this unset rather than repeating it on every single card. */
  setName?: string
}

/**
 * Gain/loss vs. purchase price. $0 paid but a real market value now shows
 * as Infinity rather than being hidden — a genuinely infinite return, not
 * a missing value.
 */
function gainLossPct(paid: number, market: number): number | null {
  if (market <= 0) return null
  if (paid <= 0) return market > 0 ? Infinity : null
  return ((market - paid) / paid) * 100
}

export function CardTile({ card, conds, selCond, onAdj, onSetQty, onSelectCond, onAdjCond, onPreview, onAddToBinder, purchases, onSetPurchase, setName }: Props) {
  const [editingPurchase, setEditingPurchase] = useState<string | null>(null)
  const [purchaseInput, setPurchaseInput] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<PriceHistoryPoint[] | null>(null)
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle')

  // undefined = default print. Only cards with priced alternates
  // (Reverse Holo, Poké/Master Ball Pattern) show a variant picker at all.
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(undefined)

  const otherVariants = (card.variants ?? []).filter(v =>
    v.name !== 'Normal' && (v.prices.nm || v.prices.lp || v.prices.mp || v.prices.hp || v.prices.dmg)
  )

  const toggleHistory = () => {
    setHistoryOpen(open => {
      const next = !open
      // Fetch on first open only, not on every toggle.
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
  // Headline price follows whichever condition is actually selected (defaults
  // to NM), not always NM — otherwise adding e.g. an LP copy shows the NM
  // price up top while the Details breakdown below shows the real LP price,
  // which reads as a bug even though both numbers are individually correct.
  const price = condPrice(card, selCond, selectedVariant) || basePrice(card, selectedVariant)
  const priceStr = price > 0
    ? '$' + price.toFixed(2) + (qty > 1 ? ' · $' + cardValue(conds, card, selectedVariant).toFixed(2) : '')
    : 'no price'
  const selQty = conds[selCond] ?? 0
  const value = cardValue(conds, card, selectedVariant)

  // NM→LP→MP→HP→DMG order, "1st Ed" right after its plain version.
  const ownedKeys = Object.keys(conds)
    .filter(k => conds[k] > 0)
    .sort((a, b) => CONDS.indexOf(baseCond(a)) - CONDS.indexOf(baseCond(b)) || a.length - b.length)

  return (
    <div className={`pcard${qty > 0 ? ' owned' : ''} ${dominantCondClass(conds)}`}>
      <div className="pcard-top">
        <CardThumb
          card={card} variant={selectedVariant}
          preview={{ show: onPreview, hide: () => onPreview(null) }}
        />
        <div className="cinfo">
          <div className="cname" title={card.name}>{card.name}</div>
          {setName && <div className="cmeta cset" title={setName}>{setName}</div>}
          <div className="cmeta">#{card.number} · {card.rarity || '?'}</div>
          <div className="cmeta" style={{ opacity: 0.6 }}>{card.artist ? '✏ ' + card.artist : ''}</div>
          <div className={'cprice' + (price === 0 ? ' no-price' : '')}>
            {priceStr}
            <button className="history-toggle" title="Price history" onClick={toggleHistory}>📈</button>
          </div>

          {otherVariants.length > 0 && (
            <div className="variant-row" title="This card has priced alternate prints">
              <button
                className={'variant-chip' + (!selectedVariant ? ' sel' : '')}
                onClick={() => setSelectedVariant(undefined)}
              >Normal</button>
              {otherVariants.map(v => (
                <button
                  key={v.name}
                  className={'variant-chip' + (selectedVariant === v.name ? ' sel' : '')}
                  onClick={() => setSelectedVariant(v.name)}
                >{v.name}</button>
              ))}
            </div>
          )}

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
              {historyState === 'idle' && history !== null && history.length === 1 && (
                <p className="history-msg">
                  Only one snapshot so far — {new Date(history[0].recordedAt).toLocaleDateString()}
                  {' · NM '}{history[0].nm != null ? '$' + history[0].nm.toFixed(2) : '—'}.
                  Check back after this card's price refreshes again to see a trend.
                </p>
              )}
              {historyState === 'idle' && history !== null && history.length > 1 && (() => {
                // Only the last 5 — a full unbounded history is more than useful in a small popover.
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
            // Combines a plain condition's count with its "1st Ed" count
            // so e.g. the NM badge reflects both.
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
                {condPrice(card, k, selectedVariant) > 0 && (
                  <span className="cbd-val">${(condPrice(card, k, selectedVariant) * conds[k]).toFixed(2)}</span>
                )}
              </span>
            ))}
            {value > 0 && <span className="cond-total">= ${value.toFixed(2)}</span>}
          </div>
        )}

        {/* Own row, never sharing a line with the market-price breakdown above. */}
        {detailsOpen && onSetPurchase && ownedKeys.length > 0 && (
          <div className="purchase-section">
            {ownedKeys.map(k => {
              const purchase = purchases?.[k]
              const market = condPrice(card, k, selectedVariant)
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
                            if (!isNaN(v) && v >= 0) onSetPurchase(k, v)  // $0 is a valid purchase price (pack pull)
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
