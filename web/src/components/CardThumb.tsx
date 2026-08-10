/**
 * The one card thumbnail: holo shimmer (via .thumb-wrap.holo, from
 * lib/rarity's isHolo) and a price ribbon in the corner. Every place that
 * renders a card image should use this instead of a bare <img>, so a card
 * looks the same everywhere — CardTile used to be the only place with this
 * treatment; everywhere else (Trade Analyzer, binder/convention pickers,
 * the Spaces box-open view) showed a flat, unpriced thumbnail instead.
 *
 * USED BY: CardTile, SpacesLivePage, AnalyzerPage, BinderViewPage, ConventionModePage
 */

import { basePrice } from '../lib/conditions'
import { isHolo } from '../lib/rarity'
import type { PreviewOpts } from './CardPreview'
import type { Card } from '../types'

/** Structurally matches usePreview()'s return (and CardTile's plain
 *  onPreview callback, adapted) — whichever a caller already has on hand. */
interface PreviewControls {
  show: (src: string, opts?: PreviewOpts) => void
  hide: () => void
}

interface Props {
  card: Card
  /** Selected print variant (Reverse Holo, etc.) — affects both the ribbon price and the zoomed preview's price. */
  variant?: string
  /** The zoom-preview controller — wires hover/click to the big holo-aware, priced preview. Omit for a static, non-interactive thumb. */
  preview?: PreviewControls
  /** Overrides the click behavior (default: open the preview) — e.g. "place this card here" in a picker grid. Hover-to-preview still works either way. */
  onClick?: () => void
  /** False hides the ribbon even when there's a price — rare; most places want it. */
  showPrice?: boolean
  className?: string
}

export function CardThumb({ card, variant, preview, onClick, showPrice = true, className }: Props) {
  if (!card.images?.small) {
    // Still needs a working onClick — a missing image is no reason for a
    // picker/quick-add tile to silently stop being clickable.
    return (
      <div
        className={'thumb-placeholder' + (className ? ' ' + className : '')}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        🃏
      </div>
    )
  }

  const price = basePrice(card, variant)
  const holo = isHolo(card.rarity)
  const show = () => preview?.show(card.images.large || card.images.small, { holo, price })
  const hide = () => preview?.hide()

  return (
    <div className={'thumb-wrap' + (holo ? ' holo' : '') + (className ? ' ' + className : '')}>
      <img
        className="thumb" src={card.images.small} alt={card.name} loading="lazy"
        tabIndex={preview ? 0 : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={preview ? show : undefined}
        onBlur={preview ? hide : undefined}
        onClick={onClick ?? show}
      />
      {showPrice && price > 0 && <span className="price-ribbon">${price.toFixed(2)}</span>}
    </div>
  )
}
