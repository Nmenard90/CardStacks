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
import { baseCond, basePrice, condLabel, condPrice, lotKey, type CondMap } from '../lib/conditions'
import { compareBy, type SortDir, type SortFields, type SortKey } from '../lib/cardSort'
import { SortControl } from '../components/SortControl'
import { usePagedList } from '../lib/usePagedList'
import { createBinder, getBinder, listBinders, updateBinder } from '../api/binders'
import { getSets } from '../api/cards'
import { getOwnedCards, saveEntry } from '../api/collection'
import {
  arrangeSetBoxesByDate, createDisplayCase, createSpace, createStorageUnit, getCaseAllocations,
  getDrawerPlacements, getSpaceInventory, listSpaces, placeBinder, placeBox,
  placeCopies, placeInBinderSlot, removePlacement, setDisplayLights,
} from '../api/rooms'
import { createBox, createDrawer, deleteBox, deleteDrawer, listBoxes, mergeBoxes, updateBox, updateDrawer } from '../api/storage'
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
/** How many Spaces history entries deep `state` is (0 = Spaces home). */
function spacesDepth(state: unknown): number {
  return (state as { spacesDepth?: number } | null)?.spacesDepth ?? 0
}

/** Pushes a same-URL history entry at `depth`, keeping React Router's own
 *  fields on history.state intact. */
function pushSpacesDepth(depth: number) {
  window.history.pushState({ ...(window.history.state ?? {}), spacesDepth: depth }, '', location.href)
}

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
/** Every compartment's placements, flattened — a box is read as a whole. */
const fetchBoxContents = (userId: string, drawerIds: string[]) => Promise.all([
  getSpaceInventory(userId),
  Promise.all(drawerIds.map(id => getDrawerPlacements(userId, id))).then(lists => lists.flat()),
  getOwnedCards(userId),
])
const byPosition = (ds: StorageDrawer[]) => [...ds].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))

/** Somewhere a stack can be moved to: a whole box (its first compartment)
 *  or one specific compartment of a multi-compartment box. */
interface MoveTarget { key: string; label: string; box: StorageBox; drawer?: StorageDrawer }
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
  //
  // Each pushed entry records its depth (1 = area, 2 = open box), so
  // popstate can tell how far back the user went — one press, or the
  // multi-step history.go() from "All spaces" — and close exactly what's
  // above that depth.
  const closeBoxHandler = useRef<(() => boolean) | null>(null)
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const depth = spacesDepth(e.state)
      if (depth < 2) closeBoxHandler.current?.()
      if (depth < 1) setView('home')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const enterView = (v: View) => {
    if (view === 'home' && v !== 'home') pushSpacesDepth(1)
    if (v === 'storage' && view !== 'storage') { setStorageUnitId(''); setOpeningBoxId('') }
    if (v === 'displays' && view !== 'displays') setDisplayCaseId('')
    setView(v)
  }
  /** Back to the Spaces home, unwinding the history entries enterView (and
   *  an open box) pushed — otherwise they'd linger and the back button
   *  would need extra do-nothing presses before it actually left the page. */
  const goHome = () => {
    const depth = spacesDepth(window.history.state)
    if (depth > 0) window.history.go(-depth)
    else setView('home')
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
    if (hit.kind === 'space') { setSpaceId(hit.id); goHome() }
    else if (hit.kind === 'box') {
      const box = boxes.find(candidate => candidate.id === hit.id)
      if (view === 'home') pushSpacesDepth(1)
      setSpaceId(hit.spaceId || defaultSpaceId)
      if (box?.storageUnitId) setStorageUnitId(box.storageUnitId)
      setOpeningBoxId(hit.id)
      setView('storage')
    }
    else if (hit.kind === 'binder') navigate(`/binder/${hit.id}`)
    else {
      if (view === 'home') pushSpacesDepth(1)
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
          <button className="logo spaces-home-button" onClick={goHome}>MY <span>SPACES</span></button>
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
            <button onClick={goHome}>‹ All spaces</button>
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
  // The order the last "Sets by date" press used — the button offers the other.
  const [dateOrder, setDateOrder] = useState<'oldest' | 'newest'>('newest')
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

  /** First stack (top shelf first, left to right) on `target` with room left,
   *  or null when the whole unit is full. `exceptBoxId` is ignored when
   *  counting, so a box being moved doesn't block its own new spot. */
  const firstFreeSpot = (target: StorageUnit, allBoxes: StorageBox[], exceptBoxId = '') => {
    for (let shelf = 0; shelf < target.shelfCount; shelf++) {
      for (let stack = 0; stack < target.positionsPerShelf; stack++) {
        const pile = allBoxes.filter(x => x.id !== exceptBoxId && x.storageUnitId === target.id && x.shelfIndex === shelf && x.stackIndex === stack)
        if (pile.length < target.maxStackHeight) return { shelfIndex: shelf, stackIndex: stack, stackLevel: nextFreeLevel(pile) }
      }
    }
    return null
  }

  /** "Send to <unit>" from the moving banner: drops the armed box into the
   *  first free spot on another shelf unit without having to switch tabs. */
  const sendToUnit = async (target: StorageUnit) => {
    const boxId = armed
    if (!boxId) return
    setArmed('')
    try {
      const freshBoxes = await listBoxes(userId)
      const spot = firstFreeSpot(target, freshBoxes, boxId)
      if (!spot) throw new Error(`${target.name} is full.`)
      await placeBox(userId, boxId, { spaceId: space.id, unitId: target.id, ...spot })
      await reload()
      setUnitId(target.id)
      setMessage(`Moved to ${target.name}, Shelf ${String.fromCharCode(65 + spot.shelfIndex)}, stack ${spot.stackIndex + 1}.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not move that box.')
    }
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
      const spot = firstFreeSpot(target, freshBoxes)
      if (!spot) throw new Error('This shelf unit is full. Add another shelf unit first.')
      const { shelfIndex, stackIndex, stackLevel } = spot
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
          pushSpacesDepth(2)
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
    // Excludes the box being moved: re-dropping a box on its own stack must
    // not count it against the height limit or the next free level.
    const current = boxes.filter(x => x.id !== armed && x.storageUnitId === unit.id && x.shelfIndex === shelf && x.stackIndex === stack)
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
  /** Each press flips the order: oldest first, then newest first, … */
  const arrangeByDate = async () => {
    if (!unit) return
    const order = dateOrder === 'oldest' ? 'newest' : 'oldest'
    try {
      const { arranged } = await arrangeSetBoxesByDate(userId, unit.id, order)
      setDateOrder(order)
      await reload()
      setMessage(arranged
        ? `${arranged} set box${arranged === 1 ? '' : 'es'} across your shelf units now go ${order} set first.`
        : `No set boxes on ${unit.name} to arrange.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not arrange the set boxes.')
    }
  }

  if (picking) return <BoxPicker cancel={() => setPicking(false)} choose={choice => void createChosen(choice)} />
  if (pickingUnit) return <ShelfUnitPicker cancel={() => setPickingUnit(false)} choose={choice => void createUnit(choice)} />

  return (
    <section className="storage-view box-unit-view">
      <header className="gallery-heading">
        <div><small>{space.name.toUpperCase()} / STORAGE</small><h2>Card Archive</h2><p>{boxes.length} real boxes · drag and stack vertically</p></div>
        <div>
          {unit && (
            <button
              title="Put the set boxes on all your shelf units in set release order. Other boxes stay where they are."
              onClick={() => void arrangeByDate()}
            >⇅ Sets {dateOrder === 'oldest' ? 'newest' : 'oldest'} first</button>
          )}
          <button onClick={() => setPickingUnit(true)}>+ Shelf unit</button><button className="primary" onClick={() => setPicking(true)}>+ Box</button>
        </div>
      </header>

      {message && <div className="spaces-action-message">{message}</div>}
      {armed && (
        <div className="spaces-action-message moving-banner">
          <span>
            Moving <b>{boxes.find(b => b.id === armed)?.name}</b> — tap a shelf position to place it
            {space.storageUnits.length > 1 ? ', or switch shelf unit with the tabs below.' : '.'}
          </span>
          {space.storageUnits.filter(u => u.id !== unit?.id).map(u => (
            <button key={u.id} onClick={() => void sendToUnit(u)}>→ {u.name}</button>
          ))}
          <button onClick={() => setArmed('')}>Cancel</button>
        </div>
      )}

      <div className="live-unit-tabs">
        {space.storageUnits.map(x => (
          <button className={`${unit?.id === x.id ? 'active' : ''} ${armed && unit?.id !== x.id ? 'drop-ready' : ''}`} onClick={() => setUnitId(x.id)} key={x.id}>
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
  const [sort, setSort] = useState<SortKey>(isAutoSetBox ? 'number' : 'name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [setNameById, setSetNameById] = useState<Record<string, string>>({})
  const [setDateById, setSetDateById] = useState<Record<string, string>>({})
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

  // Compartments (drawers). The ref mirrors state for async paths — queued
  // bulk-add flushes and the unmount flush run long after the render that
  // scheduled them, and must use whatever compartment is current THEN.
  const [drawers, setDrawersState] = useState<StorageDrawer[]>(() => byPosition(box.drawers.length ? box.drawers : [drawer]))
  const drawersRef = useRef(drawers)
  const setDrawers = (ds: StorageDrawer[]) => { drawersRef.current = ds; setDrawersState(ds) }
  // Which compartment "Add a new card" / "+ Add one" drops copies into.
  const [targetDrawerId, setTargetDrawerIdState] = useState(drawer.id)
  const targetRef = useRef(drawer.id)
  const setTargetDrawerId = (id: string) => { targetRef.current = id; setTargetDrawerIdState(id) }
  const [editingDrawerId, setEditingDrawerId] = useState<string | null>(null)
  const [drawerName, setDrawerName] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergePicks, setMergePicks] = useState<Set<string>>(new Set())


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
      const [nextLots, nextPlacements, nextOwned] = await fetchBoxContents(userId, drawersRef.current.map(d => d.id))
      setLots(nextLots); setPlacements(nextPlacements); setOwned(nextOwned); setMessage('')
      onLoaded?.()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load box inventory.')
      onLoaded?.()
    }
  }
  /** Re-reads this box's compartment list (after add/rename/delete/merge)
   *  and then its contents. Keeps the add-target valid if it was deleted. */
  const refreshDrawers = async () => {
    const fresh = await listBoxes(userId)
    const ds = byPosition(fresh.find(b => b.id === box.id)?.drawers ?? [])
    setDrawers(ds)
    if (ds.length && !ds.some(d => d.id === targetRef.current)) setTargetDrawerId(ds[0].id)
    await load()
  }
  useEffect(() => {
    let cancelled = false
    fetchBoxContents(userId, drawersRef.current.map(d => d.id))
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
    const m: Record<string, string> = {}, d: Record<string, string> = {}
    for (const s of list) { m[s.id] = s.name; d[s.id] = s.releaseDate }
    setSetNameById(m)
    setSetDateById(d)
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
    // The set's auto-filing compartment may now live inside a merged box,
    // so look it up by its compartment tag first, then the legacy box type.
    const autoDrawers = [
      ...freshBoxes.flatMap(b => b.drawers).filter(d => d.autoSetId === setId),
      ...(freshBoxes.find(b => b.boxType === `auto_set:${setId}`)?.drawers ?? []),
    ]
    for (const d of autoDrawers) {
      const placements = await getDrawerPlacements(userId, d.id)
      const allocation = placements.find(a => a.lotId === lotId)
      if (allocation) {
        // Auto-filing already put it exactly where it was being added.
        if (d.id === targetRef.current) return true
        await removePlacement(userId, allocation.id)
        await placeCopies(userId, { lotId, drawerId: targetRef.current, quantity: allocation.quantity, protection: allocation.protection ?? 'raw' })
        return true
      }
    }
    return false
  }

  /** Does this lot hold copies of `cardId` under condition key `condKey`
   *  ("NM", "NM 1st Ed", "NM · reverse")? */
  const lotMatches = (l: InventoryLot, cardId: string, condKey: string) =>
    l.cardId === cardId && lotKey(l) === condKey

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
      await placeCopies(userId, { lotId: lot.id, drawerId: targetRef.current, quantity: Math.min(qty, free), protection: 'raw' })
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
  const removeCopies = async (card: Card, condKey: string, k: number, fromDrawerId?: string) => {
    setMessage(`Removing ${k} × ${card.name} (${condKey})…`)
    const settle = () => shiftOptimistic(`${card.id}|${condKey}`, k)
    try {
      const [freshLots, perDrawer] = await Promise.all([
        getSpaceInventory(userId),
        Promise.all(drawersRef.current.map(d => getDrawerPlacements(userId, d.id))),
      ])
      const lotIds = new Set(freshLots.filter(l => lotMatches(l, card.id, condKey)).map(l => l.id))
      const mine = perDrawer.flat().filter(a => lotIds.has(a.lotId))
        .sort((a, b) => Number(b.drawerId === fromDrawerId) - Number(a.drawerId === fromDrawerId))
      const removed = Math.min(k, mine.reduce((n, a) => n + a.quantity, 0))
      if (!removed) { await load(settle); setMessage(''); return }

      let left = removed
      for (const a of mine) {
        if (!left) break
        await removePlacement(userId, a.id)
        if (a.quantity > left) {
          await placeCopies(userId, { lotId: a.lotId, drawerId: a.drawerId ?? drawer.id, quantity: a.quantity - left, protection: a.protection })
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
  const changeQty = (card: Card, condKey: string, delta: number, fromDrawerId?: string) => {
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
      chainFor(card.id, () => removeCopies(card, condKey, rest, fromDrawerId))
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
    try { await placeCopies(userId, { lotId: lot.id, drawerId: targetRef.current, quantity: 1, protection: 'raw' }); await load() }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not place this copy.') }
  }
  // Every move below shares the same shape: remove first, then place, so the
  // in-flight total never briefly double-counts this copy as over-allocated.
  // If the placement step fails, the copy is left unplaced (with a clear
  // message) rather than silently duplicated or lost.
  const drawerFor = async (target: MoveTarget) =>
    target.drawer ?? byPosition(target.box.drawers)[0] ?? await createDrawer(target.box.id, 'Main compartment')
  const moveToBox = async (allocation: CardAllocation, target: MoveTarget) => {
    setMovingAllocation(null)
    setMessage(`Moving to ${target.label}…`)
    try {
      await removePlacement(userId, allocation.id)
      const targetDrawer = await drawerFor(target)
      await placeCopies(userId, { lotId: allocation.lotId, drawerId: targetDrawer.id, quantity: allocation.quantity, protection: allocation.protection })
      await load()
      setMessage(`Moved to ${target.label}.`)
    } catch (e) {
      await load()
      setMessage(e instanceof Error ? `Removed from this box, but could not place it in ${target.label}: ${e.message}` : 'Could not move this copy.')
    }
  }
  // Wholesale transfers out of an auto-filed box (or any box) into wherever
  // the user actually wants it — "all" or a checked "selected" subset both
  // land here, just with a different source list. One card at a time
  // through the API is the only option available (no bulk endpoint), so
  // this runs moveToBox's own remove-then-place sequence per allocation,
  // reporting progress as it goes.
  const moveManyToBox = async (toMove: CardAllocation[], target: MoveTarget) => {
    setBulkMoveScope(null)
    let moved = 0
    setMessage(`Moving 0 of ${toMove.length} to ${target.label}…`)
    try {
      const targetDrawer = await drawerFor(target)
      for (const allocation of toMove) {
        // Already in that compartment — nothing to do for this one.
        if (allocation.drawerId === targetDrawer.id) { moved++; continue }
        await removePlacement(userId, allocation.id)
        await placeCopies(userId, { lotId: allocation.lotId, drawerId: targetDrawer.id, quantity: allocation.quantity, protection: allocation.protection })
        moved++
        setMessage(`Moving ${moved} of ${toMove.length} to ${target.label}…`)
      }
      setSelectedIds(new Set())
      await load()
      setMessage(`Moved ${moved} card${moved === 1 ? '' : 's'} to ${target.label}.`)
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

  const addCompartment = async () => {
    try {
      const made = await createDrawer(box.id, `Compartment ${drawers.length + 1}`)
      await refreshDrawers()
      setTargetDrawerId(made.id)
      setDrawerName(made.name); setEditingDrawerId(made.id)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not add a compartment.') }
  }
  const saveDrawerName = async (d: StorageDrawer) => {
    const trimmed = drawerName.trim()
    setEditingDrawerId(null)
    if (!trimmed || trimmed === d.name) return
    try { await updateDrawer(d.id, { name: trimmed }); await refreshDrawers() }
    catch { setMessage('Could not rename that compartment.') }
  }
  /** Deleting a compartment un-places its cards (they stay owned, and show
   *  up under "Available owned copies") — the backend cascades placements. */
  const deleteCompartment = async (d: StorageDrawer) => {
    if (drawers.length <= 1) { setMessage('A box needs at least one compartment — delete the box instead.'); return }
    const n = placements.filter(p => p.drawerId === d.id).reduce((sum, p) => sum + p.quantity, 0)
    const warning = n > 0
      ? `Delete compartment "${d.name}"? Its ${n} card${n === 1 ? '' : 's'} stay in your collection, just no longer placed in this box.`
      : `Delete compartment "${d.name}"?`
    if (!window.confirm(warning)) return
    try { await deleteDrawer(d.id); await refreshDrawers() }
    catch { setMessage('Could not delete that compartment.') }
  }
  const mergeCandidates = otherBoxes.filter(b => (b.kind ?? 'box') === 'box')
  const mergeIn = async () => {
    const ids = [...mergePicks]
    setMerging(false); setMergePicks(new Set())
    if (!ids.length) return
    setMessage(`Merging ${ids.length} box${ids.length === 1 ? '' : 'es'} into ${savedName}…`)
    try {
      const { movedCompartments } = await mergeBoxes(box.id, ids)
      await refreshDrawers()
      await onRenamed()
      setMessage(`Merged — ${movedCompartments} compartment${movedCompartments === 1 ? '' : 's'} moved into ${savedName}. Their cards came along.`)
    } catch (e) {
      await refreshDrawers()
      setMessage(e instanceof Error ? e.message : 'Could not merge those boxes.')
    }
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
  const byChosenSort = compareBy((lot?: InventoryLot): SortFields => {
    const card = cardFor(lot?.cardId || '')
    const key = lot ? lotKey(lot) : ''
    return {
      name: card?.name || lot?.cardId || '', setId: card?.setId || '', number: card?.number || '',
      rarity: card?.rarity, artist: card?.artist, condition: key || undefined,
      value: (card && (condPrice(card, key) || basePrice(card))) || null,
      qty: lot?.quantity,
    }
  }, sort, sortDir, id => setDateById[id])

  const conditions = [...new Set(lots.map(l => l.condition))].sort()
  const protections = [...new Set(placements.map(a => a.protection || 'raw'))].sort()
  const variants = [...new Set(lots.map(l => l.variantKey))].sort()
  // Set names aren't loaded here (only setId) — showing the id keeps this
  // filter honest without pulling in a full set catalog fetch just for it.
  const sets = [...new Set(lots.map(l => cardFor(l.cardId)?.setId).filter((s): s is string => !!s))].sort()

  const multiCompartment = drawers.length > 1
  const drawerOrder = new Map(drawers.map((d, i) => [d.id, i]))
  const drawerById = new Map(drawers.map(d => [d.id, d]))
  const countIn = (drawerId: string) => placements.filter(p => p.drawerId === drawerId).reduce((n, p) => n + p.quantity, 0)
  const targetDrawer = drawerById.get(targetDrawerId)

  // Everywhere a stack can go: this box's other compartments, then other
  // boxes — as a whole if they have one compartment, per compartment if more.
  const moveTargetsFor = (fromDrawerId?: string): MoveTarget[] => [
    ...(multiCompartment ? drawers.filter(d => d.id !== fromDrawerId).map(d => ({ key: d.id, label: `${savedName} › ${d.name}`, box, drawer: d })) : []),
    ...otherBoxes.flatMap(b => b.drawers.length > 1
      ? byPosition(b.drawers).map(d => ({ key: d.id, label: `${b.name} › ${d.name}`, box: b, drawer: d }))
      : [{ key: b.id, label: b.name, box: b }]),
  ]
  const canMoveAnywhere = multiCompartment || otherBoxes.length > 0 || binders.length > 0 || displayCases.length > 0

  const insideBox = placements.filter(matchesAllocation).sort((a, b) => byChosenSort(lots.find(l => l.id === a.lotId), lots.find(l => l.id === b.lotId)))
  // One tile per card (not per stack): every stack of a card in this box —
  // NM, LP, 1st Ed… — folds into one Bulk Add-style tile with a condition
  // breakdown, in the same order the filtered/sorted stacks came in. With
  // several compartments it's one tile per card per compartment.
  type CardGroup = { key: string; cardId: string; drawerId?: string; card?: Card; allocations: CardAllocation[]; conds: CondMap }
  const groupKey = (cardId: string, drawerId?: string) => multiCompartment ? `${drawerId ?? ''}|${cardId}` : cardId
  const groupMap = new Map<string, CardGroup>()
  for (const a of insideBox) {
    const lot = lots.find(l => l.id === a.lotId)
    if (!lot) continue
    const key = lotKey(lot)
    const gk = groupKey(lot.cardId, a.drawerId ?? undefined)
    let g = groupMap.get(gk)
    if (!g) { g = { key: gk, cardId: lot.cardId, drawerId: a.drawerId ?? undefined, card: cardFor(lot.cardId), allocations: [], conds: {} }; groupMap.set(gk, g) }
    g.allocations.push(a)
    g.conds[key] = (g.conds[key] ?? 0) + a.quantity
  }
  // Cards just added from the form show up immediately (in the compartment
  // they're going into), before their save lands.
  for (const [key, qty] of Object.entries(pendingAdds)) {
    const card = pendingCardMap[key]
    if (!qty || !card) continue
    const gk = groupKey(card.id, targetDrawerId)
    if (groupMap.has(gk)) continue
    groupMap.set(gk, { key: gk, cardId: card.id, drawerId: targetDrawerId, card, allocations: [], conds: {} })
  }
  // A box holding more than one set is always grouped by set (with a
  // divider per set, below), whatever the sort — the chosen sort still
  // orders cards within each set (Array.sort is stable). Compartments
  // outrank sets: each compartment is grouped on its own.
  const multiSetBox = new Set([...groupMap.values()].map(g => g.card?.setId)).size > 1
  const setLabel = (setId?: string) => (setId && setNameById[setId]) || setId || ''
  const insideGroups = [...groupMap.values()]
  insideGroups.sort((a, b) =>
    (multiCompartment ? (drawerOrder.get(a.drawerId ?? '') ?? 0) - (drawerOrder.get(b.drawerId ?? '') ?? 0) : 0)
    // Sets in release order, oldest first.
    || (multiSetBox ? (setDateById[a.card?.setId ?? ''] ?? '').localeCompare(setDateById[b.card?.setId ?? ''] ?? '')
                      || setLabel(a.card?.setId).localeCompare(setLabel(b.card?.setId)) : 0))
  /** What a tile shows: saved copies + still-queued adds, with any
   *  half-typed quantity shown as typed. Queued adds and typing only show
   *  on the tile in the compartment they're going into. */
  const tileConds = (g: CardGroup): CondMap => {
    const conds: CondMap = { ...g.conds }
    if (multiCompartment && g.drawerId !== targetDrawerId) return conds
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
  const inBoxCount = (cardId: string) =>
    [...groupMap.values()].filter(g => g.cardId === cardId)
      .reduce((n, g) => n + Object.values(tileConds(g)).reduce((m, q) => m + q, 0), 0)
  const available = lots.filter(lot => lot.quantity - lot.allocated > 0 && matchesLot(lot)).sort(byChosenSort)
  // "Load more" pagination, not a hard cutoff — a bulk box or a collection
  // in the hundreds of thousands must stay browsable instead of silently
  // hiding everything past some fixed count. Resets to page one whenever
  // the search/filter/sort combo changes, not on every render.
  const insideBoxPage = usePagedList(insideGroups, `${q}|${conditionFilter}|${variantFilter}|${protectionFilter}|${setFilter}|${duplicatesOnly}|${sort}|${sortDir}`)
  const availablePage = usePagedList(available, `${q}|${conditionFilter}|${variantFilter}|${setFilter}|${sort}|${sortDir}`)

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
        {selectedIds.size > 0 && moveTargetsFor().length > 0 && (
          <button onClick={() => setBulkMoveScope('selected')}>📦 Move {selectedIds.size} selected to…</button>
        )}
        {placements.length > 0 && moveTargetsFor().length > 0 && (
          <button onClick={() => setBulkMoveScope('all')}>📦 Move all to…</button>
        )}
        {mergeCandidates.length > 0 && (
          <button onClick={() => setMerging(true)} title="Fold other boxes into this one as compartments">⧉ Merge boxes in…</button>
        )}
        <button onClick={() => void deleteThisBox()} style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)' }}>🗑 Delete box</button>
      </header>

      {message && <div className="spaces-action-message">{message}</div>}

      <div className="box-toolbar">
        <label className="inventory-search"><span>🔍</span><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search inside this box…" /></label>
        <div className="inventory-filters">
          <SortControl
            keys={['name', 'number', 'value', 'qty', 'rarity', 'artist', 'condition', ...(isAutoSetBox ? [] : ['set'] as SortKey[])]}
            sort={sort} dir={sortDir} onChange={(k, d) => { setSort(k); setSortDir(d) }}
          />
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

      <div className="compartment-bar">
        <span className="compartment-bar-label">Compartments</span>
        {drawers.map(d => editingDrawerId === d.id ? (
          <input
            key={d.id} className="compartment-name-input" autoFocus value={drawerName}
            onChange={e => setDrawerName(e.target.value)}
            onBlur={() => void saveDrawerName(d)}
            onKeyDown={e => { if (e.key === 'Enter') void saveDrawerName(d); if (e.key === 'Escape') setEditingDrawerId(null) }}
          />
        ) : (
          <span key={d.id} className={'compartment-chip' + (d.id === targetDrawerId ? ' active' : '')}>
            <button onClick={() => setTargetDrawerId(d.id)} title="New cards you add go into this compartment">
              {d.name} <small>{countIn(d.id)}</small>
            </button>
            {d.id === targetDrawerId && (
              <>
                <button className="compartment-tool" title="Rename" onClick={() => { setDrawerName(d.name); setEditingDrawerId(d.id) }}>✎</button>
                {multiCompartment && <button className="compartment-tool" title="Delete compartment" onClick={() => void deleteCompartment(d)}>🗑</button>}
              </>
            )}
          </span>
        ))}
        <button className="compartment-add" onClick={() => void addCompartment()}>+ Compartment</button>
      </div>

      <section className="box-open-surface">
        <h3>Add cards to this box{multiCompartment && targetDrawer ? ` → ${targetDrawer.name}` : ''}</h3>
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
                const prev = i > 0 ? insideBoxPage.visible[i - 1] : undefined
                const setId = card?.setId
                // Compartment walls outrank set dividers: a new compartment
                // always gets its own header, and restarts set grouping.
                const newCompartment = multiCompartment && (i === 0 || group.drawerId !== prev?.drawerId)
                const divider = (sort === 'set' || multiSetBox) && (i === 0 || newCompartment || setId !== prev?.card?.setId)
                const compartment = group.drawerId ? drawerById.get(group.drawerId) : undefined
                // +/− on a tile works on that tile's compartment.
                const aimHere = () => { if (multiCompartment && group.drawerId) setTargetDrawerId(group.drawerId) }
                const ids = group.allocations.map(a => a.id)
                const allSelected = ids.length > 0 && ids.every(id => selectedIds.has(id))
                const conds = tileConds(group)
                const selCond = selConds[group.cardId] ?? (Object.keys(conds).find(k => conds[k] > 0) ?? 'NM')
                const current = (group.conds[selCond] ?? 0)
                  + (multiCompartment && group.drawerId !== targetDrawerId ? 0 : pendingAdds[`${group.cardId}|${selCond}`] ?? 0)

                const tile = !card ? (
                  <div className="box-card-tile" key={group.key}>
                    <div className="thumb-placeholder">🃏</div>
                    <b>{group.cardId}</b>
                    <small>{Object.entries(group.conds).map(([k, n]) => `${k} ×${n}`).join(' · ')}</small>
                    <button className="box-card-add" onClick={() => void unplaceAll(group.allocations)}>Remove from box</button>
                  </div>
                ) : (
                    <CardTile
                      key={group.key} card={card} conds={conds} selCond={selCond}
                      setName={setNameById[card.setId]}
                      onAdj={d => { aimHere(); changeQty(card, selCond, d, group.drawerId) }}
                      onSetQty={q => { aimHere(); typeQty(card, selCond, current, q) }}
                      onSelectCond={c => setSelConds(s => ({ ...s, [group.cardId]: c }))}
                      onAdjCond={(c, d) => { aimHere(); changeQty(card, c, d, group.drawerId) }}
                      onPreview={(src, opts) => (src ? preview.show(src, opts) : preview.hide())}
                      selected={allSelected}
                      onToggleSelect={ids.length ? () => setSelectedIds(prev => {
                        const next = new Set(prev)
                        for (const id of ids) { if (allSelected) next.delete(id); else next.add(id) }
                        return next
                      }) : undefined}
                      actions={ids.length ? [
                        {
                          label: 'Move', title: 'Move this card to another compartment, box, binder or display case',
                          disabled: !canMoveAnywhere,
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

                return [
                  newCompartment && (
                    <div className="box-set-divider box-compartment-divider" key={`compartment-${group.key}`}>
                      <span>▤ {compartment?.name ?? 'Compartment'}</span>
                      <small>{group.drawerId ? countIn(group.drawerId) : 0} cards</small>
                    </div>
                  ),
                  divider && (
                    <div className="box-set-divider" key={`divider-${group.key}`}>
                      <span>{(setId && setNameById[setId]) || setId || 'Unknown set'}</span>
                    </div>
                  ),
                  tile,
                ]
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
        <h3>Available owned copies{available.length > 0 ? ` (${available.length})` : ''}{multiCompartment && targetDrawer ? ` → ${targetDrawer.name}` : ''}</h3>
        {!available.length && <p className="box-empty-note">Nothing available to add — everything owned is already placed somewhere, or nothing matches the current search/filter.</p>}
        {availablePage.visible.length > 0 && (
          <div className="box-card-grid">
            {availablePage.visible.map(lot => {
              const card = cardFor(lot.cardId)
              const subtitle = `${condLabel(lotKey(lot))} · ${lot.quantity - lot.allocated} available`
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

            {moveTargetsFor(movingAllocation.drawerId).length > 0 && (
              <>
                <p className="move-target-heading">Boxes &amp; compartments</p>
                <div className="move-target-list">
                  {moveTargetsFor(movingAllocation.drawerId).map(t => (
                    <button key={t.key} className="tb-btn" onClick={() => void moveToBox(movingAllocation, t)}>{t.label}</button>
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

            {!canMoveAnywhere && <p>Nothing else in this space to move it to yet.</p>}

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
            <p className="move-target-heading">Boxes &amp; compartments</p>
            <div className="move-target-list">
              {moveTargetsFor().map(t => (
                <button key={t.key} className="tb-btn" onClick={() => void moveManyToBox(toMove, t)}>{t.label}</button>
              ))}
            </div>
            <div className="modal-btns"><button className="tb-btn" onClick={() => setBulkMoveScope(null)}>Cancel</button></div>
          </div>
        </div>
        )
      })()}

      {merging && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setMerging(false) }}>
          <div className="modal">
            <h3>Merge boxes into {savedName}</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Each box you pick becomes a compartment in this one, named after it. All its cards come along with their
              quantities, then the empty box is removed. Auto-filing keeps sending new cards of that set to its compartment.
            </p>
            <div className="merge-pick-list">
              {mergeCandidates.map(b => {
                const n = b.drawers.reduce((sum, d) => sum + d.cardCount, 0)
                return (
                  <label key={b.id} className="merge-pick">
                    <input
                      type="checkbox" checked={mergePicks.has(b.id)}
                      onChange={() => setMergePicks(prev => { const next = new Set(prev); if (next.has(b.id)) next.delete(b.id); else next.add(b.id); return next })}
                    />
                    <span>{b.name}<small>{n} card{n === 1 ? '' : 's'}{b.drawers.length > 1 ? ` · ${b.drawers.length} compartments` : ''}</small></span>
                  </label>
                )
              })}
            </div>
            <div className="modal-btns">
              <button className="tb-btn" onClick={() => { setMerging(false); setMergePicks(new Set()) }}>Cancel</button>
              <button className="tb-btn primary" disabled={!mergePicks.size} onClick={() => void mergeIn()}>
                Merge {mergePicks.size || ''} box{mergePicks.size === 1 ? '' : 'es'} in
              </button>
            </div>
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
                          <small>{lot ? condLabel(lotKey(lot)) : ''}</small>
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
                      <span><b>{card?.name || lot?.cardId}</b><small>{lot ? condLabel(lotKey(lot)) : ''}</small></span>
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
                      <span><b>{card?.name || lot.cardId}</b><small>{condLabel(lotKey(lot))} · {lot.quantity - lot.allocated} available</small></span>
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
