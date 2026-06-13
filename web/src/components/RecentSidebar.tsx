/**
 * FILE: RecentSidebar.tsx
 * LOCATION: src/components/RecentSidebar.tsx
 *
 * PURPOSE:
 *   The "Recently Added" panel from the old tracker. Every quick-add or +
 *   during the session lands here; entries can be checked and pushed into a
 *   binder's first empty slots ("Add selected" / "Add all"). Rows that were
 *   successfully placed are removed from the list, like the old page did.
 *
 *   Selection is keyed by each row's uid — a stable id minted when the row
 *   is created — never by list position, so checkmarks stay on the right
 *   card as rows are added and removed.
 *
 * USED BY: CollectionPage
 * DEPENDS ON: api/binders, lib/conditions, components/Toast
 */
import { useEffect, useState } from 'react'
import { getBinder, listBinders, setSlot } from '../api/binders'
import { baseCond } from '../lib/conditions'
import { useToast } from './Toast'
import type { Binder, Card } from '../types'

/** One sidebar row: a stable id, the card, its condition, its price. */
export interface SessionCard {
  uid: string      // stable per-row id (same card can appear twice)
  card: Card
  condKey: string
  price: number
}

interface Props {
  userId: string
  open: boolean
  items: SessionCard[]
  onClose: () => void
  /** Remove one row by its uid (the ✕ button). */
  onRemove: (uid: string) => void
  /** Remove several rows at once — called with the uids actually placed. */
  onRemoveMany: (uids: string[]) => void
  onClear: () => void
}

export function RecentSidebar({ userId, open, items, onClose, onRemove, onRemoveMany, onClear }: Props) {
  const toast = useToast()
  const [binders, setBinders] = useState<Binder[]>([])
  const [binderId, setBinderId] = useState('')
  // Checked rows, by uid. Uids of removed rows simply never match again,
  // so no pruning state-sync is needed.
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Load the binder list whenever the panel opens (picks up new binders).
  useEffect(() => {
    if (open) listBinders(userId).then(setBinders).catch(() => {})
  }, [open, userId])

  // How many checked rows still exist in the list.
  const checkedCount = items.filter(sc => checked.has(sc.uid)).length

  const toggle = (uid: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid); else next.add(uid)
      return next
    })

  /**
   * Push the given rows into the chosen binder's first empty slots,
   * then remove the placed rows from the session list.
   * @param uids  The rows to place, in list order
   */
  const addToBinder = async (uids: string[]) => {
    const rows = items.filter(sc => uids.includes(sc.uid))
    if (!binderId || rows.length === 0) return
    setBusy(true)
    try {
      const binder = await getBinder(userId, binderId)
      // The backend stores slots sparsely — only filled slots come back.
      // An "empty" slot is any index not occupied by a card, counting up
      // from 0. The backend allows indexes 0–1999.
      const used = new Set(binder.slots.filter(s => s.cardId).map(s => s.slotIndex))
      const empty: number[] = []
      for (let i = 0; i < 2000 && empty.length < rows.length; i++) {
        if (!used.has(i)) empty.push(i)
      }
      if (empty.length < rows.length) {
        toast(`Only ${empty.length} empty slot${empty.length === 1 ? '' : 's'} left in that binder.`)
      }
      const placed: string[] = []
      for (let i = 0; i < Math.min(rows.length, empty.length); i++) {
        const sc = rows[i]
        await setSlot(userId, binderId, empty[i], {
          cardId: sc.card.id,
          cardName: sc.card.name,
          imageUrl: sc.card.images?.small,
        })
        placed.push(sc.uid)
      }
      toast(`Added ${placed.length} card${placed.length === 1 ? '' : 's'} to ${binder.name}.`)
      // The old page removed placed cards from the session list — same here.
      onRemoveMany(placed)
      setChecked(prev => new Set([...prev].filter(uid => !placed.includes(uid))))
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
            disabled={!binderId || checkedCount === 0 || busy}
            onClick={() => addToBinder(items.filter(sc => checked.has(sc.uid)).map(sc => sc.uid))}
          >
            {busy ? 'Adding…' : 'Add selected'}
          </button>
          <button
            className="sb-add-btn"
            style={{ flex: 1, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}
            disabled={!binderId || items.length === 0 || busy}
            onClick={() => addToBinder(items.map(sc => sc.uid))}
          >
            {busy ? 'Adding…' : 'Add all'}
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="sb-sel-row">
          <button className="sb-sel-all" onClick={() => setChecked(new Set(items.map(sc => sc.uid)))}>Select all</button>
          <button className="sb-sel-all" onClick={() => setChecked(new Set())}>Deselect all</button>
          <span className="sb-sel-count">{checkedCount > 0 ? `${checkedCount} selected` : ''}</span>
        </div>
      )}
      <div className="sb-list">
        {items.length === 0 && <div className="sb-empty">Cards you quick-add will appear here</div>}
        {items.map(sc => (
          <div key={sc.uid} className={'sb-item' + (checked.has(sc.uid) ? ' checked' : '')} onClick={() => toggle(sc.uid)}>
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
              onClick={e => { e.stopPropagation(); onRemove(sc.uid) }}
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
