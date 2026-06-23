/**
 * FILE: BinderPickerModal.tsx
 * LOCATION: src/components/BinderPickerModal.tsx
 *
 * PURPOSE:
 *   One-click "add this card to a binder" popup. Replaces the multi-step
 *   quick-add → Recently Added sidebar → select binder → Add all flow.
 *   Shows every binder the user owns as a clickable button; clicking one
 *   immediately finds the first empty slot and places the card there, then
 *   closes. Opened by the "Add to binder" button on each CardTile.
 *
 * IMPORTS EXPLAINED:
 *   useEffect/useState  — load binder list when modal opens, track busy state
 *   getBinder           — fetch one binder with its full slot list so we can
 *                         find the first empty slot index (0-1999)
 *   listBinders         — fetch all binders for the user to populate the list
 *   setSlot             — place the card into the chosen slot
 *   useToast            — success / error feedback without blocking the UI
 *   Binder, Card        — type-only imports; no runtime cost
 *
 * USED BY: CollectionPage
 * DEPENDS ON: api/binders, components/Toast
 */
import { useEffect, useState } from 'react'
import { getBinder, listBinders, setSlot } from '../api/binders'
import { useToast } from './Toast'
import type { Binder, Card } from '../types'

/**
 * INTERFACE: Props
 * PURPOSE:
 *   card     — the card to place; null means the modal is closed (renders nothing)
 *   userId   — whose binders to list and write to
 *   onClose  — called after a successful add or when the user cancels
 */
interface Props {
  card: Card | null
  userId: string
  onClose: () => void
}

/**
 * COMPONENT: BinderPickerModal
 * PURPOSE:
 *   Renders as a modal overlay listing the user's binders.  Clicking a binder
 *   button calls addTo(), which:
 *     1. Fetches the binder's current slot occupancy via getBinder()
 *     2. Finds the lowest-index empty slot (not already holding a cardId)
 *     3. Writes the card to that slot via setSlot()
 *   Returns null (renders nothing) when card prop is null so the caller can
 *   always mount it unconditionally and toggle it by setting card to null.
 */
export function BinderPickerModal({ card, userId, onClose }: Props) {
  const toast = useToast()
  const [binders, setBinders] = useState<Binder[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * PURPOSE: Reload the binder list each time the modal opens (card changes
   * from null to a value).  This picks up any binders created since last open.
   */
  useEffect(() => {
    if (!card) return
    setLoading(true)
    listBinders(userId)
      .then(setBinders)
      .catch(() => toast('Could not load binders.'))
      .finally(() => setLoading(false))
  }, [card, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!card) return null

  /**
   * PURPOSE: Place card in the first empty slot of the chosen binder.
   *   Empty slot = any index 0–1999 not currently occupied by a cardId.
   *   The backend stores slots sparsely, so we scan the returned slot list
   *   to find which indexes are taken and pick the lowest free one.
   * @param binderId    The binder to write to
   * @param binderName  Display name for the success toast
   */
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

        {loading && <p style={{ color: 'var(--muted)' }}>Loading binders…</p>}

        {!loading && binders.length === 0 && (
          <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
            No binders yet — create one on the <b>Binders</b> page.
          </p>
        )}

        {!loading && binders.length > 0 && (
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
