/**
 * "Shelf" view of My Collection — a wood cabinet of box slots with a
 * sidebar for jump-to-box, plus a detail popup showing a box's drawers
 * and the cards filed into each. Card-to-drawer assignment (dragging
 * from Unassigned, or the × on a card) only happens inside that popup —
 * the shelf slots themselves only accept drags to reorder boxes, so
 * "which box is where" and "what's inside a box" stay separate concerns.
 *
 * Drag payloads are labeled by MIME type (CARD_MIME/BOX_MIME/DRAWER_MIME)
 * so a drop target can tell what's being dragged over it — a card, a box,
 * or a drawer — without inspecting the payload itself. Native HTML5 drag
 * events never fire on touch devices, so every drag interaction here has
 * a tap-based equivalent that calls the same handler: tapping a card
 * opens the "Move to…" picker (movingCardId), and edit-mode reordering
 * has ‹/› arrow buttons next to the drag handle. Deletes go through an
 * in-app confirm modal (pendingDelete) instead of window.confirm(), which
 * doesn't fit the app's own UI.
 *
 * USED BY: OwnedPage
 */

import { useState } from 'react'
import {
  assignCards, createBox, createDrawer, deleteBox, deleteDrawer,
  updateBox, updateDrawer,
} from '../api/storage'
import { boxTheme } from '../lib/boxVariant'
import { useToast } from './Toast'
import { totalQty, type CondMap } from '../lib/conditions'
import type { Card, StorageBox, StorageDrawer } from '../types'

const CARD_MIME = 'text/x-card-id'
const BOX_MIME = 'application/x-box-id'
const DRAWER_MIME = 'application/x-drawer-id'

const BOXES_PER_ROW = 3

interface Entry { conds: CondMap; selCond: string }
interface RenameState { kind: 'box' | 'drawer'; id: string }
type UnassignedSort = 'name' | 'set'
type PendingDelete = { kind: 'box'; box: StorageBox } | { kind: 'drawer'; drawer: StorageDrawer }

interface Props {
  userId: string
  cards: Card[]
  coll: Record<string, Entry>
  boxes: StorageBox[]
  /** Card ID -> which drawer it's currently in (only set for assigned cards). */
  drawerOf: Record<string, string>
  /** Card ID -> binder placement, used only to check "is this card placed elsewhere already." */
  binderLocationOf: Record<string, unknown>
  onReloadBoxes: () => void
  onSetCardDrawer: (cardId: string, drawerId: string) => Promise<void>
}

export function CollectionShelf({
  userId, cards, coll, boxes, drawerOf, binderLocationOf, onReloadBoxes, onSetCardDrawer,
}: Props) {
  const toast = useToast()

  const [search, setSearch] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [openBoxId, setOpenBoxId] = useState<string | null>(null)

  // Which drop target is currently under a drag, for hover styling.
  const [dropHover, setDropHover] = useState<string | null>(null)
  const [unassignedSort, setUnassignedSort] = useState<UnassignedSort>('name')

  const [creatingBox, setCreatingBox] = useState(false)
  const [newBoxName, setNewBoxName] = useState('')
  const [newBoxDrawers, setNewBoxDrawers] = useState('3')

  const [addingDrawer, setAddingDrawer] = useState(false)
  const [newDrawerName, setNewDrawerName] = useState('')

  const [renaming, setRenaming] = useState<RenameState | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // In-app replacements for the two things that were still "leaving" the
  // app's UI: window.confirm() for deletes, and drag-and-drop (which never
  // fires on touch devices) as the only way to file a card into a drawer.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [movingCardId, setMovingCardId] = useState<string | null>(null)

  const sortedBoxes = [...boxes].sort((a, b) => a.position - b.position)
  const filteredSidebar = sortedBoxes.filter(b => b.name.toLowerCase().includes(search.toLowerCase()))

  const rows: StorageBox[][] = []
  for (let i = 0; i < sortedBoxes.length; i += BOXES_PER_ROW) rows.push(sortedBoxes.slice(i, i + BOXES_PER_ROW))

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
      onReloadBoxes()
    } catch { toast('Could not create box.') }
  }

  // `e` is omitted when called from the modal's "Remove box" button rather than a direct click.
  // Opens the in-app confirm modal instead of window.confirm() — see confirmPendingDelete.
  const handleDeleteBox = (box: StorageBox, e?: React.MouseEvent) => {
    e?.stopPropagation() // don't also trigger the slot's own onClick (open box)
    setPendingDelete({ kind: 'box', box })
  }

  const reorderBoxes = async (draggedId: string, targetId: string) => {
    const from = sortedBoxes.findIndex(b => b.id === draggedId)
    const to = sortedBoxes.findIndex(b => b.id === targetId)
    if (from === -1 || to === -1 || from === to) return

    const next = [...sortedBoxes]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)

    try {
      await Promise.all(next.map((b, i) => (b.position === i ? null : updateBox(b.id, { position: i }))))
      onReloadBoxes()
    } catch { toast('Could not reorder boxes.') }
  }

  const startRename = (state: RenameState, current: string) => { setRenaming(state); setRenameValue(current) }

  const submitRename = async () => {
    if (!renaming) return
    const { kind, id } = renaming
    const name = renameValue.trim()
    setRenaming(null)
    if (!name) return
    try {
      if (kind === 'box') await updateBox(id, { name }); else await updateDrawer(id, { name })
      onReloadBoxes()
    } catch { toast(`Could not rename ${kind}.`) }
  }

  const submitNewDrawer = async (boxId: string) => {
    const name = newDrawerName.trim()
    setAddingDrawer(false); setNewDrawerName('')
    if (!name) return
    try { await createDrawer(boxId, name); onReloadBoxes() }
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
      } else {
        await deleteDrawer(target.drawer.id)
      }
      onReloadBoxes()
    } catch { toast(target.kind === 'box' ? 'Could not remove box.' : 'Could not remove drawer.') }
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
      onReloadBoxes()
    } catch { toast('Could not reorder drawers.') }
  }

  const dropCardOnDrawer = async (cardId: string, drawerId: string) => {
    try {
      const result = await assignCards(userId, [cardId], drawerId)
      if (result.warning) toast(result.warning)
      onReloadBoxes()
    } catch { toast('Could not update storage location.') }
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
            {sortedBoxes.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 3px' }}>No boxes yet.</li>}
          </ul>
        </aside>

        <section className="stage">
          <div className="cabinet">
            {rows.length === 0 && <p className="empty-shelf">No boxes yet — click ⊕ above to add your first one.</p>}
            {rows.map((row, i) => (
              <div className="shelf-row" key={i}>
                {row.map(box => {
                  // Drag-to-reorder (the handle below) only works with a mouse — these
                  // arrows are the touch-friendly equivalent, reusing the same reorderBoxes call.
                  const boxIdx = sortedBoxes.findIndex(b => b.id === box.id)
                  const prevBox = boxIdx > 0 ? sortedBoxes[boxIdx - 1] : null
                  const nextBox = boxIdx < sortedBoxes.length - 1 ? sortedBoxes[boxIdx + 1] : null
                  return (
                  <article
                    key={box.id}
                    id={`shelf-slot-${box.id}`}
                    className={'slot' + (dropHover === `box:${box.id}` ? ' drop-hover' : '')}
                    onClick={() => setOpenBoxId(box.id)}
                    onDragOver={e => { if (editMode && e.dataTransfer.types.includes(BOX_MIME)) { e.preventDefault(); setDropHover(`box:${box.id}`) } }}
                    onDragLeave={() => setDropHover(null)}
                    onDrop={e => {
                      e.preventDefault(); setDropHover(null)
                      const draggedId = e.dataTransfer.getData(BOX_MIME)
                      if (draggedId) reorderBoxes(draggedId, box.id)
                    }}
                  >
                    <div className={'box ' + boxTheme(box.id)}>
                      {editMode && (
                        <>
                          <span
                            className="shelf-app-drag" style={{ position: 'absolute', top: 6, left: 8, color: '#fff', opacity: .8 }}
                            draggable title="Drag to reorder"
                            onClick={e => e.stopPropagation()}
                            onDragStart={e => e.dataTransfer.setData(BOX_MIME, box.id)}
                          >⠿</span>
                          <div style={{ position: 'absolute', top: 4, left: 26, display: 'flex', gap: 2 }}>
                            <button
                              className="shelf-app-icon-btn" style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}
                              disabled={!prevBox} title="Move earlier"
                              onClick={e => { e.stopPropagation(); if (prevBox) reorderBoxes(box.id, prevBox.id) }}
                            >‹</button>
                            <button
                              className="shelf-app-icon-btn" style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}
                              disabled={!nextBox} title="Move later"
                              onClick={e => { e.stopPropagation(); if (nextBox) reorderBoxes(box.id, nextBox.id) }}
                            >›</button>
                          </div>
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
                  <article className="slot add-slot" onClick={() => setCreatingBox(true)}>
                    <div className="box" style={{ position: 'static', height: '100%' }}>
                      <span className="add-plus">+</span>
                      Add a box
                    </div>
                  </article>
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
              <div className="sort-btns">
                <button className={unassignedSort === 'name' ? 'active' : ''} onClick={() => setUnassignedSort('name')}>Name</button>
                <button className={unassignedSort === 'set' ? 'active' : ''} onClick={() => setUnassignedSort('set')}>Set</button>
              </div>
            </div>
            {unassignedCards.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Every owned card is filed away.</p>}
            <div className="unassigned-grid">
              {unassignedCards.map(c => (
                <div
                  key={c.id} className="unassigned-card" draggable title={c.name}
                  onDragStart={e => e.dataTransfer.setData(CARD_MIME, c.id)}
                  // Drag works for a mouse; tapping opens the same "move to…" picker
                  // used everywhere else so touch users have a real way to file cards.
                  onClick={() => setMovingCardId(c.id)}
                >
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
                        <div key={c.id} className="shelf-app-card" title={c.name} onClick={() => setMovingCardId(c.id)}>
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

      {/* Replaces window.confirm() for box/drawer deletion — same wording, in-app UI. */}
      {pendingDelete && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setPendingDelete(null) }}>
          <div className="shelf-app-modal" style={{ width: 340 }}>
            <div className="shelf-app-modal-head"><h3>Remove {pendingDelete.kind === 'box' ? 'box' : 'drawer'}?</h3></div>
            <div className="shelf-app-modal-body">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                Remove "{pendingDelete.kind === 'box' ? pendingDelete.box.name : pendingDelete.drawer.name}"?
                Cards inside are NOT deleted — they just become unassigned.
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
          onto a drawer, since native HTML5 drag-and-drop never fires on touch devices. */}
      {movingCardId && (
        <div className="shelf-app-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setMovingCardId(null) }}>
          <div className="shelf-app-modal" style={{ width: 380, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
            <div className="shelf-app-modal-head">
              <h3>Move to…</h3>
              <button className="shelf-app-modal-close" onClick={() => setMovingCardId(null)} aria-label="Close">×</button>
            </div>
            <div className="shelf-app-modal-body" style={{ overflowY: 'auto' }}>
              {drawerOf[movingCardId] && (
                <button
                  className="shelf-app-btn"
                  onClick={() => { onSetCardDrawer(movingCardId, ''); setMovingCardId(null) }}
                >Unassign (remove from storage)</button>
              )}
              {sortedBoxes.length === 0 && <p className="shelf-app-empty-note">No boxes yet — add one first.</p>}
              {sortedBoxes.map(box => (
                <div key={box.id} style={{ marginTop: 10 }}>
                  <strong style={{ fontSize: 13 }}>{box.name}</strong>
                  {box.drawers.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0' }}>No drawers.</p>}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {[...box.drawers].sort((a, b) => a.position - b.position).map(drawer => (
                      <button
                        key={drawer.id}
                        className="shelf-app-btn"
                        disabled={drawerOf[movingCardId] === drawer.id}
                        onClick={() => { onSetCardDrawer(movingCardId, drawer.id); setMovingCardId(null) }}
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
