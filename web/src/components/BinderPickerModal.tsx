/**
 * One-click "add this card to a binder" popup: shows every binder as a
 * button, clicking one finds the first empty slot and places the card
 * there. Opened by the "Add to binder" button on each CardTile.
 *
 * USED BY: CollectionPage
 */

import { useEffect, useState } from 'react'
import { getBinder, listBinders, setSlot } from '../api/binders'
import { useToast } from './Toast'
import type { Binder, Card } from '../types'

/**
 * @param card    Card to place. `null` closes the modal (kept mounted by
 *                the parent, toggled via this prop rather than unmounted).
 * @param userId  Whose binders to list/write to.
 * @param onClose Called after a successful add or on cancel.
 */
interface Props {
  card: Card | null
  userId: string
  onClose: () => void
}

export function BinderPickerModal({ card, userId, onClose }: Props) {
  const toast = useToast()
  const [binders, setBinders] = useState<Binder[] | null>(null)
  const [busy, setBusy] = useState(false)

  // Re-fetch on every open so binders created since the last open show up.
  useEffect(() => {
    if (!card) return
    listBinders(userId)
      .then(b => setBinders(b))
      .catch(() => { setBinders([]); toast('Could not load binders.') })
  }, [card, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!card) return null

  /** Binders cap at 2000 slots; scans in order for the first unused index. */
  const addTo = async (binderId: string, binderName: string) => {
    setBusy(true)
    try {
      const binder = await getBinder(userId, binderId)
      const used = new Set(binder.slots.filter(s => s.cardId).map(s => s.slotIndex))

      let emptySlot = -1
      for (let i = 0; i < 2000; i++) {
        if (!used.has(i)) { emptySlot = i; break }
      }
      if (emptySlot === -1) { toast(`${binderName} is full.`); setBusy(false); return }

      await setSlot(userId, binderId, emptySlot, {
        cardId: card.id,
        cardName: card.name,
        imageUrl: card.images?.small,
      })
      toast(`Added ${card.name} to ${binderName}.`)
      onClose()
    } catch {
      toast('Could not add to binder — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 340 }}>
        <h3>📒 Add to binder</h3>
        <p style={{ margin: '0 0 16px', fontWeight: 600 }}>
          {card.name}
          <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>
            #{card.number}
          </span>
        </p>

        {binders === null && <p style={{ color: 'var(--muted)' }}>Loading binders…</p>}

        {binders !== null && binders.length === 0 && (
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
            No binders yet — create one on the <b>Shelf</b> page.
          </p>
        )}

        {binders !== null && binders.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {binders.map(b => (
              <button
                key={b.id}
                className="tb-btn"
                style={{ justifyContent: 'flex-start', padding: '10px 14px', textAlign: 'left' }}
                disabled={busy}
                onClick={() => addTo(b.id, b.name)}
              >
                📒 {b.name}
                <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
                  {b.pocketSize}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="modal-btns">
          <button className="tb-btn" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
