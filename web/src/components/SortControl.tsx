/**
 * SortControl — "Sort: [Artist ▾] [↑ A→Z]": picks a card sort and flips its
 * direction. Picking a new sort resets the direction to that sort's natural
 * one (Value starts high→low, Name starts A→Z…).
 *
 * USED BY: CollectionPage, OwnedPage, SpacesLivePage (BoxInventory), CardBrowser
 */

import { DEFAULT_DIR, SORT_LABELS, type SortDir, type SortKey } from '../lib/cardSort'

/** What the direction button says for each sort. */
function dirLabel(key: SortKey, dir: SortDir): string {
  const asc = dir === 'asc'
  switch (key) {
    case 'value':  return asc ? '↑ Low → high' : '↓ High → low'
    case 'qty':    return asc ? '↑ Fewest first' : '↓ Most first'
    case 'rarity': return asc ? '↑ Commonest first' : '↓ Rarest first'
    case 'set':    return asc ? '↑ Oldest first' : '↓ Newest first'
    case 'recent': return asc ? '↑ Oldest first' : '↓ Newest first'
    case 'number': return asc ? '↑ 1 → 999' : '↓ 999 → 1'
    case 'condition': return asc ? '↑ NM → DMG' : '↓ DMG → NM'
    default:       return asc ? '↑ A → Z' : '↓ Z → A'
  }
}

export function SortControl({ keys, sort, dir, onChange, className = '' }: {
  /** Which sorts this list offers, in menu order. */
  keys: SortKey[]
  sort: SortKey
  dir: SortDir
  onChange: (sort: SortKey, dir: SortDir) => void
  className?: string
}) {
  return (
    <span className={'sort-control ' + className}>
      <select
        value={sort} aria-label="Sort by"
        onChange={e => { const k = e.target.value as SortKey; onChange(k, DEFAULT_DIR[k]) }}
      >
        {keys.map(k => <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>)}
      </select>
      <button
        type="button" className="tb-btn sort-dir"
        title="Reverse the order"
        onClick={() => onChange(sort, dir === 'asc' ? 'desc' : 'asc')}
      >{dirLabel(sort, dir)}</button>
    </span>
  )
}
