/**
 * The unified shelf — a wood cabinet of tiles, each either a storage box
 * (drawers of cards, opened in a popup) or a binder (navigates straight to
 * its own page), in one drag-reorderable order shared across both kinds.
 * A sidebar for jump-to-box, and an Unassigned tray for cards not yet
 * filed anywhere, round out the box side of things — binders manage their
 * own card placement on their own page, so they don't participate in
 * card drag/assign here.
 *
 * Drag payloads are labeled by MIME type (CARD_MIME/SHELF_ITEM_MIME/
 * DRAWER_MIME) so a drop target can tell what's being dragged over it —
 * a card, a shelf tile (box or binder, reordering), or a drawer — without
 * inspecting the payload itself. Native HTML5 drag events never fire on
 * touch devices, so every drag interaction here has a tap-based equivalent
 * that calls the same handler: tapping a card (or "Select"-ing a batch of
 * them from Unassigned) opens the "Move to…" picker (movingCardIds), and
 * edit-mode reordering has ‹/› arrow buttons next to the drag handle.
 * Deletes go through an in-app confirm modal (pendingDelete) instead of
 * window.confirm(), which doesn't fit the app's own UI.
 *
 * USED BY: ShelfPage
 */

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createBox, createDrawer, deleteBox, deleteDrawer,
  updateBox, updateDrawer,
} from '../api/storage'
import { createBinder, deleteBinder, updateBinder } from '../api/binders'
import { reorderShelf } from '../api/shelf'
import { boxTheme } from '../lib/boxVariant'
import { useToast } from './Toast'
import { totalQty, type CondMap } from '../lib/conditions'
import type { Card, PocketSize, ShelfEntry, StorageBox, StorageDrawer } from '../types'

const CARD_MIME = 'text/x-card-id'
const SHELF_ITEM_MIME = 'application/x-shelf-item'
const DRAWER_MIME = 'application/x-drawer-id'

const ITEMS_PER_ROW = 3

/** Display number for each backend pocket size, for the create-binder modal. */
const SIZE_NUM: Record<PocketSize, number> = { Four: 4, Nine: 9, Twelve: 12 }
const SIZE_OPTIONS: PocketSize[] = ['Nine', 'Four', 'Twelve']

interface Entry { conds: CondMap; selCond: string }
interface RenameState { kind: 'box' | 'drawer' | 'binder'; id: string }
type UnassignedSort = 'name' | 'set'
type PendingDelete =
  | { kind: 'box'; box: StorageBox }
  | { kind: 'drawer'; drawer: StorageDrawer }
  | { kind: 'binder'; name: string; id: string }

/** A tile's (kind, refId) pair — how shelf ordering and drag payloads identify it. */
const refOf = (item: ShelfEntry) => ({ kind: item.kind, refId: item.kind === 'box' ? item.box.id : item.binder.id })

interface Props {
  userId: string
  cards: Card[]
  coll: Record<string, Entry>
  items: ShelfEntry[]
  /** Card ID -> which drawer it's currently in (only set for assigned cards). */
  drawerOf: Record<string, string>
  /** Card ID -> binder placement, used only to check "is this card placed elsewhere already." */
  binderLocationOf: Record<string, unknown>
  onReloadShelf: () => void
  onSetCardDrawer: (cardId: string, drawerId: string) => Promise<void>
  /** Batched version of onSetCardDrawer — one request for N cards, and the
   *  only path that keeps the parent's drawerOf map in sync for a bulk move. */
  onAssignCards: (cardIds: string[], drawerId: string) => Promise<void>
}

export function CollectionShelf({
  userId, cards, coll, items, drawerOf, binderLocationOf, onReloadShelf, onSetCardDrawer, onAssignCards,
}: Props) {
  const toast = useToast()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [openBoxId, setOpenBoxId] = useState<string | null>(null)

  // Which drop target is currently under a drag, for hover styling.
  const [dropHover, setDropHover] = useState<string | null>(null)
  const [unassignedSort, setUnassignedSort] = useState<UnassignedSort>('name')

  const [creatingBox, setCreatingBox] = useState(false)
  const [newBoxName, setNewBoxName] = useState('')
  const [newBoxDrawers, setNewBoxDrawers] = useState('3')

  const [creatingBinder, setCreatingBinder] = useState(false)
  const [newBinderName, setNewBinderName] = useState('')
  const [newBinderCover, setNewBinderCover] = useState<string | null>(null)
  const [newBinderSize, setNewBinderSize] = useState<PocketSize>('Nine')
  const [binderBusy, setBinderBusy] = useState(false)
  const coverFileRef = useRef<HTMLInputElement>(null)

  const [addingDrawer, setAddingDrawer] = useState(false)
  const [newDrawerName, setNewDrawerName] = useState('')

  const [renaming, setRenaming] = useState<RenameState | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // In-app replacements for the two things that were still "leaving" the
  // app's UI: window.confirm() for deletes, and drag-and-drop (which never
  // fires on touch devices) as the only way to file a card into a drawer.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  // Card IDs currently going through the "Move to…" picker — one card for a
  // tap, several for a bulk "Assign selected" action. Same modal either way.
  const [movingCardIds, setMovingCardIds] = useState<string[] | null>(null)

  // Bulk-file mode for the Unassigned tray: check off a batch of cards, then
  // send them all to one drawer in a single request instead of one at a time.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const boxes = items.filter(i => i.kind === 'box').map(i => i.box)
  const filteredSidebar = boxes.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))

  const sortedItems = [...items].sort((a, b) => a.position - b.position)
  const rows: ShelfEntry[][] = []
  for (let i = 0; i < sortedItems.length; i += ITEMS_PER_ROW) rows.push(sortedItems.slice(i, i + ITEMS_PER_ROW))

  const cardsByDrawer: Record<string, Card[]> = {}
  for (const c of cards) {
    const d = drawerOf[c.id]
    if (d) (cardsByDrawer[d] ??= []).push(c)
  }

  const unassignedCards = cards
    .filter(c => !drawerOf[c.id] && !binderLocationOf[c.id])
    .sort((a, b) => (unassignedSort === 'name' ? a.name.localeCompare(b.name) : a.setId.localeCompare(b.setId)))

  const qtyOf = (cardId: string) => totalQty(coll[cardId]?.conds ?? {})

  const openBox = boxes.find(b => b.id === openBoxId) ?? null

  const submitNewBox = async () => {
    const name = newBoxName.trim()
    const drawerCount = Math.max(0, Math.min(20, parseInt(newBoxDrawers, 10) || 0))

    setCreatingBox(false)
    if (!name) return
    try {
      const box = await createBox(userId, name)
      for (let i = 0; i < drawerCount; i++) await createDrawer(box.id, `Drawer ${i + 1}`)

      setNewBoxName(''); setNewBoxDrawers('3')
      onReloadShelf()
    } catch { toast('Could not create box.') }
  }

  /** Reads the chosen image as a data URL for the cover preview. 5 MB cap,
   *  same as the old binder-shelf create modal this replaces. */
  const handleCover = (file: File | undefined) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB'); return }
    const reader = new FileReader()
    reader.onload = ev => setNewBinderCover(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const submitNewBinder = async () => {
    if (binderBusy) return
    const name = newBinderName.trim() || 'My Binder'
    const cover = newBinderCover
    const size = newBinderSize
    setBinderBusy(true)
    try {
      const binder = await createBinder(userId, name, size)
      if (cover) await updateBinder(userId, binder.id, { coverImage: cover })
      setCreatingBinder(false)
      setNewBinderName(''); setNewBinderCover(null); setNewBinderSize('Nine')
      onReloadShelf()
    } catch { toast('Could not create binder.') } finally { setBinderBusy(false) }
  }

  // `e` is omitted when called from the modal's "Remove box" button rather than a direct click.
  // Opens the in-app confirm modal instead of window.confirm() — see confirmPendingDelete.
  const handleDeleteBox = (box: StorageBox, e?: React.MouseEvent) => {
    e?.stopPropagation() // don't also trigger the slot's own onClick (open box)
    setPendingDelete({ kind: 'box', box })
  }

  const handleDeleteBinder = (item: Extract<ShelfEntry, { kind: 'binder' }>, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPendingDelete({ kind: 'binder', name: item.binder.name, id: item.binder.id })
  }

  // Reorders across BOTH kinds in one shared list, then writes the whole
  // new order in one request — same "client sends full order" shape the
  // box/drawer reorders below already use, just spanning two tables now.
  const reorderShelfItems = async (
    dragged: { kind: string; refId: string },
    target: { kind: string; refId: string },
  ) => {
    const from = sortedItems.findIndex(it => { const r = refOf(it); return r.kind === dragged.kind && r.refId === dragged.refId })
    const to = sortedItems.findIndex(it => { const r = refOf(it); return r.kind === target.kind && r.refId === target.refId })
    if (from === -1 || to === -1 || from === to) return

    const next = [...sortedItems]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)

    try {
      await reorderShelf(userId, next.map((it, i) => ({ ...refOf(it), position: i })))
      onReloadShelf()
    } catch { toast('Could not reorder the shelf.') }
  }

  const startRename = (state: RenameState, current: string) => { setRenaming(state); setRenameValue(current) }

  const submitRename = async () => {
    if (!renaming) return
    const { kind, id } = renaming
    const name = renameValue.trim()
    setRenaming(null)
    if (!name) return
    try {
      if (kind === 'box') await updateBox(id, { name })
      else if (kind === 'drawer') await updateDrawer(id, { name })
      else await updateBinder(userId, id, { name })
      onReloadShelf()
    } catch { toast(`Could not rename ${kind}.`) }
  }

  const submitNewDrawer = async (boxId: string) => {
    const name = newDrawerName.trim()
    setAddingDrawer(false); setNewDrawerName('')
    if (!name) return
    try { await createDrawer(boxId, name); onReloadShelf() }
    catch { toast('Could not create drawer.') }
  }

  const handleDeleteDrawer = (drawer: StorageDrawer) => setPendingDelete({ kind: 'drawer', drawer })

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    try {
      if (target.kind === 'box') {
        await deleteBox(target.box.id)
        if (openBoxId === target.box.id) setOpenBoxId(null)
      } else if (target.kind === 'drawer') {
        await deleteDrawer(target.drawer.id)
      } else {
        await deleteBinder(userId, target.id)
      }
      onReloadShelf()
    } catch {
      toast(target.kind === 'box' ? 'Could not remove box.' : target.kind === 'drawer' ? 'Could not remove drawer.' : 'Could not remove binder.')
    }
  }

  const reorderDrawers = async (box: StorageBox, draggedId: string, targetId: string) => {
    const drawers = [...box.drawers].sort((a, b) => a.position - b.position)
    const from = drawers.findIndex(d => d.id === draggedId)
    const to = drawers.findIndex(d => d.id === targetId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...drawers]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    try {
      await Promise.all(next.map((d, i) => (d.position === i ? null : updateDrawer(d.id, { position: i }))))
      onReloadShelf()
    } catch { toast('Could not reorder drawers.') }
  }

  const dropCardOnDrawer = (cardId: string, drawerId: string) => onAssignCards([cardId], drawerId)

  // Dropping a card straight onto a shelf box (not one of its drawers,
  // which only show up once the box's popup is open) files it into that
  // box's first drawer — the fast path for "just get it in this box."
  const dropCardOnBox = (cardId: string, box: StorageBox) => {
    const drawer = [...box.drawers].sort((a, b) => a.position - b.position)[0]
    if (!drawer) { toast(`${box.name} has no drawers yet — add one first.`); return }
    dropCardOnDrawer(cardId, drawer.id)
  }

  const toggleSelectMode = () => { setSelectMode(m => !m); setSelectedIds(new Set()) }
  const toggleSelected = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Shared by both a single tap (one ID) and "Assign N selected" (many) —
  // one batched request either way, since the backend already accepts an
  // array of card IDs.
  const assignMovingCardsToDrawer = async (drawerId: string) => {
    if (!movingCardIds) return
    const ids = movingCardIds
    setMovingCardIds(null)
    await onAssignCards(ids, drawerId)
    setSelectedIds(new Set())
    setSelectMode(false)
  }

  return (
    <div className="shelf-app">
      <header className="page-head">
        <div className="brand">Poké<span>Tracker</span></div>
        <div className="title">My Collection Shelf</div>
        <div className="tools">
          <button className={'tool' + (editMode ? ' active' : '')} title={editMode ? 'Done editing' : 'Edit layout'} onClick={() => setEditMode(e => !e)}>✎</button>
          <button className="tool" title="Add a box" onClick={() => setCreatingBox(true)}>⊕</button>
        </div>
      </header>

      <main className="main">
        <aside className="sidebar">
          <h2>Storage Boxes</h2>
          <input className="search" placeholder="Search storage boxes" value={search} onChange={e => setSearch(e.target.value)} />
          <ul className="storage-list">
            {filteredSidebar.map(box => (
              <li key={box.id}>
                <button
                  type="button"
                  className={'storage' + (openBoxId === box.id ? ' active' : '')}
                  onClick={() => {
                    setOpenBoxId(box.id)
                    document.getElementById(`shelf-slot-${box.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
                  }}
                >
                  <span className={'thumb ' + boxTheme(box.id)} aria-hidden />
                  <span>
                    <strong>{box.name}</strong>
                    <small>{box.drawers.length} drawer{box.drawers.length === 1 ? '' : 's'} &middot; {box.drawers.reduce((s, d) => s + d.cardCount, 0)} cards</small>
                  </span>
                </button>
              </li>
            ))}
            {boxes.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 3px' }}>No boxes yet.</li>}
          </ul>
        </aside>

        <section className="stage">
          <div className="cabinet">
            {rows.length === 0 && <p className="empty-shelf">Nothing on the shelf yet — click ⊕ above to add your first box, or add a binder below.</p>}
            {rows.map((row, i) => (
              <div className="shelf-row" key={i}>
                {row.map(item => {
                  const ref = refOf(item)
                  // Drag-to-reorder (the handle below) only works with a mouse — these
                  // arrows are the touch-friendly equivalent, reusing the same reorder call.
                  const idx = sortedItems.findIndex(it => { const r = refOf(it); return r.kind === ref.kind && r.refId === ref.refId })
                  const prevItem = idx > 0 ? sortedItems[idx - 1] : null
                  const nextItem = idx < sortedItems.length - 1 ? sortedItems[idx + 1] : null

                  const dragHandle = (
                    <>
                      <span
                        className="shelf-app-drag" style={{ position: 'absolute', top: 6, left: 8, color: '#fff', opacity: .8 }}
                        draggable title="Drag to reorder"
                        onClick={e => e.stopPropagation()}
                        onDragStart={e => e.dataTransfer.setData(SHELF_ITEM_MIME, JSON.stringify(ref))}
                      >⠿</span>
                      <div style={{ position: 'absolute', top: 4, left: 26, display: 'flex', gap: 2 }}>
                        <button
                          className="shelf-app-icon-btn" style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}
                          disabled={!prevItem} title="Move earlier"
                          onClick={e => { e.stopPropagation(); if (prevItem) reorderShelfItems(ref, refOf(prevItem)) }}
                        >‹</button>
                        <button
                          className="shelf-app-icon-btn" style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}
                          disabled={!nextItem} title="Move later"
                          onClick={e => { e.stopPropagation(); if (nextItem) reorderShelfItems(ref, refOf(nextItem)) }}
                        >›</button>
                      </div>
                    </>
                  )

                  if (item.kind === 'binder') {
                    const binder = item.binder
                    return (
                      <article
                        key={binder.id}
                        className={'slot' + (dropHover === `binder:${binder.id}` ? ' drop-hover' : '')}
                        onClick={() => navigate(`/binder/${binder.id}`)}
                        onDragOver={e => { if (editMode && e.dataTransfer.types.includes(SHELF_ITEM_MIME)) { e.preventDefault(); setDropHover(`binder:${binder.id}`) } }}
                        onDragLeave={() => setDropHover(null)}
                        onDrop={e => {
                          e.preventDefault(); setDropHover(null)
                          const raw = e.dataTransfer.getData(SHELF_ITEM_MIME)
                          if (raw) reorderShelfItems(JSON.parse(raw), ref)
                        }}
                      >
                        <div className={'binder ' + boxTheme(binder.id)}>
                          {editMode && (
                            <>
                              {dragHandle}
                              <button
                                className="shelf-app-icon-btn" style={{ position: 'absolute', top: 4, right: 6, background: 'rgba(0,0,0,.4)', color: '#fff' }}
                                onClick={e => handleDeleteBinder(item, e)} aria-label="Remove binder"
                              >×</button>
                            </>
                          )}
                          {binder.coverImage
                            ? <img className="binder-cover-img" src={binder.coverImage} alt="" />
                            : (<><div className="binder-lid" /><div className="binder-base" /></>)}
                          {renaming?.kind === 'binder' && renaming.id === binder.id ? (
                            <input
                              autoFocus className="shelf-app-input binder-name-input" value={renameValue}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setRenameValue(e.target.value)}
                              onBlur={submitRename}
                              onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null) }}
                            />
                          ) : (
                            <span
                              className={'binder-name' + (editMode ? ' editable' : '')}
                              onClick={e => { if (editMode) { e.stopPropagation(); startRename({ kind: 'binder', id: binder.id }, binder.name) } }}
                            >{binder.name}</span>
                          )}
                        </div>
                      </article>
                    )
                  }

                  const box = item.box
                  return (
                  <article
                    key={box.id}
                    id={`shelf-slot-${box.id}`}
                    className={'slot' + (dropHover === `box:${box.id}` ? ' drop-hover' : '')}
                    onClick={() => setOpenBoxId(box.id)}
                    onDragOver={e => {
                      if (e.dataTransfer.types.includes(CARD_MIME) || (editMode && e.dataTransfer.types.includes(SHELF_ITEM_MIME))) {
                        e.preventDefault(); setDropHover(`box:${box.id}`)
                      }
                    }}
                    onDragLeave={() => setDropHover(null)}
                    onDrop={e => {
                      e.preventDefault(); setDropHover(null)
                      const raw = e.dataTransfer.getData(SHELF_ITEM_MIME)
                      if (raw) { reorderShelfItems(JSON.parse(raw), ref); return }
                      const cardId = e.dataTransfer.getData(CARD_MIME)
                      if (cardId) dropCardOnBox(cardId, box)
                    }}
                  >
                    <div className={'box ' + boxTheme(box.id)}>
                      {editMode && (
                        <>
                          {dragHandle}
                          <button
                            className="shelf-app-icon-btn" style={{ position: 'absolute', top: 4, right: 6, background: 'rgba(0,0,0,.4)', color: '#fff' }}
                            onClick={e => handleDeleteBox(box, e)} aria-label="Remove box"
                          >×</button>
                        </>
                      )}
                      {box.name}
                      <span className="box-meta">{box.drawers.length} drawer{box.drawers.length === 1 ? '' : 's'}</span>
                    </div>
                  </article>
                  )
                })}

                {i === rows.length - 1 && (
                  <>
                    <article className="slot add-slot" onClick={() => setCreatingBox(true)}>
                      <div className="box" style={{ position: 'static', height: '100%' }}>
                        <span className="add-plus">+</span>
                        Add a box
                      </div>
                    </article>
                    <article className="slot add-slot" onClick={() => setCreatingBinder(true)}>
                      <div className="box" style={{ position: 'static', height: '100%' }}>
                        <span className="add-plus">+</span>
                        Add a binder
                      </div>
                    </article>
                  </>
                )}
              </div>
            ))}
          </div>

          <div
            className={'unassigned' + (dropHover === 'unassign' ? ' drop-hover' : '')}
            onDragOver={e => { if (e.dataTransfer.types.includes(CARD_MIME)) { e.preventDefault(); setDropHover('unassign') } }}
            onDragLeave={() => setDropHover(null)}
            onDrop={e => {
              e.preventDefault(); setDropHover(null)
              const id = e.dataTransfer.getData(CARD_MIME)
              if (id) onSetCardDrawer(id, '') // empty drawer ID == unassign
            }}
          >
            <div className="unassigned-head">
              <h3>Unassigned ({unassignedCards.length})</h3>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="sort-btns">
                  <button className={unassignedSort === 'name' ? 'active' : ''} onClick={() => setUnassignedSort('name')}>Name</button>
                  <button className={unassignedSort === 'set' ? 'active' : ''} onClick={() => setUnassignedSort('set')}>Set</button>
                </div>
                <div className="select-controls">
                  <button className={selectMode ? 'active' : ''} onClick={toggleSelectMode}>
                    {selectMode ? 'Done' : 'Select'}
                  </button>
                  {selectMode && (
                    <>
                      <button onClick={() => setSelectedIds(new Set(unassignedCards.map(c => c.id)))}>All</button>
                      <button onClick={() => setSelectedIds(new Set())}>None</button>
                      <button
                        className="primary" disabled={selectedIds.size === 0}
                        onClick={() => setMovingCardIds([...selectedIds])}
                      >Assign {selectedIds.size || ''}…</button>
                    </>
                  )}
                </div>
              </div>
            </div>
            {unassignedCards.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Every owned card is filed away.</p>}
            <div className="unassigned-grid">
              {unassignedCards.map(c => (
                <div
                  key={c.id}
                  className={'unassigned-card' + (selectedIds.has(c.id) ? ' selected' : '')}
                  draggable={!selectMode} title={c.name}
                  onDragStart={e => e.dataTransfer.setData(CARD_MIME, c.id)}
                  // Drag works for a mouse; tapping opens the same "move to…" picker
                  // used everywhere else so touch users have a real way to file cards.
                  // In select mode, tapping toggles the checkbox instead.
                  onClick={() => (selectMode ? toggleSelected(c.id) : setMovingCardIds([c.id]))}
                >
                  {selectMode && <span className={'select-check' + (selectedIds.has(c.id) ? ' checked' : '')} aria-hidden>{selectedIds.has(c.id) ? '✓' : ''}</span>}
                  <img src={c.images.small} alt={c.name} />
                  <span className="qty-badge">{qtyOf(c.id)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {creatingBox && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setCreatingBox(false) }}>
          <div className="shelf-app-modal" style={{ width: 340 }}>
            <div className="shelf-app-modal-head"><h3>New Box</h3></div>
            <div className="shelf-app-modal-body">
              <input autoFocus className="shelf-app-input" placeholder="Box name" value={newBoxName}
                onChange={e => setNewBoxName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNewBox(); if (e.key === 'Escape') setCreatingBox(false) }} />
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                Drawers
                <input type="number" min={0} max={20} className="shelf-app-input" style={{ width: 60 }} value={newBoxDrawers} onChange={e => setNewBoxDrawers(e.target.value)} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="shelf-app-btn primary" onClick={submitNewBox}>Create</button>
                <button className="shelf-app-btn" onClick={() => setCreatingBox(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {creatingBinder && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setCreatingBinder(false) }}>
          <div className="shelf-app-modal" style={{ width: 360 }}>
            <div className="shelf-app-modal-head"><h3>New Binder</h3></div>
            <div className="shelf-app-modal-body">
              <input autoFocus className="shelf-app-input" placeholder="Binder name" maxLength={40} value={newBinderName}
                onChange={e => setNewBinderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNewBinder(); if (e.key === 'Escape') setCreatingBinder(false) }} />
              <div
                onClick={() => coverFileRef.current?.click()}
                style={{
                  border: '1px dashed var(--line)', borderRadius: 8, padding: 10, textAlign: 'center',
                  cursor: 'pointer', fontSize: 12, color: 'var(--muted)', overflow: 'hidden',
                }}
              >
                {newBinderCover
                  ? <img src={newBinderCover} alt="" style={{ maxHeight: 80, borderRadius: 6 }} />
                  : 'Click to upload a cover photo (optional, max 5MB)'}
              </div>
              <input ref={coverFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => handleCover(e.target.files?.[0])} />
              <div style={{ display: 'flex', gap: 6 }}>
                {SIZE_OPTIONS.map(s => (
                  <button
                    key={s} className={'shelf-app-btn' + (newBinderSize === s ? ' primary' : '')}
                    onClick={() => setNewBinderSize(s)}
                  >{SIZE_NUM[s]}-Pocket</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="shelf-app-btn primary" onClick={submitNewBinder} disabled={binderBusy}>
                  {binderBusy ? 'Creating…' : 'Create'}
                </button>
                <button className="shelf-app-btn" onClick={() => setCreatingBinder(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Box detail popup — where drawers live and cards get filed. */}
      {openBox && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setOpenBoxId(null) }}>
          <div className="shelf-app-modal">
            <div className="shelf-app-modal-head">
              {renaming?.kind === 'box' && renaming.id === openBox.id ? (
                <input autoFocus className="shelf-app-input" style={{ flex: 1 }} value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <h3
                  style={editMode ? { cursor: 'pointer', textDecoration: 'underline dotted var(--muted)' } : undefined}
                  onClick={() => { if (editMode) startRename({ kind: 'box', id: openBox.id }, openBox.name) }}
                >{openBox.name}</h3>
              )}
              {editMode && <button className="shelf-app-btn danger" onClick={() => handleDeleteBox(openBox)}>Remove box</button>}
              <button className="shelf-app-modal-close" onClick={() => setOpenBoxId(null)} aria-label="Close">×</button>
            </div>
            <div className="shelf-app-modal-body">
              {openBox.drawers.length === 0 && <p className="shelf-app-empty-note">No drawers yet.</p>}
              {(() => {
                const sortedDrawers = [...openBox.drawers].sort((a, b) => a.position - b.position)
                return sortedDrawers.map((drawer, di) => {
                const inDrawer = cardsByDrawer[drawer.id] ?? []
                const prevDrawer = di > 0 ? sortedDrawers[di - 1] : null
                const nextDrawer = di < sortedDrawers.length - 1 ? sortedDrawers[di + 1] : null
                return (
                  <div
                    key={drawer.id} className={'shelf-app-drawer' + (dropHover === drawer.id ? ' drop-hover' : '')}
                    onDragOver={e => { e.preventDefault(); setDropHover(drawer.id) }}
                    onDragLeave={() => setDropHover(null)}
                    onDrop={e => {
                      // Drawer reorder and card filing share this drop zone — tell them apart by MIME type.
                      e.preventDefault(); setDropHover(null)
                      const draggedDrawerId = e.dataTransfer.getData(DRAWER_MIME)
                      if (draggedDrawerId) { reorderDrawers(openBox, draggedDrawerId, drawer.id); return }
                      const cardId = e.dataTransfer.getData(CARD_MIME)
                      if (cardId) dropCardOnDrawer(cardId, drawer.id)
                    }}
                  >
                    <div className="shelf-app-drawer-head">
                      {editMode && (
                        <>
                          <span className="shelf-app-drag" draggable title="Drag to reorder"
                            onDragStart={e => e.dataTransfer.setData(DRAWER_MIME, drawer.id)}>⠿</span>
                          <button className="shelf-app-icon-btn" disabled={!prevDrawer} title="Move up"
                            onClick={() => prevDrawer && reorderDrawers(openBox, drawer.id, prevDrawer.id)}>‹</button>
                          <button className="shelf-app-icon-btn" disabled={!nextDrawer} title="Move down"
                            onClick={() => nextDrawer && reorderDrawers(openBox, drawer.id, nextDrawer.id)}>›</button>
                        </>
                      )}
                      {renaming?.kind === 'drawer' && renaming.id === drawer.id ? (
                        <input autoFocus className="shelf-app-input" style={{ flex: 1 }} value={renameValue}
                          onChange={e => setRenameValue(e.target.value)} onBlur={submitRename}
                          onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setRenaming(null) }} />
                      ) : (
                        <span
                          className={'shelf-app-drawer-name' + (editMode ? ' editable' : '')}
                          onClick={() => { if (editMode) startRename({ kind: 'drawer', id: drawer.id }, drawer.name) }}
                        >{drawer.name}</span>
                      )}
                      <span className="shelf-app-drawer-count">{drawer.cardCount} card{drawer.cardCount === 1 ? '' : 's'}</span>
                      {editMode && <button className="shelf-app-icon-btn" onClick={() => handleDeleteDrawer(drawer)} aria-label="Remove drawer">×</button>}
                    </div>
                    <div className="shelf-app-cards">
                      {inDrawer.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0, gridColumn: '1 / -1' }}>Empty — drag a card here, or tap a card and choose this drawer.</p>}
                      {inDrawer.map(c => (
                        <div key={c.id} className="shelf-app-card" title={c.name} onClick={() => setMovingCardIds([c.id])}>
                          <img src={c.images.small} alt={c.name} />
                          <span className="qty-badge">{qtyOf(c.id)}</span>
                          <button className="shelf-app-card-remove" title="Unassign" onClick={e => { e.stopPropagation(); onSetCardDrawer(c.id, '') }}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
                })
              })()}

              {editMode && (
                addingDrawer ? (
                  <div className="shelf-app-inline-form">
                    <input autoFocus className="shelf-app-input" placeholder="Drawer name" value={newDrawerName}
                      onChange={e => setNewDrawerName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitNewDrawer(openBox.id); if (e.key === 'Escape') setAddingDrawer(false) }} />
                    <button className="shelf-app-btn primary" onClick={() => submitNewDrawer(openBox.id)}>Add</button>
                    <button className="shelf-app-btn" onClick={() => setAddingDrawer(false)}>Cancel</button>
                  </div>
                ) : (
                  <button className="shelf-app-btn" onClick={() => { setAddingDrawer(true); setNewDrawerName('') }}>+ Add drawer</button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Replaces window.confirm() for box/drawer/binder deletion — same wording, in-app UI. */}
      {pendingDelete && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPendingDelete(null) }}>
          <div className="shelf-app-modal" style={{ width: 340 }}>
            <div className="shelf-app-modal-head">
              <h3>Remove {pendingDelete.kind === 'box' ? 'box' : pendingDelete.kind === 'drawer' ? 'drawer' : 'binder'}?</h3>
            </div>
            <div className="shelf-app-modal-body">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                Remove "{pendingDelete.kind === 'box' ? pendingDelete.box.name : pendingDelete.kind === 'drawer' ? pendingDelete.drawer.name : pendingDelete.name}"?
                {pendingDelete.kind === 'binder'
                  ? ' This cannot be undone.'
                  : ' Cards inside are NOT deleted — they just become unassigned.'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="shelf-app-btn danger" onClick={confirmPendingDelete}>Remove</button>
                <button className="shelf-app-btn" onClick={() => setPendingDelete(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tap-to-file picker — the touch-friendly equivalent of dragging a card
          onto a drawer, since native HTML5 drag-and-drop never fires on touch
          devices. Also doubles as the bulk "Assign N selected" target: a
          single ID goes through onSetCardDrawer (the existing per-card path),
          several go through one batched assignCards request. */}
      {movingCardIds && movingCardIds.length > 0 && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setMovingCardIds(null) }}>
          <div className="shelf-app-modal" style={{ width: 380, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
            <div className="shelf-app-modal-head">
              <h3>{movingCardIds.length === 1 ? 'Move to…' : `Assign ${movingCardIds.length} cards to…`}</h3>
              <button className="shelf-app-modal-close" onClick={() => setMovingCardIds(null)} aria-label="Close">×</button>
            </div>
            <div className="shelf-app-modal-body" style={{ overflowY: 'auto' }}>
              {movingCardIds.length === 1 && drawerOf[movingCardIds[0]] && (
                <button
                  className="shelf-app-btn"
                  onClick={() => { onSetCardDrawer(movingCardIds[0], ''); setMovingCardIds(null) }}
                >Unassign (remove from storage)</button>
              )}
              {boxes.length === 0 && <p className="shelf-app-empty-note">No boxes yet — add one first.</p>}
              {[...boxes].sort((a, b) => a.position - b.position).map(box => (
                <div key={box.id} style={{ marginTop: 10 }}>
                  <strong style={{ fontSize: 13 }}>{box.name}</strong>
                  {box.drawers.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0' }}>No drawers.</p>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {[...box.drawers].sort((a, b) => a.position - b.position).map(drawer => (
                      <button
                        key={drawer.id}
                        className="shelf-app-btn"
                        disabled={movingCardIds.length === 1 && drawerOf[movingCardIds[0]] === drawer.id}
                        onClick={() => {
                          if (movingCardIds.length === 1) { onSetCardDrawer(movingCardIds[0], drawer.id); setMovingCardIds(null) }
                          else assignMovingCardsToDrawer(drawer.id)
                        }}
                      >{drawer.name}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
