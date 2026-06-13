/**
 * FILE: RecentSidebar.tsx
 * LOCATION: src/components/RecentSidebar.tsx
 *
 * PURPOSE:
 *   The "Recently Added" panel from the old tracker. Every quick-add or +
 *   during the session lands here; entries can be checked and pushed into a
 *   binder's first empty slots ("Add selected" / "Add all").
 *
 * USED BY: CollectionPage
 */
import { useEffect, useMemo, useState } from 'react'
import { getBinder, listBinders, setSlot } from '../api/binders'
import { baseCond } from '../lib/conditions'
import { useToast } from './Toast'
import type { Binder, Card } from '../types'

/** One sidebar row: the card, the condition it was added as, its price. */
export interface SessionCard {
  card: Card
  condKey: string
  price: number
}

interface Props {
  userId: string
  open: boolean
  items: SessionCard[]
  onClose: () => void
  onRemove: (idx: number) => void
  onClear: () => void
}

export function RecentSidebar({ userId, open, items, onClose, onRemove, onClear }: Props) {
  const toast = useToast()
  const [binders, setBinders] = useState<Binder[]>([])
  const [binderId, setBinderId] = useState('')
  // Which rows are checked, by index into items.
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  // Load the binder list once the panel first opens.
  useEffect(() => {
    if (open) listBinders(userId).then(setBinders).catch(() => {})
  }, [open, userId])

  // Indexes drift as items are removed — stale checks are filtered out
  // here at render time rather than synced back into state by an effect.
  const validChecked = useMemo(
    () => new Set([...checked].filter(i => i < items.length)),
    [checked, items.length],
  )

  const toggle = (i: number) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })

  /** Push the given rows into the chosen binder's first empty slots. */
  const addToBinder = async (indices: number[]) => {
    if (!binderId || indices.length === 0) return
    setBusy(true)
    try {
      const binder = await getBinder(userId, binderId)
      // The backend stores slots sparsely — only filled slots come back.
      // An "empty" slot is any index not occupied by a card, counting up
      // from 0. The backend allows indexes 0–1999.
      const used = new Set(binder.slots.filter(s => s.cardId).map(s => s.slotIndex))
      const empty: number[] = []
      for (let i = 0; i < 2000 && empty.length < indices.length; i++) {
        if (!used.has(i)) empty.push(i)
      }
      if (empty.length < indices.length) {
        toast(`Only ${empty.length} empty slot${empty.length === 1 ? '' : 's'} left in that binder.`)
      }
      const todo = indices.slice(0, empty.length)
      for (let i = 0; i < todo.length; i++) {
        const sc = items[todo[i]]
        await setSlot(userId, binderId, empty[i], {
          cardId: sc.card.id,
          cardName: sc.card.name,
          imageUrl: sc.card.images?.small,
        })
      }
      toast(`Added ${todo.length} card${todo.length === 1 ? '' : 's'} to ${binder.name}.`)
      setChecked(new Set())
    } catch {
      toast('Could not add to binder — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="sidebar" className={open ? 'open' : ''}>
      <div className="sb-head">
        <div className="sb-title">
          <span>
            Recently Added{' '}
            <span style={{ color: 'var(--accent)', marginLeft: 4 }}>{items.length || ''}</span>
          </span>
          <button className="sb-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="sb-binder-row">
          <label>Binder:</label>
          <select className="sb-binder-sel" value={binderId} onChange={e => setBinderId(e.target.value)}>
            <option value="">— select —</option>
            {binders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="sb-binder-row" style={{ gap: 5 }}>
          <button
            className="sb-add-btn" style={{ flex: 1 }}
            disabled={!binderId || validChecked.size === 0 || busy}
            onClick={() => addToBinder([...validChecked].sort((a, b) => a - b))}
          >
            Add selected
          </button>
          <button
            className="sb-add-btn"
            style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}
            disabled={!binderId || items.length === 0 || busy}
            onClick={() => addToBinder(items.map((_, i) => i))}
          >
            Add all
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="sb-sel-row">
          <button className="sb-sel-all" onClick={() => setChecked(new Set(items.map((_, i) => i)))}>Select all</button>
          <button className="sb-sel-all" onClick={() => setChecked(new Set())}>Deselect all</button>
          <span className="sb-sel-count">{validChecked.size > 0 ? `${validChecked.size} selected` : ''}</span>
        </div>
      )}
      <div className="sb-list">
        {items.length === 0 && <div className="sb-empty">Cards you quick-add will appear here</div>}
        {items.map((sc, i) => (
          <div key={i} className={'sb-item' + (validChecked.has(i) ? ' checked' : '')} onClick={() => toggle(i)}>
            {sc.card.images?.small && <img src={sc.card.images.small} alt="" />}
            <div className="sb-item-info">
              <div className="sb-item-name">{sc.card.name}</div>
              <div className="sb-item-meta">
                <span className={'sb-item-cond ' + baseCond(sc.condKey)}>{sc.condKey}</span>
                <span>#{sc.card.number}</span>
                {sc.price > 0 && <span>${sc.price.toFixed(2)}</span>}
              </div>
            </div>
            <button
              className="sb-item-rm" title="Remove from list"
              onClick={e => { e.stopPropagation(); onRemove(i) }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="sb-footer">
        <span className="sb-count">{items.length} in session</span>
        <button className="sb-clear" onClick={onClear}>Clear list</button>
      </div>
    </div>
  )
}
