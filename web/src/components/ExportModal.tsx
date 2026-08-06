/**
 * "⬇ Export CSV" dialog. Three export scopes (my whole collection / this
 * set / a binder), all producing the same CSV columns. Card data is
 * always pulled fresh from the backend rather than reused from whatever's
 * on screen, so a row is never blank just because a card wasn't already loaded.
 *
 * UNUSED: nothing currently imports this component — CollectionPage.tsx
 * implements CSV export inline instead. Kept for reference.
 *
 * USED BY: (none — see above)
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCards } from '../api/cards'
import { getCollection, getOwnedCards } from '../api/collection'
import { listBinders, getBinder } from '../api/binders'
import { downloadCSV } from '../lib/csv'
import { condPrice, fromCondList, totalQty, type CondMap } from '../lib/conditions'
import { useToast } from './Toast'
import type { Card } from '../types'

type Scope = 'collection' | 'set' | 'binder'

interface Props {
  open:            boolean
  onClose:         () => void
  userId:          string
  username:        string
  /** null in all-sets mode — disables the "This set" option. */
  selectedSetId:   string | null
  selectedSetName?: string
}

const HEADER: (string | number)[] = [
  'Card ID', 'Name', 'Set', 'Number', 'Rarity',
  'Condition', 'Quantity', 'Market Price', 'Total Value',
]

function ownedRows(card: Card, conds: CondMap): (string | number)[][] {
  const rows: (string | number)[][] = []
  for (const [cond, qty] of Object.entries(conds)) {
    if (qty <= 0) continue
    const p = condPrice(card, cond)
    rows.push([
      card.id, card.name, card.setId, card.number, card.rarity ?? '',
      cond, qty, p.toFixed(2), (p * qty).toFixed(2),
    ])
  }
  return rows
}

/** Checklist row for an unowned card — qty 0, no condition. */
function unownedRow(card: Card): (string | number)[] {
  const p = condPrice(card, 'NM')
  return [card.id, card.name, card.setId, card.number, card.rarity ?? '', '', 0, p.toFixed(2), '0.00']
}

export function ExportModal({ open, onClose, userId, username, selectedSetId, selectedSetName }: Props) {
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('collection')
  const [includeUnowned, setIncludeUnowned] = useState(true)
  const [binderId, setBinderId] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: binders = [] } = useQuery({
    queryKey: ['binders', userId],
    queryFn: () => listBinders(userId),
    enabled: open && !!userId,
  })

  if (!open) return null

  const today = new Date().toISOString().slice(0, 10)

  const run = async () => {
    setBusy(true)
    try {
      const rows: (string | number)[][] = [HEADER]
      let filename = `pokemon_export_${today}.csv`

      if (scope === 'collection') {
        const owned = await getOwnedCards(userId)
        for (const o of owned) rows.push(...ownedRows(o.card, fromCondList(o.conditions)))
        filename = `pokemon_collection_${username}_${today}.csv`

      } else if (scope === 'set') {
        if (!selectedSetId) { toast('Pick a set first.'); return }
        const [cards, entries] = await Promise.all([
          getCards(selectedSetId),
          getCollection(userId),
        ])
        const condsByCard = new Map(entries.map(e => [e.cardId, fromCondList(e.conditions)]))
        for (const card of cards) {
          const conds = condsByCard.get(card.id) ?? {}
          if (totalQty(conds) > 0) rows.push(...ownedRows(card, conds))
          else if (includeUnowned) rows.push(unownedRow(card))
        }
        filename = `pokemon_set_${selectedSetId}_${today}.csv`

      } else {
        if (!binderId) { toast('Pick a binder first.'); return }
        const [binder, owned] = await Promise.all([
          getBinder(userId, binderId),
          getOwnedCards(userId),
        ])
        const inBinder = new Set(
          binder.slots.map(s => s.cardId).filter((id): id is string => !!id),
        )
        for (const o of owned)
          if (inBinder.has(o.cardId)) rows.push(...ownedRows(o.card, fromCondList(o.conditions)))
        const safeName = binder.name.replace(/[^\w.-]+/g, '_')
        filename = `pokemon_binder_${safeName}_${today}.csv`
      }

      if (rows.length === 1) { toast('Nothing to export for that selection.'); return }

      downloadCSV(filename, rows)
      toast(`Exported ${rows.length - 1} rows.`)
      onClose()
    } catch {
      toast('Export failed — could not reach the backend.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>⬇ EXPORT CSV</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" name="export-scope" checked={scope === 'collection'} onChange={() => setScope('collection')} />
            My whole collection <span style={{ color: 'var(--muted)', fontSize: 12 }}>(everything you own)</span>
          </label>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            cursor: selectedSetId ? 'pointer' : 'not-allowed', opacity: selectedSetId ? 1 : 0.5,
          }}>
            <input
              type="radio" name="export-scope" disabled={!selectedSetId}
              checked={scope === 'set'} onChange={() => setScope('set')}
            />
            This set {selectedSetName
              ? <b>· {selectedSetName}</b>
              : <span style={{ color: 'var(--muted)', fontSize: 12 }}>(pick a set first)</span>}
          </label>

          {scope === 'set' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 26, fontSize: 13 }}>
              <input type="checkbox" checked={includeUnowned} onChange={e => setIncludeUnowned(e.target.checked)} />
              Include cards I don't own <span style={{ color: 'var(--muted)' }}>(full checklist)</span>
            </label>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" name="export-scope" checked={scope === 'binder'} onChange={() => setScope('binder')} />
            A binder
          </label>

          {scope === 'binder' && (
            <select
              value={binderId} onChange={e => setBinderId(e.target.value)}
              style={{ marginLeft: 26, maxWidth: 260 }}
            >
              <option value="">Choose a binder…</option>
              {binders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>

        <div className="modal-btns">
          <button className="tb-btn" onClick={onClose}>Cancel</button>
          <button className="tb-btn primary" onClick={run} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
