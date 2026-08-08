/**
 * SpacesLivePage — the logged-in landing page ("/") and physical-collection
 * organizer. A Space has three live areas: Storage (real boxes stacked on
 * shelf units), Binder Library, and Display Gallery — all backed by the
 * Scala `RoomService`/`RoomRepository` endpoints.
 *
 * HOW IT WORKS
 *   Top-level state holds every Space, box, and binder the user owns,
 *   fetched once on mount. `view` switches which area renders without
 *   touching `loading` — only the initial load shows the full-page status
 *   screen; every later reload (after a mutation) is silent so the shell
 *   never blacks out. Each area owns its own local UI state (which shelf
 *   unit/display case is selected, which picker or modal is open) and
 *   calls back up to `reload` after a mutation.
 *
 *   The header search is a client-side filter over the Spaces/boxes/
 *   binders/display-cases already loaded — it does not search inside card
 *   contents, since that would need a dedicated backend search endpoint.
 *   Picking a result switches to the right Space/area and, for boxes and
 *   display cases, passes a `focus*Id` down so that area jumps straight to
 *   the object instead of just opening the area.
 *
 * DEPENDS ON: api/rooms, api/storage, api/binders, api/collection,
 *   components/CardPreview (site-wide card zoom overlay), components/Toast
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { useUser } from '../context/UserContext'
import { useToast } from '../components/Toast'
import { usePreview } from '../components/CardPreview'
import { createBinder, listBinders, updateBinder } from '../api/binders'
import { getOwnedCards } from '../api/collection'
import {
  createDisplayCase, createSpace, createStorageUnit, getCaseAllocations,
  getDrawerPlacements, getSpaceInventory, listSpaces, placeBinder, placeBox,
  placeCopies, removePlacement, setDisplayLights,
} from '../api/rooms'
import { createBox, createDrawer, listBoxes, updateBox } from '../api/storage'
import type {
  Binder, Card, CardAllocation, CollectionSpace, DisplayCaseType,
  DisplaySlot, InventoryLot, OwnedCard, PocketSize, SpaceType, StorageBox,
  StorageDrawer, StorageUnit, StorageUnitType,
} from '../types'
import '../styles/spaces-concept.css'

/** Every card thumbnail on this page zooms the same way: hover, click, or
 *  keyboard focus opens the site-wide CardPreview overlay (non-negotiable
 *  rule #10 — every card image needs a zoom/detail interaction). */
function ZoomableCardImage({ card, preview }: { card: Card; preview: ReturnType<typeof usePreview> }) {
  return (
    <img
      src={card.images.small} alt={card.name} tabIndex={0}
      onMouseEnter={() => preview.show(card.images.large || card.images.small)}
      onMouseLeave={() => preview.hide()}
      onClick={() => preview.show(card.images.large || card.images.small)}
      onFocus={() => preview.show(card.images.large || card.images.small)}
      onBlur={() => preview.hide()}
    />
  )
}

type View = 'home' | 'storage' | 'binders' | 'displays'

// ─── Presets ────────────────────────────────────────────────────────────────
// Every "+ Add ___" flow picks from one of these instead of a window.prompt,
// per the Spaces spec ("do not use browser prompts for creation forms").

interface BoxChoice { name: string; boxType: string; capacity: number; color: string; label: string }
const BOX_PRESETS: BoxChoice[] = [
  { name: '800 Count Box', boxType: 'long-800', capacity: 800, color: '#d8d0c0', label: 'Single-row long card box' },
  { name: '1600 Count Box', boxType: 'row-1600', capacity: 1600, color: '#315c73', label: 'Two-row storage box' },
  { name: '3200 Count Box', boxType: 'row-3200', capacity: 3200, color: '#98483e', label: 'Four-row monster box' },
  { name: '5000 Count Box', boxType: 'row-5000', capacity: 5000, color: '#50684c', label: 'Five-row monster box' },
  { name: 'Deck Box', boxType: 'deck-100', capacity: 100, color: '#68527a', label: 'Compact sleeved deck box' },
]

interface ShelfPreset {
  name: string; unitType: StorageUnitType; preset: string; color: string
  shelfCount: number; positionsPerShelf: number; maxStackHeight: number; label: string
}
const SHELF_PRESETS: ShelfPreset[] = [
  { name: 'Heavy-Duty Rack', unitType: 'rack', preset: 'heavy_duty_rack', color: '#4b4f52', shelfCount: 5, positionsPerShelf: 6, maxStackHeight: 4, label: 'Steel warehouse-style rack' },
  { name: 'Wood Collection Shelf', unitType: 'shelf', preset: 'wood_shelf', color: '#8a5a34', shelfCount: 4, positionsPerShelf: 5, maxStackHeight: 3, label: 'Classic wooden display shelf' },
  { name: 'Enclosed Cabinet', unitType: 'cabinet', preset: 'enclosed_cabinet', color: '#2c2f33', shelfCount: 3, positionsPerShelf: 4, maxStackHeight: 3, label: 'Doors keep dust off stacked boxes' },
  { name: 'Closet Storage', unitType: 'closet', preset: 'closet_storage', color: '#5c4b3a', shelfCount: 6, positionsPerShelf: 3, maxStackHeight: 5, label: 'Tall, narrow closet shelving' },
]

interface CasePreset {
  name: string; caseType: DisplayCaseType; preset: string; frameColor: string
  lightColor: string; shelfCount: number; slotsPerShelf: number; label: string
}
const CASE_PRESETS: CasePreset[] = [
  { name: 'Wall-Mounted Case', caseType: 'wall_case', preset: 'wall_mounted', frameColor: '#1c2024', lightColor: '#fff3d1', shelfCount: 2, slotsPerShelf: 4, label: 'Slim case that mounts to a wall' },
  { name: 'Lit Standing Cabinet', caseType: 'lit_cabinet', preset: 'collector_led', frameColor: '#17141F', lightColor: '#FFF1B8', shelfCount: 3, slotsPerShelf: 3, label: 'Floor cabinet with LED-lit shelves' },
  { name: 'Museum Vitrine', caseType: 'museum_vitrine', preset: 'museum_vitrine', frameColor: '#111619', lightColor: '#bfe3ff', shelfCount: 2, slotsPerShelf: 3, label: 'Glass-topped vitrine, cool white light' },
  { name: 'Floating Display Shelf', caseType: 'floating_shelf', preset: 'floating_shelf', frameColor: '#2a2420', lightColor: '#ffe3a5', shelfCount: 1, slotsPerShelf: 5, label: 'Minimal wall-floating ledge' },
  { name: 'Pedestal Case', caseType: 'pedestal', preset: 'pedestal_case', frameColor: '#151515', lightColor: '#ffffff', shelfCount: 1, slotsPerShelf: 1, label: 'Single-card spotlight pedestal' },
]

const SPACE_TYPES: { value: SpaceType; label: string }[] = [
  { value: 'collection_room', label: 'Collection Room' },
  { value: 'archive', label: 'Archive' },
  { value: 'trade_station', label: 'Trade Station' },
  { value: 'showcase', label: 'Showcase' },
  { value: 'custom', label: 'Custom' },
]

const BINDER_POCKETS: { value: PocketSize; label: string }[] = [
  { value: 'Four', label: '4-pocket' },
  { value: 'Nine', label: '9-pocket' },
  { value: 'Twelve', label: '12-pocket' },
]

const BINDER_SPINE_COLORS = ['#8b443b', '#315c75', '#66507b', '#b18642', '#4e684b', '#7a3e65', '#3c6e6b']

/** Deterministic so a binder's spine color survives reloads/reordering —
 *  there's no `color` column on binders yet, so this derives one from the
 *  immutable id instead of storing anything. */
function colorForBinder(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return BINDER_SPINE_COLORS[Math.abs(hash) % BINDER_SPINE_COLORS.length]
}

// ─── Header search ──────────────────────────────────────────────────────────

type SearchHit =
  | { kind: 'space'; id: string; label: string; sub: string }
  | { kind: 'box'; id: string; label: string; sub: string; spaceId?: string }
  | { kind: 'binder'; id: string; label: string; sub: string }
  | { kind: 'display'; id: string; label: string; sub: string; spaceId: string }

export function SpacesLivePage() {
  const { user } = useUser()
  const navigate = useNavigate()
  const toast = useToast()

  const [spaces, setSpaces] = useState<CollectionSpace[]>([])
  const [boxes, setBoxes] = useState<StorageBox[]>([])
  const [binders, setBinders] = useState<Binder[]>([])
  const [spaceId, setSpaceId] = useState('')
  const [view, setView] = useState<View>('home')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Passed down so Storage/Displays can jump straight to a search result
  // instead of just opening the area it lives in.
  const [focusBoxId, setFocusBoxId] = useState('')
  const [focusCaseId, setFocusCaseId] = useState('')

  const [addSpaceOpen, setAddSpaceOpen] = useState(false)
  const [query, setQuery] = useState('')

  const load = async (fullScreen = false) => {
    if (!user?.id) return
    if (fullScreen) setLoading(true)
    try {
      const [s, b, bi] = await Promise.all([listSpaces(user.id), listBoxes(user.id), listBinders(user.id)])
      setSpaces(s)
      setBoxes(b)
      setBinders(bi)
      setSpaceId(id => id || s.find(x => x.isDefault)?.id || s[0]?.id || '')
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load spaces')
    } finally {
      if (fullScreen) setLoading(false)
    }
  }
  useEffect(() => { void load(true) }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const space = spaces.find(x => x.id === spaceId) || spaces[0]
  // Legacy boxes/binders created before Spaces existed have no spaceId — they
  // belong to the default Space's "Unplaced" areas rather than disappearing.
  const roomBoxes = useMemo(
    () => boxes.filter(x => !space || x.spaceId === space.id || (space.isDefault && !x.spaceId)),
    [boxes, space],
  )
  const roomBinders = useMemo(
    () => binders.filter(x => !space || x.spaceId === space.id || (space.isDefault && !x.spaceId)),
    [binders, space],
  )

  const searchHits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const hits: SearchHit[] = []
    for (const s of spaces) if (s.name.toLowerCase().includes(q)) hits.push({ kind: 'space', id: s.id, label: s.name, sub: 'Space' })
    for (const b of boxes) if (b.name.toLowerCase().includes(q)) hits.push({ kind: 'box', id: b.id, label: b.name, sub: b.boxType ? `Box · ${b.boxType}` : 'Box', spaceId: b.spaceId })
    for (const bd of binders) if (bd.name.toLowerCase().includes(q)) hits.push({ kind: 'binder', id: bd.id, label: bd.name, sub: `Binder · ${bd.pocketSize} pocket` })
    for (const s of spaces) for (const c of s.displayCases) if (c.name.toLowerCase().includes(q)) hits.push({ kind: 'display', id: c.id, label: c.name, sub: `Display case · ${s.name}`, spaceId: s.id })
    return hits.slice(0, 12)
  }, [query, spaces, boxes, binders])

  const selectHit = (hit: SearchHit) => {
    setQuery('')
    // A box/binder with no spaceId is a legacy row that only ever shows up
    // inside the default Space's "Unplaced" area — never the currently
    // selected Space, which may not be the default one.
    const defaultSpaceId = spaces.find(s => s.isDefault)?.id || space?.id || ''
    if (hit.kind === 'space') { setSpaceId(hit.id); setView('home') }
    else if (hit.kind === 'box') { setSpaceId(hit.spaceId || defaultSpaceId); setView('storage'); setFocusBoxId(hit.id) }
    else if (hit.kind === 'binder') navigate(`/binder/${hit.id}`)
    else { setSpaceId(hit.spaceId); setView('displays'); setFocusCaseId(hit.id) }
  }

  const createNewSpace = async (name: string, spaceType: SpaceType) => {
    if (!user?.id) return
    try {
      const made = await createSpace(user.id, name, spaceType)
      setSpaces(x => [...x, made])
      setSpaceId(made.id)
      setAddSpaceOpen(false)
      toast(`Created ${made.name}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create that space.')
    }
  }

  // Spaces is "/" — the app's actual landing page — so it has to gate on
  // login itself rather than redirecting, or a logged-out visitor lands on
  // a permanent "Building your collection room…" screen with no way in.
  if (!user) return <main className="page-tracker spaces-concept"><LoginScreen /></main>

  if (loading) {
    return <main className="page-tracker spaces-concept"><div className="spaces-live-status">Building your collection room…</div></main>
  }

  return (
    <main className="page-tracker spaces-concept">
      <div id="app" style={{ display: 'block' }}>
        <header className="spaces-site-header">
          <button className="logo spaces-home-button" onClick={() => setView('home')}>MY <span>SPACES</span></button>
          <div className="user-badge">● <b>{user?.username || 'Collector'}</b></div>
          <div className="header-search-wrap">
            <input
              className="header-search"
              placeholder="Search spaces, boxes, binders, or display cases…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search your collection"
            />
            {searchHits.length > 0 && (
              <div className="search-results" role="listbox">
                {searchHits.map(hit => (
                  <button key={`${hit.kind}-${hit.id}`} role="option" onClick={() => selectHit(hit)}>
                    <b>{hit.label}</b><small>{hit.sub}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <HeaderNav />
        </header>

        {error && <div className="spaces-live-error"><span>{error}</span><button onClick={() => void load(true)}>Retry</button></div>}

        {space && view !== 'home' && (
          <nav className="section-nav">
            <button onClick={() => setView('home')}>‹ All spaces</button>
            <div>
              <button className={view === 'storage' ? 'active' : ''} onClick={() => setView('storage')}>
                <i>▦</i><span><b>Storage</b><small>{roomBoxes.length} boxes</small></span>
              </button>
              <button className={view === 'binders' ? 'active' : ''} onClick={() => setView('binders')}>
                <i>▥</i><span><b>Binder Library</b><small>{roomBinders.length} binders</small></span>
              </button>
              <button className={view === 'displays' ? 'active' : ''} onClick={() => setView('displays')}>
                <i>◇</i><span><b>Display Gallery</b><small>{space.displayCases.length} cases</small></span>
              </button>
            </div>
          </nav>
        )}

        {!space ? (
          <div className="spaces-live-status"><h2>No spaces yet</h2><button onClick={() => setAddSpaceOpen(true)}>Create a space</button></div>
        ) : view === 'home' ? (
          <Home space={space} spaces={spaces} boxes={roomBoxes} binders={roomBinders} onView={setView} onSelect={setSpaceId} onAdd={() => setAddSpaceOpen(true)} />
        ) : view === 'storage' ? (
          <Storage
            userId={user?.id || ''} space={space} boxes={roomBoxes} reload={load}
            focusBoxId={focusBoxId} clearFocus={() => setFocusBoxId('')}
          />
        ) : view === 'binders' ? (
          <Binders userId={user?.id || ''} space={space} binders={roomBinders} reload={load} open={id => navigate(`/spaces/${space.id}/binders/${id}`)} />
        ) : (
          <Displays
            userId={user?.id || ''} space={space} reload={load}
            focusCaseId={focusCaseId} clearFocus={() => setFocusCaseId('')}
          />
        )}
      </div>

      {addSpaceOpen && <AddSpaceModal onCancel={() => setAddSpaceOpen(false)} onCreate={createNewSpace} />}
    </main>
  )
}

// ─── Add Space ──────────────────────────────────────────────────────────────

function AddSpaceModal({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, spaceType: SpaceType) => void }) {
  const [name, setName] = useState('')
  const [spaceType, setSpaceType] = useState<SpaceType>('collection_room')
  const [touched, setTouched] = useState(false)

  const submit = () => {
    setTouched(true)
    if (!name.trim()) return
    onCreate(name.trim(), spaceType)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal">
        <h3>+ Add Space</h3>
        <label className="modal-field">
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Back Room Archive" autoFocus />
        </label>
        {touched && !name.trim() && <p className="modal-error">A space needs a name.</p>}
        <label className="modal-field">
          Type
          <select value={spaceType} onChange={e => setSpaceType(e.target.value as SpaceType)}>
            {SPACE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <div className="modal-btns">
          <button className="tb-btn" onClick={onCancel}>Cancel</button>
          <button className="tb-btn primary" onClick={submit}>Create Space</button>
        </div>
      </div>
    </div>
  )
}

// ─── Home ───────────────────────────────────────────────────────────────────

function Home({ space, spaces, boxes, binders, onView, onSelect, onAdd }: {
  space: CollectionSpace; spaces: CollectionSpace[]; boxes: StorageBox[]; binders: Binder[]
  onView: (v: View) => void; onSelect: (id: string) => void; onAdd: () => void
}) {
  return (
    <section className="spaces-home">
      <header>
        <small>YOUR CARD-COLLECTING WORLD</small>
        <h1>Every discovery has a place.</h1>
        <p>Organize physical boxes, binders, variants, conditions, and display copies.</p>
        <div className="atlas-elements">
          <span className="ember">△ Ember</span><span className="tide">≈ Tide</span><span className="grove">◇ Grove</span>
          <span className="spark">ϟ Spark</span><span className="aether">✦ Aether</span>
        </div>
      </header>

      <div className="main-space">
        <div className="space-art">
          <div className="space-architecture">
            <div className="art-storage"><i /><i /><i /><i /><i /><i /></div>
            <div className="art-binders"><i /><i /><i /><i /><i /></div>
            <div className="art-case"><span /><span /><span /><span /></div>
            <div className="atlas-compass"><i /><b>✦</b></div>
          </div>
        </div>
        <div className="space-info">
          <small>{space.isDefault ? 'PRIMARY COLLECTION SPACE' : space.spaceType.replaceAll('_', ' ').toUpperCase()}</small>
          <h2>{space.name}</h2>
          <p>One room with three distinct, live collection areas.</p>
          <div className="space-destinations">
            <button onClick={() => onView('storage')}>
              <i>▦</i><span><b>Storage</b><small>{boxes.length} stackable boxes · {space.storageUnits.length} shelf units</small></span><strong>›</strong>
            </button>
            <button onClick={() => onView('binders')}>
              <i>▥</i><span><b>Binder Library</b><small>{binders.length} physical binders</small></span><strong>›</strong>
            </button>
            <button onClick={() => onView('displays')}>
              <i>✦</i><span><b>Display Gallery</b><small>{space.displayCases.length} illuminated cases</small></span><strong>›</strong>
            </button>
          </div>
        </div>
      </div>

      <div className="other-spaces">
        <header><h3>Your other spaces</h3><button onClick={onAdd}>+ Add space</button></header>
        <div>
          {spaces.filter(x => x.id !== space.id).map((x, i) => (
            <button key={x.id} onClick={() => onSelect(x.id)}>
              <i className={`other-icon icon-${i % 3}`} />
              <span><b>{x.name}</b><small>{x.storageUnits.length} storage units · {x.displayCases.length} cases</small></span>
              <strong>›</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Storage ────────────────────────────────────────────────────────────────

function Storage({ userId, space, boxes, reload, focusBoxId, clearFocus }: {
  userId: string; space: CollectionSpace; boxes: StorageBox[]; reload: () => Promise<void>
  focusBoxId: string; clearFocus: () => void
}) {
  const [unitId, setUnitId] = useState(space.storageUnits[0]?.id || '')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<{ box: StorageBox; drawer: StorageDrawer } | null>(null)
  const [opening, setOpening] = useState('')
  const [picking, setPicking] = useState(false)
  const [pickingUnit, setPickingUnit] = useState(false)
  // The box currently armed to be placed — set by either an HTML5 drag or
  // the keyboard/tap-friendly "Move" button, so both paths share one drop().
  const [armed, setArmed] = useState('')

  const unit = space.storageUnits.find(x => x.id === unitId) || space.storageUnits[0]

  // A search result for a box jumps straight to its shelf unit and opens it.
  useEffect(() => {
    if (!focusBoxId) return
    const box = boxes.find(x => x.id === focusBoxId)
    if (!box) return
    if (box.storageUnitId) setUnitId(box.storageUnitId)
    setOpening(box.id)
    clearFocus()
  }, [focusBoxId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createUnit = async (preset: ShelfPreset | { name: string; unitType: StorageUnitType; color: string; shelfCount: number; positionsPerShelf: number; maxStackHeight: number }) => {
    setPickingUnit(false)
    try {
      const made = await createStorageUnit(userId, {
        spaceId: space.id, name: preset.name, unitType: preset.unitType, preset: 'preset' in preset ? preset.preset : 'custom',
        color: preset.color, shelfCount: preset.shelfCount, positionsPerShelf: preset.positionsPerShelf, maxStackHeight: preset.maxStackHeight,
      })
      setUnitId(made.id)
      await reload()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add that shelf unit.')
    }
  }

  const createChosen = async (choice: BoxChoice) => {
    setPicking(false)
    setMessage('Creating and placing box…')
    try {
      let target = unit
      if (!target) {
        target = await createStorageUnit(userId, { spaceId: space.id, name: 'Collector Rack', unitType: 'rack', preset: 'collector_rack', color: '#76533A', shelfCount: 4, positionsPerShelf: 5, maxStackHeight: 3 })
        setUnitId(target.id)
      }
      let shelfIndex = -1, stackIndex = -1, stackLevel = 0
      for (let shelf = 0; shelf < target.shelfCount && shelfIndex < 0; shelf++) {
        for (let stack = 0; stack < target.positionsPerShelf; stack++) {
          const pile = boxes.filter(x => x.storageUnitId === target!.id && x.shelfIndex === shelf && x.stackIndex === stack)
          if (pile.length < target.maxStackHeight) { shelfIndex = shelf; stackIndex = stack; stackLevel = pile.length; break }
        }
      }
      if (shelfIndex < 0) throw new Error('This shelf unit is full. Add another shelf unit first.')
      const made = await createBox(userId, choice.name, choice.boxType, choice.capacity, choice.color)
      await createDrawer(made.id, 'Main compartment')
      await placeBox(userId, made.id, { spaceId: space.id, unitId: target.id, shelfIndex, stackIndex, stackLevel })
      await reload()
      setMessage(`${choice.name} was added to Shelf ${String.fromCharCode(65 + shelfIndex)}, stack ${stackIndex + 1}.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add the box.')
    }
  }

  // Opening animation runs for 520ms before the workspace swaps in, so the
  // box visibly lifts/opens instead of jump-cutting to the inventory view.
  useEffect(() => {
    if (!opening || selected) return
    const box = boxes.find(x => x.id === opening)
    if (!box) return
    void (async () => {
      try {
        const drawer = box.drawers[0] || await createDrawer(box.id, 'Main compartment')
        window.setTimeout(() => { setSelected({ box, drawer }); setOpening('') }, 520)
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Could not open this box.')
        setOpening('')
      }
    })()
  }, [opening]) // eslint-disable-line react-hooks/exhaustive-deps

  const drop = async (shelf: number, stack: number) => {
    if (!unit || !armed) return
    const current = boxes.filter(x => x.storageUnitId === unit.id && x.shelfIndex === shelf && x.stackIndex === stack)
    if (current.length >= unit.maxStackHeight) { setMessage('That stack is already at its maximum height.'); return }
    const boxId = armed
    setArmed('')
    try {
      await placeBox(userId, boxId, { spaceId: space.id, unitId: unit.id, shelfIndex: shelf, stackIndex: stack, stackLevel: current.length })
      await reload()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not place that box there.')
    }
  }

  if (selected) {
    return (
      <BoxInventory
        userId={userId} box={selected.box} drawer={selected.drawer}
        otherBoxes={boxes.filter(b => b.id !== selected.box.id)}
        close={() => setSelected(null)} onRenamed={reload}
      />
    )
  }
  if (picking) return <BoxPicker cancel={() => setPicking(false)} choose={choice => void createChosen(choice)} />
  if (pickingUnit) return <ShelfUnitPicker cancel={() => setPickingUnit(false)} choose={choice => void createUnit(choice)} />

  return (
    <section className="storage-view box-unit-view">
      <header className="gallery-heading">
        <div><small>{space.name.toUpperCase()} / STORAGE</small><h2>Card Archive</h2><p>{boxes.length} real boxes · drag and stack vertically</p></div>
        <div><button onClick={() => setPickingUnit(true)}>+ Shelf unit</button><button className="primary" onClick={() => setPicking(true)}>+ Box</button></div>
      </header>

      {message && <div className="spaces-action-message">{message}</div>}
      {armed && (
        <div className="spaces-action-message moving-banner">
          <span>Moving <b>{boxes.find(b => b.id === armed)?.name}</b> — tap a shelf position to place it.</span>
          <button onClick={() => setArmed('')}>Cancel</button>
        </div>
      )}

      <div className="live-unit-tabs">
        {space.storageUnits.map(x => (
          <button className={unit?.id === x.id ? 'active' : ''} onClick={() => setUnitId(x.id)} key={x.id}>
            {x.name}<small>{boxes.filter(b => b.storageUnitId === x.id).length} boxes</small>
          </button>
        ))}
      </div>

      {!unit ? (
        <div className="spaces-live-status"><h2>No furniture yet</h2><button onClick={() => setPickingUnit(true)}>Add a shelf unit</button></div>
      ) : (
        <div className="physical-shelving">
          {Array.from({ length: unit.shelfCount }, (_, shelf) => (
            <section className="physical-shelf" key={shelf}>
              <header><span>SHELF {String.fromCharCode(65 + shelf)}</span><b>{unit.positionsPerShelf} POSITIONS · STACK {unit.maxStackHeight} HIGH</b></header>
              <div className="physical-shelf-bay">
                {Array.from({ length: unit.positionsPerShelf }, (_, stack) => {
                  const pile = boxes.filter(x => x.storageUnitId === unit.id && x.shelfIndex === shelf && x.stackIndex === stack)
                    .sort((a, b) => (a.stackLevel || 0) - (b.stackLevel || 0))
                  return (
                    <div
                      className={`stack-position ${armed ? 'drop-ready' : ''}`}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => void drop(shelf, stack)}
                      key={stack}
                    >
                      {pile.map(box => {
                        const capacity = box.capacity || 0
                        const boxFilled = box.drawers.reduce((n, d) => n + d.cardCount, 0)
                        const fillState = capacity > 0 && boxFilled >= capacity ? 'box-over' : capacity > 0 && boxFilled / capacity >= 0.85 ? 'box-near' : ''
                        return (
                          // A <div role="button"> here, not a <button> — it
                          // holds a real nested <button> (Move), and a
                          // button can't legally contain another button.
                          <div
                            key={box.id}
                            role="button" tabIndex={0}
                            draggable
                            onDragStart={() => setArmed(box.id)}
                            onDragEnd={() => setArmed('')}
                            onClick={() => { setOpening(box.id); window.setTimeout(() => setOpening(''), 650) }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpening(box.id); window.setTimeout(() => setOpening(''), 650) } }}
                            className={`physical-box box-model-${box.boxType || 'custom'} ${fillState} ${opening === box.id ? 'is-open opening-to-inventory' : ''}`}
                            style={{ '--chosen-box-color': box.color || '#d8d0c0' } as React.CSSProperties}
                          >
                            <span className="box-lid" />
                            <span className="box-handles"><i /><i /></span>
                            <button
                              type="button"
                              className="box-move-btn"
                              aria-label={`Move ${box.name}`}
                              onClick={e => { e.stopPropagation(); setArmed(box.id) }}
                            >⇅</button>
                            <span className="box-label">
                              <strong>{box.name}</strong>
                              <small>{boxFilled} / {box.capacity || 'custom'} cards{fillState === 'box-over' ? ' · FULL' : fillState === 'box-near' ? ' · nearly full' : ''}</small>
                            </span>
                            <span className="box-open-hint">{opening === box.id ? 'OPENING…' : `LEVEL ${(box.stackLevel || 0) + 1} · DRAG OR MOVE`}</span>
                          </div>
                        )
                      })}
                      <button className="stack-drop" disabled={pile.length >= unit.maxStackHeight} onClick={() => void drop(shelf, stack)}>
                        {pile.length ? 'DROP ON TOP' : '+ DROP BOX'}
                      </button>
                    </div>
                  )
                })}
              </div>
              <footer><i /><span>BOXES FACE FORWARD AND EXTEND INTO THE SHELF</span><i /></footer>
            </section>
          ))}
        </div>
      )}

      <aside className="unplaced-boxes">
        <b>UNPLACED BOXES</b>
        {boxes.filter(x => !x.storageUnitId).map(box => (
          <div className="unplaced-box-row" draggable onDragStart={() => setArmed(box.id)} onDragEnd={() => setArmed('')} key={box.id}>
            <i style={{ background: box.color }} />
            <span>{box.name}<small>{box.boxType} · drag onto a shelf, or tap Move below</small></span>
            <button type="button" className="box-move-btn inline" onClick={() => setArmed(box.id)}>⇅ Move</button>
          </div>
        ))}
      </aside>
    </section>
  )
}

function ShelfUnitPicker({ cancel, choose }: { cancel: () => void; choose: (preset: ShelfPreset | { name: string; unitType: StorageUnitType; color: string; shelfCount: number; positionsPerShelf: number; maxStackHeight: number }) => void }) {
  const [custom, setCustom] = useState(false)
  const [name, setName] = useState('Custom Shelf Unit')
  const [shelfCount, setShelfCount] = useState(4)
  const [positionsPerShelf, setPositionsPerShelf] = useState(5)
  const [maxStackHeight, setMaxStackHeight] = useState(3)
  const [color, setColor] = useState('#5c4b3a')

  return (
    <section className="box-picker-live">
      <header className="gallery-heading">
        <div><button className="inline-back" onClick={cancel}>← Storage</button><small>SHELF UNIT LIBRARY</small><h2>Choose your furniture</h2><p>Shelf count, positions, and stack height come from the preset you own.</p></div>
      </header>
      <div className="box-preset-grid">
        {SHELF_PRESETS.map(preset => (
          <button key={preset.preset} onClick={() => choose(preset)} style={{ '--preset-color': preset.color } as React.CSSProperties}>
            <i className="preset-box shelf-preset-icon"><span /></i>
            <span><b>{preset.name}</b><small>{preset.label}</small><strong>{preset.shelfCount} shelves · {preset.positionsPerShelf}/shelf · {preset.maxStackHeight} high</strong></span>
          </button>
        ))}
        <button onClick={() => setCustom(true)}>
          <i className="preset-box custom"><span /></i>
          <span><b>Custom shelf unit</b><small>Your shelf count, positions, and color</small><strong>Configure</strong></span>
        </button>
      </div>
      {custom && (
        <div className="custom-box-builder">
          <h3>Custom shelf unit</h3>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Shelves<input type="number" min="1" max="10" value={shelfCount} onChange={e => setShelfCount(Math.max(1, Number(e.target.value)))} /></label>
          <label>Positions/shelf<input type="number" min="1" max="10" value={positionsPerShelf} onChange={e => setPositionsPerShelf(Math.max(1, Number(e.target.value)))} /></label>
          <label>Max stack height<input type="number" min="1" max="8" value={maxStackHeight} onChange={e => setMaxStackHeight(Math.max(1, Number(e.target.value)))} /></label>
          <label>Color<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
          <button onClick={() => choose({ name: name.trim() || 'Custom Shelf Unit', unitType: 'custom', color, shelfCount, positionsPerShelf, maxStackHeight })}>Create shelf unit</button>
        </div>
      )}
    </section>
  )
}

// ─── Box inventory workspace ────────────────────────────────────────────────

function BoxInventory({ userId, box, drawer, otherBoxes, close, onRenamed }: {
  userId: string; box: StorageBox; drawer: StorageDrawer; otherBoxes: StorageBox[]
  close: () => void; onRenamed: () => Promise<void>
}) {
  const [lots, setLots] = useState<InventoryLot[]>([])
  const [placements, setPlacements] = useState<CardAllocation[]>([])
  const [owned, setOwned] = useState<OwnedCard[]>([])
  const [message, setMessage] = useState('Loading inventory…')
  const [search, setSearch] = useState('')
  const [conditionFilter, setConditionFilter] = useState('')
  const [protectionFilter, setProtectionFilter] = useState('')
  const [variantFilter, setVariantFilter] = useState('')
  const [setFilter, setSetFilter] = useState('')
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [sort, setSort] = useState<'name' | 'condition' | 'number'>('name')
  const [renaming, setRenaming] = useState(false)
  const [movingAllocation, setMovingAllocation] = useState<CardAllocation | null>(null)
  // Tracks the last name known to be saved (starts as the prop, then
  // whatever the box was last renamed to) — `box` itself is never mutated,
  // so this is what the "cancel edit" / failed-save paths revert to.
  const [savedName, setSavedName] = useState(box.name)
  const [name, setName] = useState(box.name)
  const preview = usePreview()

  const load = async () => {
    try {
      const [nextLots, nextPlacements, nextOwned] = await Promise.all([
        getSpaceInventory(userId), getDrawerPlacements(userId, drawer.id), getOwnedCards(userId),
      ])
      setLots(nextLots); setPlacements(nextPlacements); setOwned(nextOwned); setMessage('')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load box inventory.')
    }
  }
  useEffect(() => { void load() }, [drawer.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardFor = (cardId: string) => owned.find(x => x.cardId === cardId)?.card

  const add = async (lot: InventoryLot) => {
    setMessage('Placing one copy…')
    try { await placeCopies(userId, { lotId: lot.id, drawerId: drawer.id, quantity: 1, protection: 'raw' }); await load() }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not place this copy.') }
  }
  const remove = async (allocation: CardAllocation) => {
    setMessage('Removing copy…')
    try { await removePlacement(userId, allocation.id); await load() }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not remove this copy.') }
  }
  const moveTo = async (allocation: CardAllocation, target: StorageBox) => {
    setMovingAllocation(null)
    setMessage(`Moving to ${target.name}…`)
    try {
      // No atomic "move" endpoint exists — remove first, then place, so the
      // in-flight total never reads as over-allocated. If the second step
      // fails the copy is left unplaced rather than silently duplicated.
      await removePlacement(userId, allocation.id)
      const targetDrawer = target.drawers[0] || await createDrawer(target.id, 'Main compartment')
      await placeCopies(userId, { lotId: allocation.lotId, drawerId: targetDrawer.id, quantity: allocation.quantity, protection: allocation.protection })
      // load() ends by clearing the message on success, so set the final
      // message AFTER it settles, not before — otherwise load() immediately
      // wipes out whatever we just told the user.
      await load()
      setMessage(`Moved to ${target.name}.`)
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? `Removed from this box, but could not place it in ${target.name}: ${e.message}` : 'Could not move this copy.')
    }
  }
  const saveName = async () => {
    const trimmed = name.trim()
    setRenaming(false)
    if (!trimmed || trimmed === savedName) { setName(savedName); return }
    try { await updateBox(box.id, { name: trimmed }); setSavedName(trimmed); await onRenamed() }
    catch { setMessage('Could not rename this box.'); setName(savedName) }
  }

  const q = search.trim().toLowerCase()
  const matchesLot = (lot: InventoryLot | undefined) => {
    if (!lot) return true
    if (conditionFilter && lot.condition !== conditionFilter) return false
    if (variantFilter && lot.variantKey !== variantFilter) return false
    if (setFilter && cardFor(lot.cardId)?.setId !== setFilter) return false
    if (duplicatesOnly && lot.quantity <= 1) return false
    if (q && !(cardFor(lot.cardId)?.name.toLowerCase().includes(q) ?? false)) return false
    return true
  }
  const matchesAllocation = (a: CardAllocation) => {
    if (protectionFilter && (a.protection || 'raw') !== protectionFilter) return false
    return matchesLot(lots.find(l => l.id === a.lotId))
  }
  const byChosenSort = (aLot?: InventoryLot, bLot?: InventoryLot) => {
    if (sort === 'condition') return (aLot?.condition || '').localeCompare(bLot?.condition || '')
    if (sort === 'number') return (cardFor(aLot?.cardId || '')?.number || '').localeCompare(cardFor(bLot?.cardId || '')?.number || '', undefined, { numeric: true })
    return (cardFor(aLot?.cardId || '')?.name || '').localeCompare(cardFor(bLot?.cardId || '')?.name || '')
  }

  const conditions = [...new Set(lots.map(l => l.condition))].sort()
  const protections = [...new Set(placements.map(a => a.protection || 'raw'))].sort()
  const variants = [...new Set(lots.map(l => l.variantKey))].sort()
  // Set names aren't loaded here (only setId) — showing the id keeps this
  // filter honest without pulling in a full set catalog fetch just for it.
  const sets = [...new Set(lots.map(l => cardFor(l.cardId)?.setId).filter((s): s is string => !!s))].sort()

  const insideBox = placements.filter(matchesAllocation).sort((a, b) => byChosenSort(lots.find(l => l.id === a.lotId), lots.find(l => l.id === b.lotId)))
  const available = lots.filter(lot => lot.quantity - lot.allocated > 0 && matchesLot(lot)).sort(byChosenSort).slice(0, 40)

  return (
    <section className="inside-box-view">
      <header>
        <button onClick={close}>← Back to shelf</button>
        <div>
          <small>OPEN PHYSICAL BOX</small>
          {renaming ? (
            <input
              className="edit-box-name" autoFocus value={name}
              onChange={e => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(savedName); setRenaming(false) } }}
            />
          ) : (
            <h2 onClick={() => setRenaming(true)} title="Click to rename" style={{ cursor: 'pointer' }}>{savedName} <small style={{ fontSize: 11, opacity: 0.6 }}>✎ edit</small></h2>
          )}
          <p>{box.boxType} · {placements.reduce((n, x) => n + x.quantity, 0)} of {box.capacity || 'custom'} cards tracked</p>
        </div>
      </header>

      {message && <div className="spaces-action-message">{message}</div>}

      <div className="inventory-workspace">
        <section className="inventory-open-box rows-1" style={{ '--inventory-box': box.color || '#d8d0c0' } as React.CSSProperties}>
          <div className="inventory-lid"><b>{savedName}</b></div>
          <div className="inventory-well"><div className="inventory-lane"><span>MAIN COMPARTMENT</span>{placements.slice(0, 28).map(x => <i key={x.id} />)}</div></div>
        </section>

        <aside>
          <label className="inventory-search"><span>🔍</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search inside this box…" /></label>

          <div className="inventory-filters">
            <select value={sort} onChange={e => setSort(e.target.value as 'name' | 'condition' | 'number')}>
              <option value="name">Sort: Name</option>
              <option value="number">Sort: Number</option>
              <option value="condition">Sort: Condition</option>
            </select>
            <select value={conditionFilter} onChange={e => setConditionFilter(e.target.value)}>
              <option value="">All conditions</option>
              {conditions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={variantFilter} onChange={e => setVariantFilter(e.target.value)}>
              <option value="">All variants</option>
              {variants.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={protectionFilter} onChange={e => setProtectionFilter(e.target.value)}>
              <option value="">All protection</option>
              {protections.map(p => <option key={p} value={p}>{p.replaceAll('_', ' ')}</option>)}
            </select>
            <select value={setFilter} onChange={e => setSetFilter(e.target.value)}>
              <option value="">All sets</option>
              {sets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="inventory-duplicates-toggle">
              <input type="checkbox" checked={duplicatesOnly} onChange={e => setDuplicatesOnly(e.target.checked)} />
              Duplicates only
            </label>
          </div>

          <h3>Inside this box</h3>
          {insideBox.map(allocation => {
            const lot = lots.find(x => x.id === allocation.lotId)
            const card = lot && cardFor(lot.cardId)
            return (
              <div className="box-copy-row" key={allocation.id}>
                {card && <ZoomableCardImage card={card} preview={preview} />}
                <span><b>{card?.name || lot?.cardId || 'Card'}</b><small>{lot?.condition} · {lot?.variantKey} · {lot?.edition} · {allocation.quantity} copy</small></span>
                <span className="box-copy-actions">
                  <button onClick={() => setMovingAllocation(allocation)} disabled={!otherBoxes.length} title={otherBoxes.length ? 'Move to another box' : 'No other boxes in this space yet'}>Move</button>
                  <button onClick={() => void remove(allocation)}>Remove</button>
                </span>
              </div>
            )
          })}
          {!placements.length && <p>This box is empty.</p>}
          {placements.length > 0 && !insideBox.length && <p>Nothing here matches that search/filter.</p>}

          <h3>Available owned copies</h3>
          {available.map(lot => {
            const card = cardFor(lot.cardId)
            return (
              <div className="box-copy-row" key={lot.id}>
                {card && <ZoomableCardImage card={card} preview={preview} />}
                <span><b>{card?.name || lot.cardId}</b><small>{lot.condition} · {lot.variantKey} · {lot.edition} · {lot.quantity - lot.allocated} available</small></span>
                <button onClick={() => void add(lot)}>+ Add one</button>
              </div>
            )
          })}
        </aside>
      </div>

      {movingAllocation && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setMovingAllocation(null) }}>
          <div className="modal">
            <h3>Move to another box</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
              {otherBoxes.map(b => (
                <button key={b.id} className="tb-btn" style={{ justifyContent: 'flex-start' }} onClick={() => void moveTo(movingAllocation, b)}>{b.name}</button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>Moving to a binder or display slot isn't supported yet — the backend has no way to list a binder's open slots for this system.</p>
            <div className="modal-btns"><button className="tb-btn" onClick={() => setMovingAllocation(null)}>Cancel</button></div>
          </div>
        </div>
      )}
      {preview.overlay}
    </section>
  )
}

function BoxPicker({ cancel, choose }: { cancel: () => void; choose: (choice: BoxChoice) => void }) {
  const [custom, setCustom] = useState(false)
  const [name, setName] = useState('Custom Card Box')
  const [capacity, setCapacity] = useState(1000)
  const [color, setColor] = useState('#b78a43')

  return (
    <section className="box-picker-live">
      <header className="gallery-heading">
        <div><button className="inline-back" onClick={cancel}>← Storage</button><small>REAL-WORLD BOX LIBRARY</small><h2>Choose your physical box</h2><p>Capacity and front profile stay tied to the format you own.</p></div>
      </header>
      <div className="box-preset-grid">
        {BOX_PRESETS.map(choice => (
          <button key={choice.boxType} onClick={() => choose(choice)} style={{ '--preset-color': choice.color } as React.CSSProperties}>
            <i className={`preset-box box-model-${choice.boxType}`}><span /></i>
            <span><b>{choice.name}</b><small>{choice.label}</small><strong>{choice.capacity.toLocaleString()} cards</strong></span>
          </button>
        ))}
        <button onClick={() => setCustom(true)}>
          <i className="preset-box custom"><span /></i>
          <span><b>Custom box</b><small>Your dimensions, capacity, and color</small><strong>Configure</strong></span>
        </button>
      </div>
      {custom && (
        <div className="custom-box-builder">
          <h3>Custom box</h3>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Capacity<input type="number" min="1" value={capacity} onChange={e => setCapacity(Math.max(1, Number(e.target.value)))} /></label>
          <label>Color<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
          <button onClick={() => choose({ name: name.trim() || 'Custom Card Box', boxType: 'custom', capacity, color, label: 'Custom physical box' })}>Create custom box</button>
        </div>
      )}
    </section>
  )
}

// ─── Binder Library ─────────────────────────────────────────────────────────

/** Scans a shelf unit's binder positions (shelfIndex × positionsPerShelf, the
 *  same coordinate space `placeBinder` writes to) for the first one nobody's
 *  binder already claims — mirrors how box placement finds an open stack. */
function firstOpenBinderPosition(unit: StorageUnit, placed: Binder[]): { shelfIndex: number; shelfPosition: number } | null {
  for (let shelf = 0; shelf < unit.shelfCount; shelf++) {
    for (let position = 0; position < unit.positionsPerShelf; position++) {
      const taken = placed.some(b => b.storageUnitId === unit.id && b.shelfIndex === shelf && b.shelfPosition === position)
      if (!taken) return { shelfIndex: shelf, shelfPosition: position }
    }
  }
  return null
}

function Binders({ userId, space, binders, reload, open }: {
  userId: string; space: CollectionSpace; binders: Binder[]; reload: () => Promise<void>; open: (id: string) => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const toast = useToast()

  const create = async (name: string, pocketSize: PocketSize, unitId: string, coverImage: string) => {
    try {
      const made = await createBinder(userId, name, pocketSize)
      const unit = space.storageUnits.find(u => u.id === unitId)
      if (unit) {
        const spot = firstOpenBinderPosition(unit, binders)
        if (spot) await placeBinder(userId, made.id, { spaceId: space.id, unitId: unit.id, ...spot })
        else toast(`${name} was created but ${unit.name} has no open position — it's unplaced.`)
      }
      if (coverImage.trim()) await updateBinder(userId, made.id, { coverImage: coverImage.trim() })
      setAddOpen(false)
      await reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create that binder.')
    }
  }

  return (
    <section className="binder-view">
      <header className="gallery-heading">
        <div><small>COLLECTION ROOM / BINDERS</small><h2>Field Guide Library</h2><p>{binders.length} physical binders</p></div>
        <button className="primary" onClick={() => setAddOpen(true)}>+ Add binder</button>
      </header>
      <div className="binder-room">
        <div className="binder-shelf-title"><small>COLLECTION SHELF</small><b>YOUR BINDERS</b></div>
        <div className="binder-bookcase">
          {binders.map(b => (
            <button key={b.id} onClick={() => open(b.id)} style={{ '--binder': colorForBinder(b.id) } as React.CSSProperties}>
              <i className="binder-ring" /><span>{b.name}</span>
              <small>{b.pocketSize.toUpperCase()} POCKET · {b.storageUnitId ? `SHELF ${String.fromCharCode(65 + (b.shelfIndex ?? 0))}` : 'UNPLACED'}</small>
              <em />
            </button>
          ))}
          {!binders.length && <div className="binder-empty"><b>No binders here yet</b><span>Add your first binder.</span></div>}
        </div>
        <div className="binder-plank" />
      </div>
      {addOpen && <AddBinderModal space={space} onCancel={() => setAddOpen(false)} onCreate={create} />}
    </section>
  )
}

function AddBinderModal({ space, onCancel, onCreate }: {
  space: CollectionSpace; onCancel: () => void
  onCreate: (name: string, pocketSize: PocketSize, unitId: string, coverImage: string) => void
}) {
  const [name, setName] = useState('')
  const [pocketSize, setPocketSize] = useState<PocketSize>('Nine')
  const [unitId, setUnitId] = useState('')
  const [coverImage, setCoverImage] = useState('')
  const [touched, setTouched] = useState(false)

  const submit = () => {
    setTouched(true)
    if (!name.trim()) return
    onCreate(name.trim(), pocketSize, unitId, coverImage)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal">
        <h3>+ Add Binder</h3>
        <label className="modal-field">
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Base Set Master Binder" autoFocus />
        </label>
        {touched && !name.trim() && <p className="modal-error">A binder needs a name.</p>}
        <label className="modal-field">
          Pocket format
          <select value={pocketSize} onChange={e => setPocketSize(e.target.value as PocketSize)}>
            {BINDER_POCKETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label className="modal-field">
          Shelf placement
          <select value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Leave unplaced</option>
            {space.storageUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="modal-field">
          Cover image URL <span style={{ fontWeight: 400 }}>(optional)</span>
          <input value={coverImage} onChange={e => setCoverImage(e.target.value)} placeholder="https://…" />
        </label>
        <div className="modal-btns">
          <button className="tb-btn" onClick={onCancel}>Cancel</button>
          <button className="tb-btn primary" onClick={submit}>Create Binder</button>
        </div>
      </div>
    </div>
  )
}

// ─── Display Gallery ────────────────────────────────────────────────────────

function Displays({ userId, space, reload, focusCaseId, clearFocus }: {
  userId: string; space: CollectionSpace; reload: () => Promise<void>; focusCaseId: string; clearFocus: () => void
}) {
  const [caseId, setCaseId] = useState(space.displayCases[0]?.id || '')
  const [picking, setPicking] = useState(false)
  const [lots, setLots] = useState<InventoryLot[]>([])
  const [owned, setOwned] = useState<OwnedCard[]>([])
  const [placements, setPlacements] = useState<CardAllocation[]>([])
  const [activeSlot, setActiveSlot] = useState<DisplaySlot | null>(null)
  const [message, setMessage] = useState('')
  const preview = usePreview()

  const display = space.displayCases.find(c => c.id === caseId) || space.displayCases[0]

  useEffect(() => {
    if (focusCaseId) { setCaseId(focusCaseId); clearFocus() }
  }, [focusCaseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadContents = async () => {
    if (!display) return
    try {
      const [nextLots, nextOwned, nextPlacements] = await Promise.all([
        getSpaceInventory(userId), getOwnedCards(userId), getCaseAllocations(userId, display.id),
      ])
      setLots(nextLots); setOwned(nextOwned); setPlacements(nextPlacements)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load this display case.')
    }
  }
  useEffect(() => { void loadContents() }, [display?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const cardFor = (cardId: string) => owned.find(x => x.cardId === cardId)?.card
  const allocationFor = (slotId: string) => placements.find(a => a.displaySlotId === slotId)

  const add = async (lot: InventoryLot) => {
    if (!activeSlot) return
    setMessage('Placing one copy…')
    try { await placeCopies(userId, { lotId: lot.id, displaySlotId: activeSlot.id, quantity: 1, protection: 'raw' }); await loadContents(); setMessage('') }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not place this copy in that slot.') }
  }
  const remove = async (allocation: CardAllocation) => {
    setMessage('Removing copy…')
    try { await removePlacement(userId, allocation.id); await loadContents(); setMessage('') }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not remove this copy.') }
  }

  const addCase = async (preset: CasePreset) => {
    setPicking(false)
    try {
      const made = await createDisplayCase(userId, { spaceId: space.id, name: preset.name, caseType: preset.caseType, preset: preset.preset, frameColor: preset.frameColor, lightColor: preset.lightColor, shelfCount: preset.shelfCount, slotsPerShelf: preset.slotsPerShelf })
      setCaseId(made.id)
      await reload()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add that display case.')
    }
  }
  const toggle = async () => {
    if (!display) return
    try { await setDisplayLights(userId, display.id, !display.lightEnabled); await reload() }
    catch { setMessage('Could not toggle lighting.') }
  }

  if (picking) return <DisplayCasePicker cancel={() => setPicking(false)} choose={choice => void addCase(choice)} />

  const shelves = display ? Array.from({ length: display.shelfCount }, (_, s) => display.slots.filter(sl => sl.shelfIndex === s).sort((a, b) => a.slotIndex - b.slotIndex)) : []
  const occupiedCount = display ? display.slots.filter(sl => allocationFor(sl.id)).length : 0

  return (
    <section className={`display-gallery ${display?.lightEnabled ? 'lights-on' : 'lights-off'}`}>
      <header className="gallery-heading">
        <div>
          <small>{space.name.toUpperCase()} / DISPLAYS</small>
          <h2>{display?.name || 'Discovery Gallery'}</h2>
          <p>{display ? `${occupiedCount} / ${display.slots.length} slots filled` : 'No display case yet'}</p>
        </div>
        <div>
          {display && <button onClick={toggle}>{display.lightEnabled ? '☀ Lights on' : '☾ Lights off'}</button>}
          <button className="primary" onClick={() => setPicking(true)}>+ Display case</button>
        </div>
      </header>

      {message && <div className="spaces-action-message">{message}</div>}

      {space.displayCases.length > 1 && (
        <div className="live-unit-tabs display-case-tabs">
          {space.displayCases.map(c => (
            <button className={display?.id === c.id ? 'active' : ''} onClick={() => setCaseId(c.id)} key={c.id}>
              {c.name}<small>{c.slots.length} slots</small>
            </button>
          ))}
        </div>
      )}

      {display ? (
        <div className="gallery-stage">
          <div className="gallery-wall" />
          <div className="gallery-floor" />
          <section className="museum-cabinet">
            <div className="cabinet-crown"><span><small>CURATED COLLECTION</small><b>{display.name}</b></span><i className="cabinet-lock">◆</i></div>
            <div className="led top-led" />
            <div className="cabinet-interior">
              <i className="back-panel" /><i className="door left-door" /><i className="door right-door" /><i className="center-seam" />
              <div className="cabinet-shelves">
                {shelves.map((row, i) => (
                  <div className="cabinet-shelf-row" key={i}>
                    {row.map(slot => {
                      const allocation = allocationFor(slot.id)
                      const lot = allocation && lots.find(l => l.id === allocation.lotId)
                      const card = lot && cardFor(lot.cardId)
                      return (
                        <button
                          key={slot.id}
                          className={'display-slot-btn' + (card ? ' filled' : ' empty') + (activeSlot?.id === slot.id ? ' selected' : '')}
                          onClick={() => setActiveSlot(slot)}
                        >
                          {card ? (
                            <>
                              <i className="spotlight" />
                              <img
                                src={card.images.small} alt={card.name}
                                onMouseEnter={() => preview.show(card.images.large || card.images.small)}
                                onMouseLeave={() => preview.hide()}
                                onClick={e => { e.stopPropagation(); preview.show(card.images.large || card.images.small) }}
                              />
                              <em className="card-stand" />
                              <span><b>{card.name}</b><small>{lot?.condition} · {lot?.variantKey}</small></span>
                            </>
                          ) : (
                            <span className="slot-empty-hint">+ Add</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
              <i className="glass-reflection" />
            </div>
            <footer><span><i className="green" /> Settings saved</span><span>{display.slots.length} slots</span><span>LED display</span></footer>
            <div className="cabinet-base"><i /><i /><i /></div>
          </section>

          {activeSlot && (
            <aside className="display-slot-inspector">
              <header>
                <b>Shelf {String.fromCharCode(65 + activeSlot.shelfIndex)}, slot {activeSlot.slotIndex + 1}</b>
                <button onClick={() => setActiveSlot(null)}>✕</button>
              </header>
              {(() => {
                const allocation = allocationFor(activeSlot.id)
                if (allocation) {
                  const lot = lots.find(l => l.id === allocation.lotId)
                  const card = lot && cardFor(lot.cardId)
                  return (
                    <div className="box-copy-row">
                      {card && <ZoomableCardImage card={card} preview={preview} />}
                      <span><b>{card?.name || lot?.cardId}</b><small>{lot?.condition} · {lot?.variantKey} · {lot?.edition}</small></span>
                      <button onClick={() => void remove(allocation)}>Remove</button>
                    </div>
                  )
                }
                const available = lots.filter(lot => lot.quantity - lot.allocated > 0)
                if (!available.length) return <p>No available owned copies to display. Add cards from the Add Cards page first.</p>
                return available.slice(0, 30).map(lot => {
                  const card = cardFor(lot.cardId)
                  return (
                    <div className="box-copy-row" key={lot.id}>
                      {card && <ZoomableCardImage card={card} preview={preview} />}
                      <span><b>{card?.name || lot.cardId}</b><small>{lot.condition} · {lot.variantKey} · {lot.quantity - lot.allocated} available</small></span>
                      <button onClick={() => void add(lot)}>+ Place here</button>
                    </div>
                  )
                })
              })()}
            </aside>
          )}
        </div>
      ) : (
        <div className="spaces-live-status"><h2>Build your first real display case</h2><button onClick={() => setPicking(true)}>Add display case</button></div>
      )}
      {preview.overlay}
    </section>
  )
}

function DisplayCasePicker({ cancel, choose }: { cancel: () => void; choose: (preset: CasePreset) => void }) {
  return (
    <section className="box-picker-live">
      <header className="gallery-heading">
        <div><button className="inline-back" onClick={cancel}>← Displays</button><small>DISPLAY CASE LIBRARY</small><h2>Choose your display case</h2><p>Lighting and slot layout come from the preset you pick.</p></div>
      </header>
      <div className="box-preset-grid">
        {CASE_PRESETS.map(preset => (
          <button key={preset.preset} onClick={() => choose(preset)} style={{ '--preset-color': preset.frameColor } as React.CSSProperties}>
            <i className="preset-box case-preset-icon"><span style={{ background: preset.lightColor }} /></i>
            <span><b>{preset.name}</b><small>{preset.label}</small><strong>{preset.shelfCount} shelves · {preset.slotsPerShelf}/shelf</strong></span>
          </button>
        ))}
      </div>
    </section>
  )
}
