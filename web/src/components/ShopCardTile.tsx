/**
 * ShopCardTile — a card in the public shop, drawn exactly like the collection's
 * CardTile (same classes: picture left, name/set/number/artist/price beside it,
 * condition badges underneath, −/qty/+ stepper) but for a BUYER: the badges pick
 * which owned copy to look at, and the stepper puts copies of it in the request.
 * None of the owner's controls (log what you paid, binder, price history) appear.
 * Stateless apart from which condition badge is selected; the parent owns the cart.
 *
 * USED BY: ShopPage
 * DEPENDS ON: CardThumb, lib/conditions (shares CardTile's styling)
 */

import { useState } from 'react'
import { CardThumb } from './CardThumb'
import type { PreviewOpts } from './CardPreview'
import { CONDS, baseCond, condLabel, condPrice } from '../lib/conditions'
import type { Card } from '../types'

/** One owned copy-type of the card: its condition key (e.g. "NM", "LP", "NM · reverse") and how many are for sale. */
export interface ShopCond { cond: string; qty: number }

interface Props {
  card: Card
  conds: ShopCond[]
  setName?: string
  /** How many of this condition are already in the buyer's request. */
  inCart: (cond: string) => number
  onAdj: (cond: string, delta: number) => void
  preview: { show: (src: string, opts?: PreviewOpts) => void; hide: () => void }
  /** The seller's photo addresses (front/back) for one condition of this card, if any. */
  photos?: (cond: string) => { front?: string; back?: string }
  /** Seller only: opens the photo screen for one condition. Omitted for buyers. */
  onManagePhotos?: (cond: string) => void
}

const money = (n: number) => '$' + n.toFixed(2)

export function ShopCardTile({ card, conds, setName, inCart, onAdj, preview, photos, onManagePhotos }: Props) {
  // Best condition first (NM→DMG), so the headline price is the best copy's.
  const ordered = [...conds].sort((a, b) => CONDS.indexOf(baseCond(a.cond)) - CONDS.indexOf(baseCond(b.cond)) || a.cond.localeCompare(b.cond))
  const [sel, setSel] = useState(ordered[0]?.cond ?? 'NM')
  const current = ordered.find(c => c.cond === sel) ?? ordered[0]
  if (!current) return null

  const price = condPrice(card, current.cond)
  const picked = inCart(current.cond)
  const totalPicked = ordered.reduce((n, c) => n + inCart(c.cond), 0)
  const pics = photos?.(current.cond) ?? {}
  const hasPics = !!(pics.front || pics.back)

  return (
    <div className={`pcard owned${totalPicked > 0 ? ' selected' : ''} ${baseCond(current.cond)}`}>
      <div className="pcard-top">
        {/* The ribbon on the picture shows the selected condition's price, like the zoom does. */}
        <CardThumb card={{ ...card, variants: undefined, prices: price > 0 ? { nm: price } : undefined }} preview={preview} />
        <div className="cinfo">
          <div className="cname" title={card.name}>{card.name}</div>
          {setName && <div className="cmeta cset" title={setName}>{setName}</div>}
          <div className="cmeta">#{card.number} · {card.rarity || '?'}</div>
          <div className="cmeta" style={{ opacity: 0.6 }}>{card.artist ? '✏ ' + card.artist : ''}</div>
          <div className={'cprice' + (price === 0 ? ' no-price' : '')}>{price > 0 ? money(price) : 'Ask for price'}</div>
          <div className="cmeta">{current.qty} available</div>
          <div className="qty-row">
            <button className="qbtn" disabled={picked === 0} onClick={() => onAdj(current.cond, -1)} aria-label={`Remove one ${condLabel(current.cond)}`}>−</button>
            <input className={'qty' + (picked > 0 ? ' has-qty' : '')} type="number" value={picked} readOnly
              aria-label={`${card.name} ${condLabel(current.cond)} in your request`} />
            <button className="qbtn" disabled={picked >= current.qty} onClick={() => onAdj(current.cond, 1)} aria-label={`Add one ${condLabel(current.cond)}`}>+</button>
          </div>
        </div>
      </div>
      <div className="cond-section">
        <div className="cond-row">
          {ordered.map(c => {
            const n = inCart(c.cond)
            return (
              <span key={c.cond} className={`cbtn ${baseCond(c.cond)} has-count${c.cond === current.cond ? ' sel' : ''}`}
                role="button" tabIndex={0} title={`${condLabel(c.cond)} — ${c.qty} available`}
                onClick={() => setSel(c.cond)} onKeyDown={e => { if (e.key === 'Enter') setSel(c.cond) }}>
                <span className="cbtn-label">{condLabel(c.cond)}</span>
                <span className="cbtn-count">{n > 0 ? `${n}/${c.qty}` : c.qty}</span>
              </span>
            )
          })}
        </div>
        {(hasPics || onManagePhotos) && (
          <div className="shop-photos">
            {(['front', 'back'] as const).map(s => pics[s] && (
              <button key={s} type="button" className="photo-frame" title={`Zoom in: ${s} photo`} onClick={() => preview.show(pics[s]!)}>
                <img src={pics[s]} alt={`${s} photo of the card`} loading="lazy" />
                <span>{s === 'front' ? 'Front' : 'Back'}</span>
              </button>
            ))}
            {onManagePhotos && (
              <button type="button" className="tb-btn photo-add" onClick={() => onManagePhotos(current.cond)}>
                📷 {hasPics ? 'Photos' : 'Add photos'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
