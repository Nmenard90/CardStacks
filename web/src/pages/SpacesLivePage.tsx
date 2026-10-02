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
 *   never blacks out. Area-specific pickers and modals remain local, while
 *   the selected shelf/display targets live at page level so header-search
 *   actions can update them directly. Areas call back up to `reload` after
 *   a mutation.
 *
 *   The header search is a client-side filter over the Spaces/boxes/
 *   binders/display-cases already loaded — it does not search inside card
 *   contents, since that would need a dedicated backend search endpoint.
 *   Picking a result switches to the right Space/area and directly controls
 *   the selected shelf/display target so the object opens in that same user
 *   action instead of being copied into local state by a follow-up effect.
 *
 * DEPENDS ON: api/rooms, api/storage, api/binders, api/collection,
 *   components/CardPreview (site-wide card zoom overlay), components/Toast
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { useUser } from '../context/UserContext'
import { useToast } from '../components/Toast'
import { usePreview } from '../components/CardPreview'
import { CardThumb } from '../components/CardThumb'
import { OwnedCardTile } from '../components/OwnedCardTile'
import { CardTile } from '../components/CardTile'
import { BulkAddControls } from '../components/BulkAddControls'
import { baseCond, type CondMap } from '../lib/conditions'
import { usePagedList } from '../lib/usePagedList'
import { createBinder, getBinder, listBinders, updateBinder } from '../api/binders'
import { getSets } from '../api/cards'
import { getOwnedCards, saveEntry } from '../api/collection'
import {
  createDisplayCase, createSpace, createStorageUnit, getCaseAllocations,
  getDrawerPlacements, getSpaceInventory, listSpaces, placeBinder, placeBox,
  placeCopies, placeInBinderSlot, removePlacement, setDisplayLights,
} from '../api/rooms'
import { createBox, createDrawer, deleteBox, listBoxes, updateBox } from '../api/storage'
import type {
  Binder, Card, CardAllocation, CollectionSpace, DisplayCase, DisplayCaseType,
  DisplaySlot, InventoryLot, OwnedCard, PocketSize, SpaceType, StorageBox,
  StorageDrawer, StorageUnit, StorageUnitType,
} from '../types'
import '../styles/spaces-concept.css'

/** Every card thumbnail on this page zooms and shimmers the same way
 *  CardTile does everywhere else in the app (CollectionPage, BulkAddPage,
 *  BinderViewPage): the same .thumb-wrap/.thumb classes and holo-foil
 *  treatment, and hover/click/keyboard-focus opens the site-wide
 *  CardPreview overlay (non-negotiable rule #10 — every card image needs
 *  a zoom/detail interaction). */
function ZoomableCardImage({ card, preview }: { card: Card; preview: ReturnType<typeof usePreview> }) {
  return <CardThumb card={card} preview={preview} />
}

type View = 'home' | 'storage' | 'binders' | 'displays'

/** box_type carries the raw `auto_set:<setId>` sentinel the backend uses to
 *  find/create a card's set box — never fit for showing to a person or for
 *  use as a CSS class token (":" isn't a valid class-name character). */
const humanizeBoxType = (boxType: string | undefined) => !boxType ? 'custom' : boxType.startsWith('auto_set:') ? 'auto-filed by set' : boxType
const boxTypeClass = (boxType: string | undefined) => (boxType || 'custom').replace(':', '-')

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

/** Read-only request groups shared by dependency-driven effects and manual
 *  refresh actions. Keeping retrieval separate lets effects apply results
 *  only from asynchronous completion callbacks. */
const fetchSpaceOverview = (userId: string) => Promise.all([
  listSpaces(userId), listBoxes(userId), listBinders(userId),
])
const fetchBoxContents = (userId: string, drawerId: string) => Promise.all([
  getSpaceInventory(userId), getDrawerPlacements(userId, drawerId), getOwnedCards(userId),
])
const fetchDisplayContents = (userId: string, displayId: string) => Promise.all([
  getSpaceInventory(userId), getOwnedCards(userId), getCaseAllocations(userId, displayId),
])

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

  // Storage and display selection live here so a header-search click can
  // update the destination directly, in the same user action that opens it.
  const [storageUnitId, setStorageUnitId] = useState('')
  const [openingBoxId, setOpeningBoxId] = useState('')
  const [displayCaseId, setDisplayCaseId] = useState('')

  const [addSpaceOpen, setAddSpaceOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Neither entering a Space's area (Storage/Binders/Displays) nor opening
  // a box inside Storage ever changed the URL or touched browser history —
  // the phone's hardware/gesture back button (and the desktop back button)
  // had nothing of ours to undo, so it just left the app entirely instead
  // of closing the box or area a person was actually looking at.
  //
  // Only one entry gets pushed for "left home", not one per sub-view — the
  // three area tabs are lateral moves at the same depth, so switching
  // between them shouldn't add extra steps to undo. A box open inside
  // Storage pushes its own entry on top of that; Storage registers a
  // "close the currently-open box, if any" handler here so a single
  // popstate handler can give the innermost thing open first crack at
  // handling back, regardless of which area is currently mounted.
  const closeBoxHandler = useRef<(() => boolean) | null>(null)
  useEffect(() => {
    const onPopState = () => { if (!closeBoxHandler.current?.()) setView('home') }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const enterView = (v: View) => {
    if (view === 'home' && v !== 'home') window.history.pushState({}, '', location.href)
    if (v === 'storage' && view !== 'storage') { setStorageUnitId(''); setOpeningBoxId('') }
    if (v === 'displays' && view !== 'displays') setDisplayCaseId('')
    setView(v)
  }

  const loadedUserId = user?.id || ''
  const [previousLoadedUserId, setPreviousLoadedUserId] = useState(loadedUserId)
  if (previousLoadedUserId !== loadedUserId) {
    setPreviousLoadedUserId(loadedUserId)
    setLoading(true)
  }

  const load = async (fullScreen = false) => {
    if (!user?.id) return
    if (fullScreen) setLoading(true)
    try {
      const [s, b, bi] = await fetchSpaceOverview(user.id)
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
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    fetchSpaceOverview(user.id)
      .then(([nextSpaces, nextBoxes, nextBinders]) => {
        if (cancelled) return
        setSpaces(nextSpaces)
        setBoxes(nextBoxes)
        setBinders(nextBinders)
        setSpaceId(id => id || nextSpaces.find(x => x.isDefault)?.id || nextSpaces[0]?.id || '')
        setError('')
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load spaces') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user?.id])

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
    for (const b of boxes) if (b.name.toLowerCase().includes(q)) hits.push({ kind: 'box', id: b.id, label: b.name, sub: b.boxType ? `Box · ${humanizeBoxType(b.boxType)}` : 'Box', spaceId: b.spaceId })
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
    else if (hit.kind === 'box') {
      const box = boxes.find(candidate => candidate.id === hit.id)
      if (view === 'home') window.history.pushState({}, '', location.href)
      setSpaceId(hit.spaceId || defaultSpaceId)
      if (box?.storageUnitId) setStorageUnitId(box.storageUnitId)
      setOpeningBoxId(hit.id)
      setView('storage')
    }
    else if (hit.kind === 'binder') navigate(`/binder/${hit.id}`)
    else {
      if (view === 'home') window.history.pushState({}, '', location.href)
      setSpaceId(hit.spaceId)
      setDisplayCaseId(hit.id)
      setView('displays')
    }
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
              type="text"
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
              <button className={view === 'storage' ? 'active' : ''} onClick={() => enterView('storage')}>
                <i>▦</i><span><b>Storage</b><small>{roomBoxes.length} boxes</small></span>
              </button>
              <button className={view === 'binders' ? 'active' : ''} onClick={() => enterView('binders')}>
                <i>▥</i><span><b>Binder Library</b><small>{roomBinders.length} binders</small></span>
              </button>
              <button className={view === 'displays' ? 'active' : ''} onClick={() => enterView('displays')}>
                <i>◇</i><span><b>Display Gallery</b><small>{space.displayCases.length} cases</small></span>
              </button>
            </div>
          </nav>
        )}

        {!space ? (
          <div className="spaces-live-status"><h2>No spaces yet</h2><button onClick={() => setAddSpaceOpen(true)}>Create a space</button></div>
        ) : view === 'home' ? (
          <Home space={space} spaces={spaces} boxes={roomBoxes} binders={roomBinders} onView={enterView} onSelect={setSpaceId} onAdd={() => setAddSpaceOpen(true)} />
        ) : view === 'storage' ? (
          <Storage
            userId={user?.id || ''} space={space} boxes={roomBoxes} binders={roomBinders} reload={load}
            unitId={storageUnitId} setUnitId={setStorageUnitId}
            opening={openingBoxId} setOpening={setOpeningBoxId}
            registerBackHandler={fn => { closeBoxHandler.current = fn }}
          />
        ) : view === 'binders' ? (
          <Binders userId={user?.id || ''} space={space} binders={roomBinders} reload={load} open={id => navigate(`/spaces/${space.id}/binders/${id}`)} />
        ) : (
          <Displays
            userId={user?.id || ''} space={space} reload={load}
            caseId={displayCaseId} setCaseId={setDisplayCaseId}
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
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Back Room Archive" autoFocus />
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
  const displayCases = space.displayCases
  return (
    <section className="spaces-home">
      <header>
        <h1>Your card collection</h1>
        <p>Organize physical boxes, binders, variants, conditions, and display copies.</p>
      </header>

      <div className="main-space">
        <div className="space-art">
          {/* A real (if simplified) look at this space's actual boxes/binders/
              cases, not a fixed decorative graphic — each zone shows real
              counts/colors and jumps to that section, same as the text list
              beside it. */}
          <div className="space-architecture">
            <button
              type="button" className="art-storage" onClick={() => onView('storage')}
              title={`Storage — ${boxes.length} box${boxes.length === 1 ? '' : 'es'}`}
            >
              {Array.from({ length: 6 }, (_, i) => {
                const box = boxes[i]
                return <i key={i} className={box ? '' : 'art-empty'} style={box ? { background: box.color || '#ded5c3' } : undefined} />
              })}
            </button>
            <button
              type="button" className="art-binders" onClick={() => onView('binders')}
              title={`Binder Library — ${binders.length} binder${binders.length === 1 ? '' : 's'}`}
            >
              {Array.from({ length: 5 }, (_, i) => {
                const binder = binders[i]
                return <i key={i} className={binder ? '' : 'art-empty'} style={binder ? { background: colorForBinder(binder.id) } : undefined} />
              })}
            </button>
            <button
              type="button" className="art-case" onClick={() => onView('displays')}
              title={`Display Gallery — ${displayCases.length} case${displayCases.length === 1 ? '' : 's'}`}
            >
              {Array.from({ length: 4 }, (_, i) => {
                const dcase = displayCases[i]
                return <span key={i} className={dcase ? (dcase.lightEnabled ? '' : 'unlit') : 'art-empty'} />
              })}
            </button>
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

function Storage({ userId, space, boxes, binders, reload, unitId, setUnitId, opening, setOpening, registerBackHandler }: {
  userId: string; space: CollectionSpace; boxes: StorageBox[]; binders: Binder[]; reload: () => Promise<void>
  unitId: string; setUnitId: (id: string) => void
  opening: string; setOpening: (id: string) => void
  registerBackHandler: (fn: (() => boolean) | null) => void
}) {
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<{ box: StorageBox; drawer: StorageDrawer } | null>(null)

  // Lets the browser/hardware back button close an open box instead of
  // leaving the whole page — see the matching popstate handler in
  // SpacesLivePage, which calls whatever's registered here before falling
  // back to its own "leave this area" handling.
  useEffect(() => {
    registerBackHandler(() => {
      if (!selected) return false
      setSelected(null)
      return true
    })
    return () => registerBackHandler(null)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const [picking, setPicking] = useState(false)
  const [pickingUnit, setPickingUnit] = useState(false)
  // The box currently armed to be placed — set by an HTML5 drag, the
  // "Move" button, or (on touch) a long-press on the box itself — so every
  // path shares one drop().
  const [armed, setArmed] = useState('')

  // Long-press-to-drag: one gesture, same on mouse and touch — press, hold
  // briefly, drag while still holding, release over the target. Pointer
  // Events unify both input types instead of running native HTML5 drag
  // (mouse-only in practice, and never fires from touch input at all) next
  // to a separate touch-only tap gesture.
  //
  // setPointerCapture on pointerdown is what makes tracking the drag
  // possible: it keeps every subsequent pointermove/pointerup routed to
  // THIS element (and suppresses pointerleave while the pointer wanders
  // over other elements mid-drag), so the same handlers can track the
  // whole gesture instead of it unravelling the moment the pointer leaves
  // the box's own bounds.
  //
  // Before the hold threshold fires, movement cancels it (so an ordinary
  // scroll/tap doesn't arm a drag); after it fires, movement no longer
  // cancels anything — it's just tracked so pointerup can hit-test whatever
  // shelf position is under the finger via elementFromPoint.
  const LONG_PRESS_MS = 450
  const MOVE_CANCEL_PX = 10
  const pressTimer = useRef<number | null>(null)
  const pressFired = useRef(false)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const pressPos = useRef<{ x: number; y: number } | null>(null)

  const cancelPress = () => {
    if (pressTimer.current !== null) { window.clearTimeout(pressTimer.current); pressTimer.current = null }
    pressStart.current = null
  }
  const startPress = (boxId: string) => (e: React.PointerEvent) => {
    // Capture support is spotty on older mobile browsers — if it throws,
    // the hold-to-arm timer below must still run. Losing capture only
    // costs the "drag across other elements mid-gesture" tracking; without
    // this try/catch a throw here would silently kill the timer entirely,
    // and every press would just fall through to the plain click (open).
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* see above */ }
    pressStart.current = { x: e.clientX, y: e.clientY }
    pressPos.current = { x: e.clientX, y: e.clientY }
    pressFired.current = false
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true
      setArmed(boxId)
      navigator.vibrate?.(15)
    }, LONG_PRESS_MS)
  }
  const trackPress = (e: React.PointerEvent) => {
    pressPos.current = { x: e.clientX, y: e.clientY }
    if (pressFired.current || !pressStart.current) return
    const dx = e.clientX - pressStart.current.x, dy = e.clientY - pressStart.current.y
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelPress()
  }
  /** Completes the drag on release: whatever shelf position is physically
   *  under the finger right now (not wherever the box started) is the
   *  drop target. Releasing off any position just leaves the box armed —
   *  the existing "tap a position" banner/fallback still applies. */
  const endPress = () => {
    if (pressFired.current && pressPos.current) {
      const target = document.elementFromPoint(pressPos.current.x, pressPos.current.y)
      const posEl = target?.closest<HTMLElement>('[data-shelf]')
      if (posEl) void drop(Number(posEl.dataset.shelf), Number(posEl.dataset.stack))
    }
    cancelPress()
  }

  const unit = space.storageUnits.find(x => x.id === unitId) || space.storageUnits[0]
  const unplacedBoxes = boxes.filter(x => !x.storageUnitId)

  /** The lowest level not already occupied in a stack — NOT `pile.length`,
   *  which silently assumes levels are always contiguous from 0. A box
   *  can end up sitting above a gap (e.g. the box below it was removed,
   *  or a previous placement attempt landed above an empty level), and
   *  `pile.length` would then recompute the very level that's already
   *  taken, 400ing on the backend's collision check. */
  const nextFreeLevel = (pile: StorageBox[]) => {
    const used = new Set(pile.map(b => b.stackLevel || 0))
    let level = 0
    while (used.has(level)) level++
    return level
  }

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
      // Uses a fresh box list, not the `boxes` prop — that only catches up
      // after this component's own reload(), so a slot computed from it
      // can already be stale (e.g. a box placed moments ago elsewhere, or
      // just created in a prior click) and collide with the backend's
      // actual layout, 400ing on placement below.
      const freshBoxes = await listBoxes(userId)
      let shelfIndex = -1, stackIndex = -1, stackLevel = 0
      for (let shelf = 0; shelf < target.shelfCount && shelfIndex < 0; shelf++) {
        for (let stack = 0; stack < target.positionsPerShelf; stack++) {
          const pile = freshBoxes.filter(x => x.storageUnitId === target!.id && x.shelfIndex === shelf && x.stackIndex === stack)
          if (pile.length < target.maxStackHeight) { shelfIndex = shelf; stackIndex = stack; stackLevel = nextFreeLevel(pile); break }
        }
      }
      if (shelfIndex < 0) throw new Error('This shelf unit is full. Add another shelf unit first.')
      const made = await createBox(userId, choice.name, choice.boxType, choice.capacity, choice.color)
      await createDrawer(made.id, 'Main compartment')
      await placeBox(userId, made.id, { spaceId: space.id, unitId: target.id, shelfIndex, stackIndex, stackLevel })
      await reload()
      setMessage(`${choice.name} was added to Shelf ${String.fromCharCode(65 + shelfIndex)}, stack ${stackIndex + 1}.`)
    } catch (e) {
      // The box (and its drawer) may already exist server-side even though
      // placement failed — reload so it shows up under "unplaced boxes"
      // instead of vanishing from view entirely.
      await reload()
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
        window.setTimeout(() => {
          window.history.pushState({}, '', location.href)
          setSelected({ box, drawer })
          setOpening('')
        }, 520)
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
      await placeBox(userId, boxId, { spaceId: space.id, unitId: unit.id, shelfIndex: shelf, stackIndex: stack, stackLevel: nextFreeLevel(current) })
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
        binders={binders} displayCases={space.displayCases}
        close={() => window.history.back()} onRenamed={reload}
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
                      data-shelf={shelf}
                      data-stack={stack}
                      onClick={() => { if (armed) void drop(shelf, stack) }}
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
                            onPointerDown={startPress(box.id)}
                            onPointerMove={trackPress}
                            onPointerUp={endPress}
                            onPointerCancel={cancelPress}
                            onClick={() => {
                              // A long-press that just armed this box for
                              // moving isn't also a tap to open it.
                              if (pressFired.current) { pressFired.current = false; return }
                              setOpening(box.id); window.setTimeout(() => setOpening(''), 650)
                            }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpening(box.id); window.setTimeout(() => setOpening(''), 650) } }}
                            className={`physical-box box-model-${boxTypeClass(box.boxType || 'custom')} ${fillState} ${opening === box.id ? 'is-open opening-to-inventory' : ''}`}
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
                            <span className="box-open-hint">
                              {opening === box.id ? 'OPENING…' : `LEVEL ${(box.stackLevel || 0) + 1} · HOLD TO MOVE`}
                            </span>
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

      {unplacedBoxes.length > 0 && (
      <aside className="unplaced-boxes">
        <b>📦 {unplacedBoxes.length} box{unplacedBoxes.length === 1 ? '' : 'es'} waiting to be shelved — including anything just auto-filed by adding a card</b>
        <div className="unplaced-boxes-list">
        {unplacedBoxes.map(box => (
          <div
            className="unplaced-box-row"
            onPointerDown={startPress(box.id)}
            onPointerMove={trackPress}
            onPointerUp={endPress}
            onPointerCancel={cancelPress}
            key={box.id}
          >
            <i style={{ background: box.color }} />
            <span>{box.name}<small>{humanizeBoxType(box.boxType)} · hold and drag onto a shelf, or tap Move below</small></span>
            <button type="button" className="box-move-btn inline" onClick={() => setArmed(box.id)}>⇅ Move</button>
          </div>
        ))}
        </div>
      </aside>
      )}
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
          <label>Name<input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
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

function BoxInventory({ userId, box, drawer, otherBoxes, binders, displayCases, close, onRenamed }: {
  userId: string; box: StorageBox; drawer: StorageDrawer; otherBoxes: StorageBox[]
  binders: Binder[]; displayCases: DisplayCase[]
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
  const isAutoSetBox = (box.boxType || '').startsWith('auto_set:')
  // An auto-filed box holds exactly one set, so "sort by set" (which is for
  // boxes mixing several) wouldn't show anything useful — collector number
  // is how a single-set box actually gets organized by hand.
  const [sort, setSort] = useState<'name' | 'condition' | 'number' | 'set'>(isAutoSetBox ? 'number' : 'name')
  const [setNameById, setSetNameById] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState(false)
  const [movingAllocation, setMovingAllocation] = useState<CardAllocation | null>(null)
  // null = no bulk-move modal open. 'all' moves every card in the box;
  // 'selected' moves only the checked ones — same modal, different source list.
  const [bulkMoveScope, setBulkMoveScope] = useState<'all' | 'selected' | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedDrawerId, setSelectedDrawerId] = useState(drawer.id)
  if (selectedDrawerId !== drawer.id) {
    setSelectedDrawerId(drawer.id)
    setSelectedIds(new Set())
  }
  // Tracks the last name known to be saved (starts as the prop, then
  // whatever the box was last renamed to) — `box` itself is never mutated,
  // so this is what the "cancel edit" / failed-save paths revert to.
  const [savedName, setSavedName] = useState(box.name)
  const [name, setName] = useState(box.name)
  const preview = usePreview()

  // Adding cards — the same Bulk Add form as the Add Cards page, but each
  // add goes straight into this box (and the collection). Adds are queued
  // per card+condition and flushed together a moment after the last one,
  // so rapid entry is one save + one placement per card, not one per copy.
  const [pendingAdds, setPendingAdds] = useState<Record<string, number>>({})
  const pendingRef = useRef<Record<string, number>>({})
  // Keeps the full Card alongside pendingRef's quantity, so the unmount
  // flush below (which has no per-call closure over `card` the way the
  // normal flush timer does) can still run the same auto-box rescue.
  const pendingCards = useRef<Record<string, Card>>({})
  // What tiles add on top of the loaded data: +n for adds queued or still
  // saving, −n for removals still saving. Unlike pendingRef (the queue),
  // an entry only clears once the reloaded data already includes it.
  const optimisticRef = useRef<Record<string, number>>({})
  // Render-side copy of the queued cards (refs can't be read while rendering).
  const [pendingCardMap, setPendingCardMap] = useState<Record<string, Card>>({})
  const syncPending = () => { setPendingAdds({ ...optimisticRef.current }); setPendingCardMap({ ...pendingCards.current }) }
  /** Shifts a tile's optimistic count; at zero it's fully reflected in the
   *  loaded data and is dropped. */
  const shiftOptimistic = (key: string, delta: number) => {
    const next = (optimisticRef.current[key] ?? 0) + delta
    if (next) optimisticRef.current[key] = next
    else {
      delete optimisticRef.current[key]
      if (!pendingRef.current[key]) delete pendingCards.current[key]
    }
    syncPending()
  }
  const flushTimers = useRef<Record<string, number>>({})
  // Serializes saves per card: saveEntry is a full REPLACE of the card's
  // condition list, so two overlapping saves for the same card (an add
  // and a remove, or two batches) would otherwise silently overwrite
  // each other. Every write for a card waits for the previous one.
  const flushChain = useRef<Record<string, Promise<void>>>({})
  const chainFor = (cardId: string, work: () => Promise<void>) => {
    flushChain.current[cardId] = (flushChain.current[cardId] ?? Promise.resolve()).then(work)
  }
  // Which condition each tile's −/+ edits, and typed-but-not-yet-applied
  // quantities (applied a moment after typing stops, not per keystroke).
  const [selConds, setSelConds] = useState<Record<string, string>>({})
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, number>>({})
  const draftTimers = useRef<Record<string, number>>({})

  /** @param onLoaded Runs in the same render as the fresh data lands — used
   *  to retire a tile's optimistic count at exactly the moment the saved
   *  count replaces it, so the number never flickers back in between. */
  const load = async (onLoaded?: () => void) => {
    try {
      const [nextLots, nextPlacements, nextOwned] = await fetchBoxContents(userId, drawer.id)
      setLots(nextLots); setPlacements(nextPlacements); setOwned(nextOwned); setMessage('')
      onLoaded?.()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load box inventory.')
      onLoaded?.()
    }
  }
  useEffect(() => {
    let cancelled = false
    fetchBoxContents(userId, drawer.id)
      .then(([nextLots, nextPlacements, nextOwned]) => {
        if (cancelled) return
        setLots(nextLots); setPlacements(nextPlacements); setOwned(nextOwned); setMessage('')
      })
      .catch(e => { if (!cancelled) setMessage(e instanceof Error ? e.message : 'Could not load box inventory.') })
    return () => { cancelled = true }
  }, [userId, drawer.id])

  // Only for the "Set" sort's divider labels/order — id alone ("sv3pt5")
  // doesn't read as a set to a person filing cards by hand.
  useEffect(() => { getSets().then(list => {
    const m: Record<string, string> = {}
    for (const s of list) m[s.id] = s.name
    setSetNameById(m)
  }).catch(() => {}) }, [])

  /** Saving a card auto-files any newly-owned surplus straight into that
   *  card's own "set" box on the backend (CollectionRepository.
   *  reconcileAutoAllocation) — that's what makes the bulk Add Cards flow
   *  discoverable, but it means a card added via THIS box's own search can
   *  get silently claimed by that other (auto-filed) box before the
   *  placeCopies call below ever runs, leaving nothing "free" to place and
   *  the card nowhere the user was actually looking. This finds it in the
   *  auto box and moves it here instead of leaving it stranded there.
   *
   *  Fetches a fresh box list rather than using the `otherBoxes` prop —
   *  for a set with no existing box, the backend creates the auto box on
   *  the fly as part of THIS save, so it wouldn't be in whatever list was
   *  fetched when this component mounted. */
  const rescueFromAutoBox = async (setId: string, lotId: string) => {
    const freshBoxes = await listBoxes(userId)
    const autoBox = freshBoxes.find(b => b.boxType === `auto_set:${setId}`)
    if (!autoBox) return false
    for (const d of autoBox.drawers) {
      const placements = await getDrawerPlacements(userId, d.id)
      const allocation = placements.find(a => a.lotId === lotId)
      if (allocation) {
        await removePlacement(userId, allocation.id)
        await placeCopies(userId, { lotId, drawerId: drawer.id, quantity: allocation.quantity, protection: allocation.protection ?? 'raw' })
        return true
      }
    }
    return false
  }

  /** Does this lot hold copies of `cardId` under condition key `condKey`
   *  ("NM", or "NM 1st Ed" for the 1st Edition lot)? */
  const lotMatches = (l: InventoryLot, cardId: string, condKey: string) =>
    l.cardId === cardId && l.variantKey === 'standard' && l.condition === baseCond(condKey)
    && l.edition === (condKey.endsWith(' 1st Ed') ? 'first_edition' : 'unlimited')

  /** Adds `qty` owned copies of a card and places them in this box. Always
   *  reads fresh owned/lot state right before writing (never this
   *  component's possibly-stale state). Returns whether they got placed. */
  const saveAndPlace = async (card: Card, condKey: string, qty: number) => {
    const freshOwned = await getOwnedCards(userId)
    const existing = freshOwned.find(o => o.cardId === card.id)
    const conds = existing ? existing.conditions.map(c => ({ ...c })) : []
    const entry = conds.find(c => c.condition === condKey)
    if (entry) entry.quantity += qty
    else conds.push({ condition: condKey, quantity: qty })
    await saveEntry(userId, card.id, conds, existing?.selectedCond ?? baseCond(condKey))

    const freshLots = await getSpaceInventory(userId)
    const lot = freshLots.find(l => lotMatches(l, card.id, condKey))
    const free = lot ? lot.quantity - lot.allocated : 0
    if (lot && free > 0) {
      await placeCopies(userId, { lotId: lot.id, drawerId: drawer.id, quantity: Math.min(qty, free), protection: 'raw' })
      return true
    }
    return !!lot && await rescueFromAutoBox(card.setId, lot.id)
  }

  // Flushes any still-queued adds if the box is closed mid-batch (only
  // cancelling the debounce timers, with no matching flush, would silently
  // drop adds the tiles already showed). No setState here — it's already
  // unmounting — just the raw save+place work.
  useEffect(() => () => {
    Object.values(flushTimers.current).forEach(t => window.clearTimeout(t))
    for (const [key, qty] of Object.entries(pendingRef.current)) {
      const card = pendingCards.current[key]
      if (!qty || !card) continue
      const condKey = key.slice(card.id.length + 1)
      chainFor(card.id, async () => {
        try { await saveAndPlace(card, condKey, qty) } catch { /* best-effort on unmount */ }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cardFor = (cardId: string) => owned.find(x => x.cardId === cardId)?.card

  /** One queued batch: save + place, with progress shown in the box. */
  const commitNewCard = async (card: Card, condKey: string, qty: number) => {
    setMessage(`Adding ${qty} × ${card.name} (${condKey})…`)
    const settle = () => shiftOptimistic(`${card.id}|${condKey}`, -qty)
    try {
      const placed = await saveAndPlace(card, condKey, qty)
      await load(settle)
      setMessage(placed
        ? `Added ${qty} × ${card.name} (${condKey}).`
        : `${card.name} is now in your collection, but couldn't be auto-placed — add it from "Available owned copies" below.`)
    } catch (e) {
      await load(settle)
      setMessage(e instanceof Error ? e.message : 'Could not add that card.')
    }
  }

  /** Queues `qty` more copies (shown on the tile instantly) and saves them
   *  together a moment after the last add for that card+condition. */
  const queueAdd = (card: Card, condKey: string, qty: number) => {
    const key = `${card.id}|${condKey}`
    pendingRef.current[key] = (pendingRef.current[key] ?? 0) + qty
    pendingCards.current[key] = card
    shiftOptimistic(key, qty)
    if (flushTimers.current[key]) window.clearTimeout(flushTimers.current[key])
    flushTimers.current[key] = window.setTimeout(() => {
      const n = pendingRef.current[key]
      if (!n) return
      // Leaves the queue but stays on the tile (optimistic) until the
      // reload that includes it — that gap is what used to flicker.
      delete pendingRef.current[key]
      chainFor(card.id, () => commitNewCard(card, condKey, n))
    }, 700)
  }

  /** Removes `k` copies from this box AND the collection (sold, traded,
   *  lost). Copies come out of the box first, so the owned count can then
   *  drop without ever going below what's placed. */
  const removeCopies = async (card: Card, condKey: string, k: number) => {
    setMessage(`Removing ${k} × ${card.name} (${condKey})…`)
    const settle = () => shiftOptimistic(`${card.id}|${condKey}`, k)
    try {
      const [freshLots, freshPlacements] = await Promise.all([getSpaceInventory(userId), getDrawerPlacements(userId, drawer.id)])
      const lotIds = new Set(freshLots.filter(l => lotMatches(l, card.id, condKey)).map(l => l.id))
      const mine = freshPlacements.filter(a => lotIds.has(a.lotId))
      const removed = Math.min(k, mine.reduce((n, a) => n + a.quantity, 0))
      if (!removed) { await load(settle); setMessage(''); return }

      let left = removed
      for (const a of mine) {
        if (!left) break
        await removePlacement(userId, a.id)
        if (a.quantity > left) {
          await placeCopies(userId, { lotId: a.lotId, drawerId: drawer.id, quantity: a.quantity - left, protection: a.protection })
          left = 0
        } else left -= a.quantity
      }

      const freshOwned = await getOwnedCards(userId)
      const existing = freshOwned.find(o => o.cardId === card.id)
      const conds = (existing?.conditions ?? []).map(c => ({ ...c }))
      const entry = conds.find(c => c.condition === condKey)
      if (entry) entry.quantity = Math.max(0, entry.quantity - removed)
      await saveEntry(userId, card.id, conds.filter(c => c.quantity > 0), existing?.selectedCond ?? baseCond(condKey))
      await load(settle)
      setMessage(`Removed ${removed} × ${card.name} (${condKey}) from this box and your collection.`)
    } catch (e) {
      await load(settle)
      setMessage(e instanceof Error ? e.message : 'Could not remove that card.')
    }
  }

  /** A tile's −/+ (or right-click on a condition badge). Removing first
   *  cancels any still-queued adds before touching saved copies. */
  const changeQty = (card: Card, condKey: string, delta: number) => {
    if (delta > 0) { queueAdd(card, condKey, delta); return }
    const key = `${card.id}|${condKey}`
    const queued = pendingRef.current[key] ?? 0
    const cancel = Math.min(queued, -delta)
    if (cancel) {
      if (queued - cancel) pendingRef.current[key] = queued - cancel
      else { delete pendingRef.current[key]; window.clearTimeout(flushTimers.current[key]) }
      shiftOptimistic(key, -cancel)
    }
    const rest = -delta - cancel
    if (rest > 0) {
      shiftOptimistic(key, -rest)
      chainFor(card.id, () => removeCopies(card, condKey, rest))
    }
  }

  /** Typing a quantity into a tile — applied once typing pauses, so
   *  typing "12" doesn't first apply "1". */
  const typeQty = (card: Card, condKey: string, current: number, target: number) => {
    const key = `${card.id}|${condKey}`
    setQtyDrafts(d => ({ ...d, [key]: target }))
    window.clearTimeout(draftTimers.current[key])
    draftTimers.current[key] = window.setTimeout(() => {
      setQtyDrafts(d => { const next = { ...d }; delete next[key]; return next })
      if (target !== current) changeQty(card, condKey, target - current)
    }, 900)
  }

  /** "Remove from box" — un-places every copy of the card here; it stays
   *  in the collection (same as the old per-stack Remove). */
  const unplaceAll = async (allocations: CardAllocation[]) => {
    setMessage('Taking out of this box…')
    try {
      for (const a of allocations) await removePlacement(userId, a.id)
      await load()
      setMessage('Taken out of this box — still in your collection.')
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? e.message : 'Could not take this card out.')
    }
  }

  const add = async (lot: InventoryLot) => {
    setMessage('Placing one copy…')
    try { await placeCopies(userId, { lotId: lot.id, drawerId: drawer.id, quantity: 1, protection: 'raw' }); await load() }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not place this copy.') }
  }
  // Every move below shares the same shape: remove first, then place, so the
  // in-flight total never briefly double-counts this copy as over-allocated.
  // If the placement step fails, the copy is left unplaced (with a clear
  // message) rather than silently duplicated or lost.
  const moveToBox = async (allocation: CardAllocation, target: StorageBox) => {
    setMovingAllocation(null)
    setMessage(`Moving to ${target.name}…`)
    try {
      await removePlacement(userId, allocation.id)
      const targetDrawer = target.drawers[0] || await createDrawer(target.id, 'Main compartment')
      await placeCopies(userId, { lotId: allocation.lotId, drawerId: targetDrawer.id, quantity: allocation.quantity, protection: allocation.protection })
      await load()
      setMessage(`Moved to ${target.name}.`)
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? `Removed from this box, but could not place it in ${target.name}: ${e.message}` : 'Could not move this copy.')
    }
  }
  // Wholesale transfers out of an auto-filed box (or any box) into wherever
  // the user actually wants it — "all" or a checked "selected" subset both
  // land here, just with a different source list. One card at a time
  // through the API is the only option available (no bulk endpoint), so
  // this runs moveToBox's own remove-then-place sequence per allocation,
  // reporting progress as it goes.
  const moveManyToBox = async (toMove: CardAllocation[], target: StorageBox) => {
    setBulkMoveScope(null)
    let moved = 0
    setMessage(`Moving 0 of ${toMove.length} to ${target.name}…`)
    try {
      const targetDrawer = target.drawers[0] || await createDrawer(target.id, 'Main compartment')
      for (const allocation of toMove) {
        await removePlacement(userId, allocation.id)
        await placeCopies(userId, { lotId: allocation.lotId, drawerId: targetDrawer.id, quantity: allocation.quantity, protection: allocation.protection })
        moved++
        setMessage(`Moving ${moved} of ${toMove.length} to ${target.name}…`)
      }
      setSelectedIds(new Set())
      await load()
      setMessage(`Moved ${moved} card${moved === 1 ? '' : 's'} to ${target.name}.`)
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? `Moved ${moved} of ${toMove.length} before hitting a problem: ${e.message}` : 'Could not finish moving these cards.')
    }
  }
  const moveToBinder = async (allocation: CardAllocation, binder: Binder) => {
    setMovingAllocation(null)
    if (allocation.quantity !== 1) { setMessage('Only single-copy stacks can move into a binder slot.'); return }
    setMessage(`Moving to ${binder.name}…`)
    try {
      const fresh = await getBinder(userId, binder.id)
      const occupied = new Set(fresh.slots.filter(s => s.cardId).map(s => s.slotIndex))
      let slotIndex = -1
      for (let i = 0; i < 2000; i++) { if (!occupied.has(i)) { slotIndex = i; break } }
      if (slotIndex < 0) throw new Error(`${binder.name} is full.`)
      await removePlacement(userId, allocation.id)
      await placeInBinderSlot(userId, binder.id, slotIndex, { lotId: allocation.lotId, quantity: 1, protection: allocation.protection })
      await load()
      setMessage(`Moved to ${binder.name}.`)
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? e.message : 'Could not move this copy.')
    }
  }
  const moveToDisplay = async (allocation: CardAllocation, displayCase: DisplayCase) => {
    setMovingAllocation(null)
    if (allocation.quantity !== 1) { setMessage('Only single-copy stacks can move into a display slot.'); return }
    setMessage(`Moving to ${displayCase.name}…`)
    try {
      const existing = await getCaseAllocations(userId, displayCase.id)
      const occupiedSlotIds = new Set(existing.map(a => a.displaySlotId))
      const openSlot = displayCase.slots.find(s => !occupiedSlotIds.has(s.id))
      if (!openSlot) throw new Error(`${displayCase.name} is full.`)
      await removePlacement(userId, allocation.id)
      await placeCopies(userId, { lotId: allocation.lotId, displaySlotId: openSlot.id, quantity: 1, protection: allocation.protection })
      await load()
      setMessage(`Moved to ${displayCase.name}.`)
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? e.message : 'Could not move this copy.')
    }
  }
  const saveName = async () => {
    const trimmed = name.trim()
    setRenaming(false)
    if (!trimmed || trimmed === savedName) { setName(savedName); return }
    try { await updateBox(box.id, { name: trimmed }); setSavedName(trimmed); await onRenamed() }
    catch { setMessage('Could not rename this box.'); setName(savedName) }
  }

  /** The backend cascades to drawers and un-assigns cards (not deletes them —
   *  they stay in the collection, just no longer allocated to this box). */
  const deleteThisBox = async () => {
    const cardCount = placements.reduce((n, x) => n + x.quantity, 0)
    const warning = cardCount > 0
      ? `Delete "${savedName}"? Its ${cardCount} card${cardCount === 1 ? '' : 's'} will stay in your collection, just no longer assigned to a box.`
      : `Delete "${savedName}"?`
    if (!window.confirm(warning)) return
    try {
      await deleteBox(box.id)
      await onRenamed()
      close()
    } catch {
      setMessage('Could not delete this box.')
    }
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
    if (sort === 'set') {
      const aSet = cardFor(aLot?.cardId || '')?.setId || '', bSet = cardFor(bLot?.cardId || '')?.setId || ''
      return aSet !== bSet
        ? (setNameById[aSet] || aSet).localeCompare(setNameById[bSet] || bSet)
        : (cardFor(aLot?.cardId || '')?.number || '').localeCompare(cardFor(bLot?.cardId || '')?.number || '', undefined, { numeric: true })
    }
    return (cardFor(aLot?.cardId || '')?.name || '').localeCompare(cardFor(bLot?.cardId || '')?.name || '')
  }

  const conditions = [...new Set(lots.map(l => l.condition))].sort()
  const protections = [...new Set(placements.map(a => a.protection || 'raw'))].sort()
  const variants = [...new Set(lots.map(l => l.variantKey))].sort()
  // Set names aren't loaded here (only setId) — showing the id keeps this
  // filter honest without pulling in a full set catalog fetch just for it.
  const sets = [...new Set(lots.map(l => cardFor(l.cardId)?.setId).filter((s): s is string => !!s))].sort()

  const insideBox = placements.filter(matchesAllocation).sort((a, b) => byChosenSort(lots.find(l => l.id === a.lotId), lots.find(l => l.id === b.lotId)))
  // One tile per card (not per stack): every stack of a card in this box —
  // NM, LP, 1st Ed… — folds into one Bulk Add-style tile with a condition
  // breakdown, in the same order the filtered/sorted stacks came in.
  type CardGroup = { cardId: string; card?: Card; allocations: CardAllocation[]; conds: CondMap }
  const groupMap = new Map<string, CardGroup>()
  for (const a of insideBox) {
    const lot = lots.find(l => l.id === a.lotId)
    if (!lot) continue
    const key = lot.edition === 'first_edition' ? `${lot.condition} 1st Ed` : lot.condition
    let g = groupMap.get(lot.cardId)
    if (!g) { g = { cardId: lot.cardId, card: cardFor(lot.cardId), allocations: [], conds: {} }; groupMap.set(lot.cardId, g) }
    g.allocations.push(a)
    g.conds[key] = (g.conds[key] ?? 0) + a.quantity
  }
  // Cards just added from the form show up immediately, before their save lands.
  for (const [key, qty] of Object.entries(pendingAdds)) {
    const card = pendingCardMap[key]
    if (!qty || !card || groupMap.has(card.id)) continue
    groupMap.set(card.id, { cardId: card.id, card, allocations: [], conds: {} })
  }
  // A box holding more than one set is always grouped by set (with a
  // divider per set, below), whatever the sort — the chosen sort still
  // orders cards within each set (Array.sort is stable).
  const multiSetBox = new Set([...groupMap.values()].map(g => g.card?.setId)).size > 1
  const setLabel = (setId?: string) => (setId && setNameById[setId]) || setId || ''
  const insideGroups = [...groupMap.values()]
  if (multiSetBox) insideGroups.sort((a, b) => setLabel(a.card?.setId).localeCompare(setLabel(b.card?.setId)))
  /** What a tile shows: saved copies + still-queued adds, with any
   *  half-typed quantity shown as typed. */
  const tileConds = (g: CardGroup): CondMap => {
    const conds: CondMap = { ...g.conds }
    for (const [key, qty] of Object.entries(pendingAdds)) {
      if (!key.startsWith(g.cardId + '|')) continue
      const condKey = key.slice(g.cardId.length + 1)
      conds[condKey] = Math.max(0, (conds[condKey] ?? 0) + qty)
    }
    for (const [key, qty] of Object.entries(qtyDrafts)) {
      if (key.startsWith(g.cardId + '|')) conds[key.slice(g.cardId.length + 1)] = qty
    }
    return conds
  }
  const inBoxCount = (cardId: string) => {
    const g = groupMap.get(cardId)
    return g ? Object.values(tileConds(g)).reduce((n, q) => n + q, 0) : 0
  }
  const available = lots.filter(lot => lot.quantity - lot.allocated > 0 && matchesLot(lot)).sort(byChosenSort)
  // "Load more" pagination, not a hard cutoff — a bulk box or a collection
  // in the hundreds of thousands must stay browsable instead of silently
  // hiding everything past some fixed count. Resets to page one whenever
  // the search/filter/sort combo changes, not on every render.
  const insideBoxPage = usePagedList(insideGroups, `${q}|${conditionFilter}|${variantFilter}|${protectionFilter}|${setFilter}|${duplicatesOnly}|${sort}`)
  const availablePage = usePagedList(available, `${q}|${conditionFilter}|${variantFilter}|${setFilter}|${sort}`)

  return (
    <section className="inside-box-view">
      <header>
        <button onClick={close}>← Back to shelf</button>
        <div>
          <small>OPEN PHYSICAL BOX</small>
          {renaming ? (
            <input
              type="text"
              className="edit-box-name" autoFocus value={name}
              onChange={e => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(savedName); setRenaming(false) } }}
            />
          ) : (
            <h2 onClick={() => setRenaming(true)} title="Click to rename" style={{ cursor: 'pointer' }}>{savedName} <small style={{ fontSize: 11, opacity: 0.6 }}>✎ edit</small></h2>
          )}
          <p>{humanizeBoxType(box.boxType)} · {placements.reduce((n, x) => n + x.quantity, 0)} of {box.capacity || 'custom'} cards tracked</p>
        </div>
        {selectedIds.size > 0 && otherBoxes.length > 0 && (
          <button onClick={() => setBulkMoveScope('selected')}>📦 Move {selectedIds.size} selected to…</button>
        )}
        {placements.length > 0 && otherBoxes.length > 0 && (
          <button onClick={() => setBulkMoveScope('all')}>📦 Move all to…</button>
        )}
        <button onClick={() => void deleteThisBox()} style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)' }}>🗑 Delete box</button>
      </header>

      {message && <div className="spaces-action-message">{message}</div>}

      <div className="box-toolbar">
        <label className="inventory-search"><span>🔍</span><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search inside this box…" /></label>
        <div className="inventory-filters">
          <select value={sort} onChange={e => setSort(e.target.value as 'name' | 'condition' | 'number' | 'set')}>
            <option value="name">Sort: Name</option>
            <option value="number">Sort: Number</option>
            <option value="condition">Sort: Condition</option>
            <option value="set">Sort: Set</option>
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
            {sets.map(s => <option key={s} value={s}>{setNameById[s] || s}</option>)}
          </select>
          <label className="inventory-duplicates-toggle">
            <input type="checkbox" checked={duplicatesOnly} onChange={e => setDuplicatesOnly(e.target.checked)} />
            Duplicates only
          </label>
        </div>
      </div>

      <section className="box-open-surface">
        <h3>Add cards to this box</h3>
        <p className="box-empty-note">Same as Bulk Add — every add goes straight into this box and your collection, saved a moment after you stop.</p>
        {/* .page-tracker gives the shared form and card tiles their Bulk Add
            look; its full-page height/background are switched off here. */}
        <div className="page-tracker" style={{ minHeight: 0, background: 'transparent' }}>
          <BulkAddControls
            onAdd={(card, condKey, step) => queueAdd(card, condKey, step)}
            preview={preview}
            have={cardId => inBoxCount(cardId)} haveLabel="in this box"
          />
        </div>
      </section>

      <section className="box-open-surface" style={{ '--box-color': box.color || '#d8d0c0' } as React.CSSProperties}>
        <h3>Inside this box{insideGroups.length > 0 ? ` (${insideGroups.length} card${insideGroups.length === 1 ? '' : 's'})` : ''}</h3>
        {insideBoxPage.visible.length > 0 && (
          <p className="box-empty-note">
            <button
              className="tb-btn" style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => setSelectedIds(new Set(insideBoxPage.visible.flatMap(g => g.allocations.map(a => a.id))))}
            >Select all visible ({insideBoxPage.visible.length})</button>
            {' '}
            {selectedIds.size > 0 && (
              <button className="tb-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            )}
          </p>
        )}
        {!placements.length && !insideGroups.length && <p className="box-empty-note">This box is empty. Add cards above, or owned copies below.</p>}
        {placements.length > 0 && !insideGroups.length && <p className="box-empty-note">Nothing here matches that search/filter.</p>}
        {insideBoxPage.visible.length > 0 && (
          <div className="page-tracker" style={{ minHeight: 0, background: 'transparent' }}>
            <div className="card-grid">
              {insideBoxPage.visible.map((group, i) => {
                const card = group.card
                // A barrier between sets, not just a sorted list — also labels
                // the very first group (i===0) so every group is named.
                const prevSetId = i > 0 ? insideBoxPage.visible[i - 1].card?.setId : undefined
                const setId = card?.setId
                const divider = (sort === 'set' || multiSetBox) && (i === 0 || setId !== prevSetId)
                const ids = group.allocations.map(a => a.id)
                const allSelected = ids.length > 0 && ids.every(id => selectedIds.has(id))
                const conds = tileConds(group)
                const selCond = selConds[group.cardId] ?? (Object.keys(conds).find(k => conds[k] > 0) ?? 'NM')
                const current = (group.conds[selCond] ?? 0) + (pendingAdds[`${group.cardId}|${selCond}`] ?? 0)

                const tile = !card ? (
                  <div className="box-card-tile" key={group.cardId}>
                    <div className="thumb-placeholder">🃏</div>
                    <b>{group.cardId}</b>
                    <small>{Object.entries(group.conds).map(([k, n]) => `${k} ×${n}`).join(' · ')}</small>
                    <button className="box-card-add" onClick={() => void unplaceAll(group.allocations)}>Remove from box</button>
                  </div>
                ) : (
                    <CardTile
                      key={group.cardId} card={card} conds={conds} selCond={selCond}
                      setName={setNameById[card.setId]}
                      onAdj={d => changeQty(card, selCond, d)}
                      onSetQty={q => typeQty(card, selCond, current, q)}
                      onSelectCond={c => setSelConds(s => ({ ...s, [group.cardId]: c }))}
                      onAdjCond={(c, d) => changeQty(card, c, d)}
                      onPreview={(src, opts) => (src ? preview.show(src, opts) : preview.hide())}
                      selected={allSelected}
                      onToggleSelect={ids.length ? () => setSelectedIds(prev => {
                        const next = new Set(prev)
                        for (const id of ids) { if (allSelected) next.delete(id); else next.add(id) }
                        return next
                      }) : undefined}
                      actions={ids.length ? [
                        {
                          label: 'Move', title: 'Move this card to another box, binder or display case',
                          disabled: !otherBoxes.length && !binders.length && !displayCases.length,
                          // One stack can go anywhere; several stacks (e.g. NM + LP)
                          // use the box-to-box mover for all of them at once.
                          onClick: () => {
                            if (group.allocations.length === 1) setMovingAllocation(group.allocations[0])
                            else { setSelectedIds(new Set(ids)); setBulkMoveScope('selected') }
                          },
                        },
                        { label: 'Remove from box', title: 'Take it out of this box — you still own it', onClick: () => void unplaceAll(group.allocations) },
                      ] : undefined}
                    />
                )

                return divider ? [
                  <div className="box-set-divider" key={`divider-${group.cardId}`}>
                    <span>{(setId && setNameById[setId]) || setId || 'Unknown set'}</span>
                  </div>,
                  tile,
                ] : tile
              })}
            </div>
          </div>
        )}
        {insideBoxPage.hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 0' }}>
            <button className="tb-btn primary" onClick={insideBoxPage.loadMore}>Load more ({insideBoxPage.remaining} left)</button>
          </div>
        )}
      </section>

      <section className="box-open-surface">
        <h3>Available owned copies{available.length > 0 ? ` (${available.length})` : ''}</h3>
        {!available.length && <p className="box-empty-note">Nothing available to add — everything owned is already placed somewhere, or nothing matches the current search/filter.</p>}
        {availablePage.visible.length > 0 && (
          <div className="box-card-grid">
            {availablePage.visible.map(lot => {
              const card = cardFor(lot.cardId)
              const subtitle = `${lot.condition} · ${lot.variantKey} · ${lot.quantity - lot.allocated} available`
              return card ? (
                <OwnedCardTile
                  key={lot.id} card={card} preview={preview} subtitle={subtitle}
                  actions={[{ label: '+ Add one', onClick: () => void add(lot) }]}
                />
              ) : (
                <div className="box-card-tile" key={lot.id}>
                  <div className="thumb-placeholder">🃏</div>
                  <b>{lot.cardId}</b>
                  <small>{subtitle}</small>
                  <button className="box-card-add" onClick={() => void add(lot)}>+ Add one</button>
                </div>
              )
            })}
          </div>
        )}
        {availablePage.hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 0' }}>
            <button className="tb-btn primary" onClick={availablePage.loadMore}>Load more ({availablePage.remaining} left)</button>
          </div>
        )}
      </section>

      {movingAllocation && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setMovingAllocation(null) }}>
          <div className="modal">
            <h3>Move this copy</h3>
            {movingAllocation.quantity !== 1 && (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>This is a stack of {movingAllocation.quantity} — only another box can take the whole stack. Binder and display slots hold exactly one copy.</p>
            )}

            {otherBoxes.length > 0 && (
              <>
                <p className="move-target-heading">Boxes</p>
                <div className="move-target-list">
                  {otherBoxes.map(b => (
                    <button key={b.id} className="tb-btn" onClick={() => void moveToBox(movingAllocation, b)}>{b.name}</button>
                  ))}
                </div>
              </>
            )}

            {movingAllocation.quantity === 1 && binders.length > 0 && (
              <>
                <p className="move-target-heading">Binders</p>
                <div className="move-target-list">
                  {binders.map(b => (
                    <button key={b.id} className="tb-btn" onClick={() => void moveToBinder(movingAllocation, b)}>{b.name}</button>
                  ))}
                </div>
              </>
            )}

            {movingAllocation.quantity === 1 && displayCases.length > 0 && (
              <>
                <p className="move-target-heading">Display cases</p>
                <div className="move-target-list">
                  {displayCases.map(c => (
                    <button key={c.id} className="tb-btn" onClick={() => void moveToDisplay(movingAllocation, c)}>{c.name}</button>
                  ))}
                </div>
              </>
            )}

            {!otherBoxes.length && !binders.length && !displayCases.length && <p>Nothing else in this space to move it to yet.</p>}

            <div className="modal-btns"><button className="tb-btn" onClick={() => setMovingAllocation(null)}>Cancel</button></div>
          </div>
        </div>
      )}

      {bulkMoveScope && (() => {
        const toMove = bulkMoveScope === 'all' ? placements : placements.filter(p => selectedIds.has(p.id))
        return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setBulkMoveScope(null) }}>
          <div className="modal">
            <h3>Move {bulkMoveScope === 'all' ? 'all' : 'the selected'} {toMove.length} card{toMove.length === 1 ? '' : 's'}</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              {bulkMoveScope === 'all'
                ? "Every card in this box moves to whichever box you pick below — search/filter above doesn't limit this."
                : 'The cards you checked below move to whichever box you pick.'}
            </p>
            <p className="move-target-heading">Boxes</p>
            <div className="move-target-list">
              {otherBoxes.map(b => (
                <button key={b.id} className="tb-btn" onClick={() => void moveManyToBox(toMove, b)}>{b.name}</button>
              ))}
            </div>
            <div className="modal-btns"><button className="tb-btn" onClick={() => setBulkMoveScope(null)}>Cancel</button></div>
          </div>
        </div>
        )
      })()}
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
          <label>Name<input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
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
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Base Set Master Binder" autoFocus />
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
          <input type="text" value={coverImage} onChange={e => setCoverImage(e.target.value)} placeholder="https://…" />
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

function Displays({ userId, space, reload, caseId, setCaseId }: {
  userId: string; space: CollectionSpace; reload: () => Promise<void>
  caseId: string; setCaseId: (id: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const [lots, setLots] = useState<InventoryLot[]>([])
  const [owned, setOwned] = useState<OwnedCard[]>([])
  const [placements, setPlacements] = useState<CardAllocation[]>([])
  const [activeSlot, setActiveSlot] = useState<DisplaySlot | null>(null)
  const [message, setMessage] = useState('')
  const preview = usePreview()

  const display = space.displayCases.find(c => c.id === caseId) || space.displayCases[0]
  const displayId = display?.id

  const loadContents = async () => {
    if (!display) return
    try {
      const [nextLots, nextOwned, nextPlacements] = await fetchDisplayContents(userId, display.id)
      setLots(nextLots); setOwned(nextOwned); setPlacements(nextPlacements)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load this display case.')
    }
  }
  useEffect(() => {
    if (!displayId) return
    let cancelled = false
    fetchDisplayContents(userId, displayId)
      .then(([nextLots, nextOwned, nextPlacements]) => {
        if (cancelled) return
        setLots(nextLots); setOwned(nextOwned); setPlacements(nextPlacements)
      })
      .catch(e => { if (!cancelled) setMessage(e instanceof Error ? e.message : 'Could not load this display case.') })
    return () => { cancelled = true }
  }, [userId, displayId])

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
    <section
      className={`display-gallery ${display?.lightEnabled ? 'lights-on' : 'lights-off'}`}
      style={{ '--case-frame': display?.frameColor || '#3a3164', '--case-light': display?.lightColor || '#ffe1a5' } as React.CSSProperties}
    >
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
        <div className="gallery-stage-flat">
          {/* A real cabinet, not a stack of separate glowing panels: one
              frame (crown nameplate + side walls + base) with the shelves
              as glass ledges INSIDE it, not independent boxes with gaps
              between them. That gap-and-glow version read as "a rectangle
              with a light" because structurally that's all it was. */}
          <div className="display-cabinet">
            <div className="cabinet-crown"><span>{display.name}</span></div>
            <div className="cabinet-glass-interior">
              {shelves.map((row, i) => (
                <section className="cabinet-shelf" key={i}>
                  <h3>Shelf {String.fromCharCode(65 + i)}</h3>
                  <div className="box-card-grid">
                    {row.map(slot => {
                      const allocation = allocationFor(slot.id)
                      const lot = allocation && lots.find(l => l.id === allocation.lotId)
                      const card = lot && cardFor(lot.cardId)
                      return card ? (
                        <div className={'box-card-tile' + (activeSlot?.id === slot.id ? ' selected' : '')} key={slot.id}>
                          <ZoomableCardImage card={card} preview={preview} />
                          <b>{card.name}</b>
                          <small>{lot?.condition} · {lot?.variantKey}</small>
                          <div className="box-card-tile-actions">
                            <button onClick={() => setActiveSlot(slot)}>Change</button>
                            <button onClick={() => void remove(allocation!)}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className={'box-card-tile box-card-tile-empty' + (activeSlot?.id === slot.id ? ' selected' : '')}
                          key={slot.id} onClick={() => setActiveSlot(slot)}
                        >
                          <div className="thumb-placeholder">🃏</div>
                          <span className="slot-empty-hint">+ Add</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="cabinet-base"><i /><i /><i /></div>
          </div>

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
