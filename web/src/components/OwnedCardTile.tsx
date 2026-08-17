/**
 * One tile in any "pick a card from what you own" grid — box "Available
 * owned copies", Trade Analyzer's Quick Add, the binder card picker. Same
 * CardThumb (holo shimmer, price ribbon, hover-zoom) plus a visible name
 * and a caller-supplied subtitle (condition/quantity/etc.), so a card
 * never shrinks down to "just a tiny unlabeled thumbnail" in any of these
 * three places — they'd drifted apart before this, each with its own
 * smaller, name-less version.
 *
 * USED BY: SpacesLivePage (BoxInventory), AnalyzerPage, BinderViewPage
 */

import { CardThumb } from './CardThumb'
import type { PreviewOpts } from './CardPreview'
import type { Card } from '../types'

interface PreviewControls {
  show: (src: string, opts?: PreviewOpts) => void
  hide: () => void
}

interface Action {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface Props {
  card: Card
  variant?: string
  preview?: PreviewControls
  /** e.g. "NM · standard · 4 available", "LP · 1st Ed · ×2 owned" */
  subtitle: string
  /** 0 actions = purely informational tile. 1 = full-width button
   *  (.box-card-add). 2+ = side-by-side row (.box-card-tile-actions). */
  actions?: Action[]
  selected?: boolean
  /** Renders a corner checkbox synced to `selected` — bulk-select mode for
   *  multi-card actions (e.g. a box's "Move selected"). Omit for tiles that
   *  aren't part of a selectable group. */
  onToggleSelect?: () => void
  className?: string
}

export function OwnedCardTile({ card, variant, preview, subtitle, actions = [], selected, onToggleSelect, className }: Props) {
  return (
    <div className={'box-card-tile' + (selected ? ' selected' : '') + (className ? ' ' + className : '')}>
      {onToggleSelect && (
        // stopPropagation: this tile's own click (hover-preview/etc.) shouldn't
        // also fire when the user's just trying to check the box.
        <label className="box-card-select" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={!!selected} onChange={onToggleSelect} />
        </label>
      )}
      <CardThumb card={card} variant={variant} preview={preview} />
      <b>{card.name}</b>
      <small>{subtitle}</small>
      {actions.length === 1 && (
        <button className="box-card-add" onClick={actions[0].onClick} disabled={actions[0].disabled}>
          {actions[0].label}
        </button>
      )}
      {actions.length > 1 && (
        <div className="box-card-tile-actions">
          {actions.map((a, i) => (
            <button key={i} onClick={a.onClick} disabled={a.disabled}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
