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
import { CONDS, COND_COLORS, baseCond, basePrice, cardValue, condPrice, dominantCondClass, totalQty, type CondMap } from '../lib/conditions'
import type { Card } from '../types'

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
  /** Called on image hover — parent shows/hides the large preview overlay. */
  onPreview: (src: string | null) => void
}

export function CardTile({ card, conds, selCond, onAdj, onSetQty, onSelectCond, onAdjCond, onPreview }: Props) {
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
          <img
            className="thumb" src={card.images.small} alt={card.name} loading="lazy"
            onMouseEnter={() => onPreview(card.images.large || card.images.small)}
            onMouseLeave={() => onPreview(null)}
          />
        ) : (
          <div className="thumb-placeholder">🃏</div>
        )}
        <div className="cinfo">
          <div className="cname" title={card.name}>{card.name}</div>
          <div className="cmeta">#{card.number} · {card.rarity || '?'}</div>
          <div className="cmeta" style={{ opacity: 0.6 }}>{card.artist ? '✏ ' + card.artist : ''}</div>
          <div className={'cprice' + (price === 0 ? ' no-price' : '')}>{priceStr}</div>
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
      </div>
    </div>
  )
}
