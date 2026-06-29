/**
 * FILE: ExportModal.tsx
 * LOCATION: src/components/ExportModal.tsx
 *
 * PURPOSE:
 *   The "⬇ Export CSV" dialog. Lets the user choose WHAT to export:
 *     • My collection — every card owned across all sets
 *     • This set      — the selected set's cards, with their owned quantities;
 *                       optionally including cards they don't own (full checklist)
 *     • A binder      — the owned cards placed in one binder
 *   Every scope produces the same CSV column layout and triggers a download.
 *   Card data (name/number/rarity/price) is pulled fresh from the backend so a
 *   row is never blank — unlike the old export, which only knew the cards of the
 *   set currently loaded in the grid.
 *
 * IMPORTS EXPLAINED:
 *   useState              — dialog state (scope, owned-only toggle, chosen binder, busy)
 *   useQuery              — load the user's binders for the binder dropdown
 *   getCards              — a set's full card list (for the set export)
 *   getCollection         — raw entries, read to attach quantities to set cards
 *   getOwnedCards         — every owned card with full card data (collection/binder)
 *   listBinders/getBinder — binder list for the picker + one binder's slots
 *   downloadCSV           — Blob-based CSV download helper
 *   conditions helpers    — per-condition price, condition-list→map, quantity total
 *   useToast              — success / error feedback
 *
 * USED BY: CollectionPage
 * DEPENDS ON: GET /api/cards/:setId, /api/collection/:userId,
 *             /api/collection/:userId/owned, /api/binders/:userId(/:binderId)
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'      // load binders for the picker
import { getCards } from '../api/cards'
import { getCollection, getOwnedCards } from '../api/collection'
import { listBinders, getBinder } from '../api/binders'
import { downloadCSV } from '../lib/csv'
import { condPrice, fromCondList, totalQty, type CondMap } from '../lib/conditions'
import { useToast } from './Toast'
import type { Card } from '../types'

/** What universe of cards to export. */
type Scope = 'collection' | 'set' | 'binder'

interface Props {
  open:            boolean
  onClose:         () => void
  userId:          string
  username:        string
  /** The set selected in the page, or null in all-sets mode (set export disabled). */
  selectedSetId:   string | null
  selectedSetName?: string
}

/** Fixed CSV column order, shared by every export scope. */
const HEADER: (string | number)[] = [
  'Card ID', 'Name', 'Set', 'Number', 'Rarity',
  'Condition', 'Quantity', 'Market Price', 'Total Value',
]

/**
 * PURPOSE: One CSV row per owned condition of a card (quantity > 0).
 * @param card   The full card, for name/number/price
 * @param conds  condition-key → quantity map for this card
 * @return       Zero or more rows (empty when nothing is owned)
 */
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

/**
 * PURPOSE: A checklist row for a card the user does NOT own — quantity 0, no
 *   condition. Used by the set export when "include cards I don't own" is on.
 * @param card  The full card
 * @return      A single zero-quantity row
 */
function unownedRow(card: Card): (string | number)[] {
  const p = condPrice(card, 'NM')
  return [card.id, card.name, card.setId, card.number, card.rarity ?? '', '', 0, p.toFixed(2), '0.00']
}

export function ExportModal({ open, onClose, userId, username, selectedSetId, selectedSetName }: Props) {
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('collection')
  // Set export only: include cards the user doesn't own (a full set checklist).
  const [includeUnowned, setIncludeUnowned] = useState(true)
  const [binderId, setBinderId] = useState('')
  const [busy, setBusy] = useState(false)

  // Binders for the picker — only fetched while the dialog is open.
  const { data: binders = [] } = useQuery({
    queryKey: ['binders', userId],
    queryFn: () => listBinders(userId),
    enabled: open && !!userId,
  })

  if (!open) return null

  const today = new Date().toISOString().slice(0, 10)

  /**
   * PURPOSE: Gather data for the chosen scope, build the CSV rows, and download.
   *   Leaves the dialog open on an empty result so the user can adjust the scope.
   */
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
        // Set card list + the user's quantities, joined by card id.
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
        // A binder's owned cards = its placed card ids ∩ the user's owned cards.
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
          {/* Whole collection — everything owned across all sets */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="radio" name="export-scope" checked={scope === 'collection'} onChange={() => setScope('collection')} />
            My whole collection <span style={{ color: 'var(--muted)', fontSize: 12 }}>(everything you own)</span>
          </label>

          {/* One set — with optional unowned checklist rows */}
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

          {/* One binder */}
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
