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
import { createPortal } from 'react-dom'
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

interface BoxPreset { id: string; name: string; capacity: number; sections: number; material: string }
const BOX_PRESETS: BoxPreset[] = [
  { id: 'deck-75', name: 'Artwork Deck Box', capacity: 75, sections: 1, material: 'Rigid plastic · divider included' },
  { id: 'deck-100', name: '100+ Deck Box', capacity: 100, sections: 1, material: 'Sleeved cards · divider included' },
  { id: 'long-800', name: 'Long Card Box', capacity: 800, sections: 1, material: 'Corrugated cardboard' },
  { id: 'row-1600', name: '2-Row Storage Box', capacity: 1600, sections: 2, material: 'Cardboard · removable lid' },
  { id: 'row-3200', name: '4-Row Monster Box', capacity: 3200, sections: 4, material: 'Cardboard · removable lid' },
  { id: 'row-5000', name: '5-Row Monster Box', capacity: 5000, sections: 5, material: 'Cardboard · removable lid' },
  { id: 'display-drawer', name: '3-Drawer Display Organizer', capacity: 1000, sections: 3, material: 'Rigid plastic · card windows' },
  { id: 'custom', name: 'Custom Box', capacity: 0, sections: 1, material: 'Set your own capacity and sections' },
]

interface Entry { conds: CondMap; selCond: string }
interface RenameState { kind: 'box' | 'drawer' | 'binder'; id: string }
interface HoverPreview { card: Card; x: number; y: number }
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
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null)

  // Which drop target is currently under a drag, for hover styling.
  const [dropHover, setDropHover] = useState<string | null>(null)
  const [unassignedSort, setUnassignedSort] = useState<UnassignedSort>('name')

  const [creatingBox, setCreatingBox] = useState(false)
  const [newBoxName, setNewBoxName] = useState('')
  const [newBoxType, setNewBoxType] = useState('long-800')
  const [newBoxDrawers, setNewBoxDrawers] = useState('1')
  const [newBoxCapacity, setNewBoxCapacity] = useState('800')
  const [newBoxColor, setNewBoxColor] = useState('#B99B67')

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
  const binderItems = sortedItems.filter((i): i is Extract<ShelfEntry, { kind: 'binder' }> => i.kind === 'binder')
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
  const showPreview = (card: Card, e: React.MouseEvent) => setHoverPreview({ card, x: e.clientX, y: e.clientY })
  const movePreview = (e: React.MouseEvent) => setHoverPreview(current => current ? { ...current, x: e.clientX, y: e.clientY } : null)

  const openBox = boxes.find(b => b.id === openBoxId) ?? null

  const submitNewBox = async () => {
    const name = newBoxName.trim()
    const drawerCount = Math.max(0, Math.min(20, parseInt(newBoxDrawers, 10) || 0))
    const capacity = Math.max(0, parseInt(newBoxCapacity, 10) || 0)

    setCreatingBox(false)
    if (!name) return
    try {
      const box = await createBox(userId, name, newBoxType, capacity, newBoxColor)
      for (let i = 0; i < drawerCount; i++) await createDrawer(box.id, drawerCount === 1 ? 'Cards' : `Row ${i + 1}`)

      setNewBoxName(''); setNewBoxType('long-800'); setNewBoxDrawers('1'); setNewBoxCapacity('800'); setNewBoxColor('#B99B67')
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
          <div className="collection-room">
            <section className="room-zone bulk-zone" aria-labelledby="bulk-storage-title">
              <div className="zone-heading">
                <div><span className="zone-kicker">Card storage</span><h2 id="bulk-storage-title">Bulk boxes</h2></div>
                <div className="box-shelf-tools">
                  <label className="box-search"><span>Find a box</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${boxes.length} boxes`} /></label>
                  <button className="zone-add" onClick={() => setCreatingBox(true)}>+ New box</button>
                </div>
              </div>
              <div className="physical-shelf bulk-shelf">
                <div className="shelf-items">
                  {filteredSidebar.map(box => (
                    <button
                      key={box.id}
                      id={`shelf-slot-${box.id}`}
                      className={'physical-box box-model-' + (box.boxType || 'custom') + ' ' + boxTheme(box.id) + (openBoxId === box.id ? ' is-open' : '')}
                      style={{ '--chosen-box-color': box.color || '#B99B67' } as React.CSSProperties}
                      onClick={() => setOpenBoxId(openBoxId === box.id ? null : box.id)}
                      onDragOver={e => { if (e.dataTransfer.types.includes(CARD_MIME)) { e.preventDefault(); setDropHover(`box:${box.id}`) } }}
                      onDragLeave={() => setDropHover(null)}
                      onDrop={e => { e.preventDefault(); setDropHover(null); const cardId = e.dataTransfer.getData(CARD_MIME); if (cardId) dropCardOnBox(cardId, box) }}
                    >
                      <span className="box-lid" />
                      <span className="box-handles" aria-hidden><i /><i /></span>
                      {(box.boxType === 'display-drawer') && <span className="drawer-display-windows" aria-hidden><i /><i /><i /></span>}
                      <span className="box-label"><strong>{box.name}</strong><small>{box.drawers.reduce((sum, drawer) => sum + drawer.cardCount, 0)} / {box.capacity || '∞'} cards</small></span>
                      <span className="box-open-hint">{openBoxId === box.id ? 'Close box' : 'Open box'}</span>
                    </button>
                  ))}
                  {boxes.length === 0 && <button className="empty-object" onClick={() => setCreatingBox(true)}>Build your first storage box</button>}
                  {boxes.length > 0 && filteredSidebar.length === 0 && <p className="no-box-match">No boxes match “{search}”.</p>}
                </div>
                <div className="wood-plank" aria-hidden />
              </div>
              {openBox && (
                <section className="opened-card-box" aria-label={`${openBox.name} contents`}>
                  <div className="opened-box-lid" aria-hidden><span>{openBox.name}</span></div>
                  <div className="opened-box-rim">
                    <div className="opened-box-title"><span><strong>{openBox.name}</strong><small>{openBox.drawers.reduce((sum, drawer) => sum + drawer.cardCount, 0)} cards</small></span><button onClick={() => setOpenBoxId(null)} aria-label="Close box">Close box</button></div>
                    <div className="card-row-scroll">
                    {[...openBox.drawers].sort((a, b) => a.position - b.position).map(drawer => {
                      const inDrawer = cardsByDrawer[drawer.id] ?? []
                      return (
                        <div key={drawer.id} className={'card-divider-section' + (dropHover === drawer.id ? ' drop-hover' : '')}
                          onDragOver={e => { e.preventDefault(); setDropHover(drawer.id) }} onDragLeave={() => setDropHover(null)}
                          onDrop={e => { e.preventDefault(); setDropHover(null); const cardId = e.dataTransfer.getData(CARD_MIME); if (cardId) dropCardOnDrawer(cardId, drawer.id) }}>
                          <div className="card-divider"><strong>{drawer.name}</strong><span>{drawer.cardCount}</span></div>
                          <div className="cards-in-box">
                            {inDrawer.map(card => <button key={card.id} className="boxed-card" title={`${card.name} — inspect`} onClick={() => setHoverPreview({ card, x: window.innerWidth / 2, y: window.innerHeight / 2 })}
                              onMouseEnter={e => showPreview(card, e)} onMouseMove={movePreview} onMouseLeave={() => setHoverPreview(null)}
                              onTouchStart={e => { const touch = e.touches[0]; setHoverPreview({ card, x: touch.clientX, y: touch.clientY }) }}><img src={card.images.small} alt={card.name} /><span>{qtyOf(card.id)}</span></button>)}
                            {inDrawer.length === 0 && <button className="empty-box-row" onClick={() => setMovingCardIds(unassignedCards.length ? [unassignedCards[0].id] : null)}>Drop cards behind this divider</button>}
                          </div>
                        </div>
                      )
                    })}
                    {openBox.drawers.length === 0 && <p className="empty-open-box">This box needs a divider. Turn on Edit to add one.</p>}
                    </div>
                  </div>
                </section>
              )}
            </section>

            <section className="room-zone binder-zone" aria-labelledby="binders-title">
              <div className="zone-heading">
                <div><span className="zone-kicker">Curated collections</span><h2 id="binders-title">Binders</h2></div>
                <button className="zone-add" onClick={() => setCreatingBinder(true)}>+ New binder</button>
              </div>
              <div className="physical-shelf binder-shelf">
                <div className="shelf-items">
                  {binderItems.map((item, index) => (
                    <button
                      key={item.binder.id}
                      className={'upright-binder ' + boxTheme(item.binder.id)}
                      style={{ '--binder-lean': `${index % 3 === 1 ? -2 : index % 3 === 2 ? 1.5 : 0}deg` } as React.CSSProperties}
                      onClick={() => navigate(`/binder/${item.binder.id}`)}
                    >
                      {item.binder.coverImage && <img src={item.binder.coverImage} alt="" />}
                      <span className="binder-rings" aria-hidden>•••</span>
                      <span className="binder-spine-title">{item.binder.name}</span>
                      <span className="binder-pocket">{SIZE_NUM[item.binder.pocketSize]} pocket</span>
                    </button>
                  ))}
                  {binderItems.length === 0 && <button className="empty-object" onClick={() => setCreatingBinder(true)}>Put your first binder on the shelf</button>}
                </div>
                <div className="wood-plank" aria-hidden />
              </div>
            </section>

            <section className="room-zone display-zone" aria-labelledby="display-title">
              <div className="zone-heading">
                <div><span className="zone-kicker">Featured collection</span><h2 id="display-title">Collector cabinet</h2></div>
                <span className="coming-label">4 on display</span>
              </div>
              <div className="glass-case">
                <div className="case-light" aria-hidden />
                <div className="case-doors" aria-hidden><i /><i /></div>
                <div className="display-cards">
                  {cards.slice(0, 4).map((card, index) => (
                    <div className={'display-piece piece-' + index} key={card.id}
                      onMouseEnter={e => showPreview(card, e)} onMouseMove={movePreview} onMouseLeave={() => setHoverPreview(null)}
                      onTouchStart={e => { const touch = e.touches[0]; setHoverPreview({ card, x: touch.clientX, y: touch.clientY }) }}>
                      <div className={index % 2 === 0 ? 'slab-frame' : 'toploader-frame'}>
                        {index % 2 === 0 && <span className="grade-label">COLLECTION <b>{qtyOf(card.id)}</b></span>}
                        <img src={card.images.small} alt={card.name} />
                      </div>
                      <span>{card.name}</span>
                    </div>
                  ))}
                  {cards.length === 0 && <p className="case-empty">Your favorite cards will look right at home here.</p>}
                </div>
                <div className="case-reflection" aria-hidden />
                <div className="cabinet-base" aria-hidden><i /><i /></div>
              </div>
            </section>
          </div>

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
                  onClick={() => (selectMode ? toggleSelected(c.id) : setHoverPreview({ card: c, x: window.innerWidth / 2, y: window.innerHeight / 2 }))}
                  onMouseEnter={e => showPreview(c, e)} onMouseMove={movePreview} onMouseLeave={() => setHoverPreview(null)}
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
          <div className="shelf-app-modal box-builder-modal">
            <div className="shelf-app-modal-head"><div><span className="modal-kicker">Match your real storage</span><h3>Choose a box</h3></div></div>
            <div className="shelf-app-modal-body">
              <div className="box-preset-grid">
                {BOX_PRESETS.map(preset => (
                  <button key={preset.id} className={'box-preset' + (newBoxType === preset.id ? ' selected' : '')}
                    onClick={() => { setNewBoxType(preset.id); if (preset.id !== 'custom') { setNewBoxCapacity(String(preset.capacity)); setNewBoxDrawers(String(preset.sections)) } }}>
                    <span className={'preset-model model-' + preset.id} aria-hidden>
                      {preset.id === 'display-drawer' && <i className="preset-windows"><b /><b /><b /></i>}
                      {preset.id.startsWith('row-') && <i className="preset-rows">{Array.from({ length: preset.sections }, (_, i) => <b key={i} />)}</i>}
                    </span>
                    <span><strong>{preset.name}</strong><small>{preset.capacity ? `${preset.capacity.toLocaleString()} cards` : 'Your dimensions'}</small><em>{preset.material}</em></span>
                  </button>
                ))}
              </div>
              <input autoFocus className="shelf-app-input" placeholder="Box name" value={newBoxName}
                onChange={e => setNewBoxName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNewBox(); if (e.key === 'Escape') setCreatingBox(false) }} />
              <div className="box-spec-fields">
                <label>Capacity<input type="number" min={0} className="shelf-app-input" value={newBoxCapacity} disabled={newBoxType !== 'custom'} onChange={e => setNewBoxCapacity(e.target.value)} /></label>
                <label>Rows / sections<input type="number" min={1} max={20} className="shelf-app-input" value={newBoxDrawers} disabled={newBoxType !== 'custom'} onChange={e => setNewBoxDrawers(e.target.value)} /></label>
              </div>
              <fieldset className="box-color-picker"><legend>Box color</legend><div>{['#E8E0CF','#B99B67','#24282D','#C94845','#346B9A','#4F7A57','#75558A','#E0A33A'].map(color => <button key={color} className={newBoxColor === color ? 'selected' : ''} style={{ background: color }} onClick={() => setNewBoxColor(color)} aria-label={`Choose ${color}`} />)}<label className="custom-color">Custom<input type="color" value={newBoxColor} onChange={e => setNewBoxColor(e.target.value)} /></label></div></fieldset>
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
        <section className="open-box-workbench" aria-label={`${openBox.name} open box`}>
          <div className="open-box-lid" aria-hidden><span>{openBox.name}</span></div>
          <div className="open-box-shell">
            <div className="open-box-head">
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
            <div className="open-box-body">
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
        </section>
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
      {hoverPreview && createPortal(
        <div className="hover-card-preview" style={{
          left: Math.max(12, Math.min(hoverPreview.x + 24, window.innerWidth - 300)),
          top: Math.max(12, Math.min(hoverPreview.y - 170, window.innerHeight - 430)),
        }} role="tooltip">
          <img src={hoverPreview.card.images.large || hoverPreview.card.images.small} alt={hoverPreview.card.name} />
          <div><span><strong>{hoverPreview.card.name}</strong><small>#{hoverPreview.card.number} · {hoverPreview.card.setId}</small></span><span className="hover-card-actions"><button onClick={() => { setMovingCardIds([hoverPreview.card.id]); setHoverPreview(null) }}>Move / file</button><button onClick={() => setHoverPreview(null)}>Close</button></span></div>
        </div>, document.body,
      )}
    </div>
  )
}
