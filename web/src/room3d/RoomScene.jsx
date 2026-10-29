/**
 * RoomScene.jsx — the 3D collector's room: the user's real binders, card boxes and display cases as furniture.
 *
 * PURPOSE
 *   Renders the Clubhouse room (clubhouse/) with React Three Fiber and the HTML panels over it. Every binder, box and
 *   displayed card is the user's own (data/useLiveRoom.ts). Pick a zone (box shelf, binder bookcase, display cabinet),
 *   then a single item: a binder opens as a 3D book, a box as a card rolodex, a displayed card comes forward to read.
 *   Furniture that stands for another part of the site (desk → Add Cards, pinboard → Shop, window → Explore, …)
 *   goes to that page.
 *
 * HOW IT WORKS
 *   Where you are lives in the URL hash (#/binders/<id>/card/<id>, #/storage/<id>, #/display/<id>), set through
 *   react-router, so the back button, reloads and shared links all land on the same view. The camera rig eases to
 *   the zone's viewpoint and slides the subject into whatever part of the screen the panels leave free (freeRect.js).
 *
 * IMPORTS EXPLAINED
 *   @react-three/fiber — the WebGL canvas and per-frame hooks
 *   ClubhouseRoom      — the room itself; Room.jsx's DisplayCabinet and room/ShelfUnit draw the collection
 *   BinderBook / CardRolodex — the open binder and the box/picker card fan
 *   ItemPanel, ZoneBrowser, ViewBars — the HTML panels and control strips
 *
 * USED BY: pages/RoomPage.tsx (lazy-loaded, so three.js only downloads for this page)
 * DEPENDS ON: data/useLiveRoom.ts, clubhouse/config.js, room/*
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CardRolodex from './CardRolodex.jsx';
import BinderBook from './room/BinderBook.jsx';
import { freeRect } from './room/freeRect.js';
import { pageCount, pocketsPerPage } from './room/binderLayout.js';
import { BinderBar, PickerBar } from './ViewBars.jsx';
import ItemPanel from './ItemPanel.jsx';
import ZoneBrowser from './ZoneBrowser.jsx';
import { useLiveRoom, usePocketSearch } from './data/useLiveRoom.ts';
import ClubhouseRoom from './clubhouse/ClubhouseRoom.jsx';
import { CANVAS, DEFAULT_CAM, HOTSPOTS as ZONES } from './clubhouse/config.js';
import './styles.css';
import './clubhouse/site-ui.css';

const EMPTY_ROUTE = { focus: null, binderId: null, binderCardId: null, boxId: null, displayId: null };
const SITE_ZONES = new Set(['storage', 'binders', 'display']); // the room areas; 'explore' is the site's Explore page
const TAP = window.matchMedia?.('(pointer: coarse)').matches ? 'Tap' : 'Click'; // the hint's verb for this device

/**
 * PURPOSE: The room view a URL hash describes.
 * @param {string} hash  e.g. "#/binders/abc/card/xyz"
 * @return {typeof EMPTY_ROUTE}
 */
export function readRoute(hash) {
  const [zone, itemId, detailType, detailId] = hash.replace(/^#\/?/, '').split('/').map((part) => (part ? decodeURIComponent(part) : part));
  if (zone === 'binders' && itemId) return { ...EMPTY_ROUTE, focus: 'binders', binderId: itemId, binderCardId: detailType === 'card' ? detailId ?? null : null };
  if (zone === 'storage' && itemId) return { ...EMPTY_ROUTE, focus: 'storage', boxId: itemId };
  if (zone === 'display' && itemId) return { ...EMPTY_ROUTE, focus: 'display', displayId: itemId };
  if (SITE_ZONES.has(zone)) return { ...EMPTY_ROUTE, focus: zone };
  return { ...EMPTY_ROUTE };
}

/**
 * PURPOSE: The URL hash for a room view (inverse of readRoute).
 * @param {typeof EMPTY_ROUTE} route
 * @return {string} '' for the whole room
 */
export function routeHash(route) {
  const e = encodeURIComponent;
  if (route.binderId) return `#/binders/${e(route.binderId)}${route.binderCardId ? `/card/${e(route.binderCardId)}` : ''}`;
  if (route.boxId) return `#/storage/${e(route.boxId)}`;
  if (route.displayId) return `#/display/${e(route.displayId)}`;
  return route.focus ? `#/${route.focus}` : '';
}

/**
 * PURPOSE: A link into the Spaces page (the list view where boxes and cases are managed), in its own URL format.
 * @param {Record<string, string|null|undefined>} params  space / area / unit / box / case; empty values are left out
 * @return {string} e.g. "/spaces?area=storage&unit=u1&box=b2"
 */
export function spacesLink(params) {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return search ? `/spaces?${search}` : '/spaces';
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Wide stages show binder pages as a two-page spread; narrow ones show one page. Matches BinderBook. */
function useSpread(stage) {
  const read = useCallback(() => { const r = stage.current?.getBoundingClientRect(); return r && r.height ? r.width / r.height > 0.95 : window.innerWidth / window.innerHeight > 0.95; }, [stage]);
  const [spread, setSpread] = useState(read);
  useEffect(() => {
    const onResize = () => setSpread(read());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [read]);
  return spread;
}

const FILL = 0.84; // share of the free screen area a selected card may fill
const REF_ASPECT = 1.55; // the authored room/zone views fit the screen width at this aspect; narrower screens back away in proportion
const ZONE_SHARE = 0.6; // about how much of an authored zone view's width its furniture takes up
const ROOM_CENTRE = new THREE.Vector3(0, 1.5, 0);
const scratch = { p: new THREE.Vector3(), n: new THREE.Vector3(), q: new THREE.Quaternion(), box: new THREE.Box3(), size: new THREE.Vector3() };

/** Where to stand to look squarely at a display card: in front of its face, on the room's side of the cabinet. Null if the card is not in the scene. */
function inspectView(scene, seed) {
  const card = scene.getObjectByName(`DisplayHit_${seed}`);
  if (!card) return null;
  card.getWorldPosition(scratch.p); card.getWorldQuaternion(scratch.q);
  scratch.n.set(0, 0, 1).applyQuaternion(scratch.q);
  if (scratch.n.dot(ROOM_CENTRE.clone().sub(scratch.p)) < 0) scratch.n.negate(); // the face that looks into the room
  scratch.box.setFromObject(card).getSize(scratch.size);
  return { look: scratch.p.clone(), normal: scratch.n.clone(), w: Math.hypot(scratch.size.x, scratch.size.z), h: scratch.size.y };
}

function FixedCameraRig({ focus, reducedMotion, inspectSeed = null }) {
  const { camera, size, scene } = useThree();
  const currentLook = useRef(new THREE.Vector3(...DEFAULT_CAM.target));
  const offset = useRef({ x: 0, y: 0 }); // eased framing offset in screen pixels, moves the subject into the free area
  const free = useRef(null);
  const tick = useRef(0);
  useFrame((_, delta) => {
    const destination = focus ? ZONES[focus] : null;
    let look = new THREE.Vector3(...(destination ? destination.camTarget : DEFAULT_CAM.target));
    let pos = new THREE.Vector3(...(destination ? destination.camPos : DEFAULT_CAM.pos));
    const ease = reducedMotion ? 1 : 1 - Math.pow(0.0018, delta);
    const aspect = size.width / size.height;
    const view = inspectSeed !== null ? inspectView(scene, inspectSeed) : null;
    if (!free.current || tick.current++ % 6 === 0) free.current = freeRect(size.width, size.height);
    const rect = free.current;
    if (view) {
      // Stand far enough back that the card fills FILL of the free area, whichever of its width or height is the tighter fit.
      const pxPerMetreAtOne = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const fit = rect ? Math.max(view.h * pxPerMetreAtOne / (FILL * rect.h), view.w * pxPerMetreAtOne / (FILL * rect.w)) : 1.95;
      look = view.look; pos = view.look.clone().addScaledVector(view.normal, Math.max(0.4, fit));
    } else {
      // Narrow spaces back away in proportion to how much narrower they are than the authored view. A zone fits the
      // area the panels leave free, and its furniture is only part of the authored view, so it backs away less.
      const fitAspect = rect && rect.h > 0 ? rect.w / rect.h : aspect;
      pos.sub(look).multiplyScalar(Math.max(1, (REF_ASPECT / fitAspect) * (focus ? ZONE_SHARE : 1))).add(look);
    }
    // Slide the framing so the subject sits in the middle of what the panels and buttons leave free.
    const want = { x: size.width / 2 - (rect.x + rect.w / 2), y: size.height / 2 - (rect.y + rect.h / 2) };
    offset.current.x += (want.x - offset.current.x) * ease; offset.current.y += (want.y - offset.current.y) * ease;
    if (Math.abs(offset.current.x) > 0.5 || Math.abs(offset.current.y) > 0.5) camera.setViewOffset(size.width, size.height, offset.current.x, offset.current.y, size.width, size.height);
    else if (camera.view?.enabled) camera.clearViewOffset();
    camera.position.lerp(pos, ease); currentLook.current.lerp(look, ease); camera.lookAt(currentLook.current);
  });
  return null;
}

/** Status chip: loading progress, then the user's totals, with reload and "how to use the room" buttons. */
function RoomStatus({ room, focused, onHelp }) {
  const help = <button type="button" className="sync-chip__help" onClick={onHelp} aria-label="How to use the room" title="How to use the room">?</button>;
  if (room.status === 'loading') return <aside className={`sync-chip${focused ? ' sync-chip--focus' : ''}`} aria-live="polite"><span className="sync-chip__dot sync-chip__dot--busy" /><div><strong>Your room</strong><small>{room.progress}</small></div>{help}</aside>;
  if (room.status === 'error') return <aside className="sync-chip sync-chip--error" role="alert"><span className="sync-chip__dot" /><div><strong>Couldn't load your collection</strong><small>{room.error}</small></div><button type="button" onClick={room.refresh}>Retry</button></aside>;
  const totals = room.data.totals;
  return (
    <aside className={`sync-chip${focused ? ' sync-chip--focus' : ''}`} aria-live="polite">
      <span className={`sync-chip__dot${room.refreshing ? ' sync-chip__dot--busy' : ''}`} />
      <div><strong>Your collection</strong><small>{totals.ownedCards.toLocaleString()} cards · {totals.binders} binders · {totals.boxes} boxes</small></div>
      <button type="button" onClick={room.refresh} disabled={room.refreshing} aria-label="Reload your collection" title="Reload">↻</button>
      {help}
    </aside>
  );
}

/**
 * PURPOSE: The room page's content.
 * @param {{ userId: string, onHelp: () => void }} props  the signed-in user's id; opens the how-to guide
 */
export default function RoomScene({ userId, onHelp }) {
  const room = useLiveRoom(userId);
  const location = useLocation();
  const routerNavigate = useNavigate();
  const stage = useRef(null);
  const route = useMemo(() => readRoute(location.hash), [location.hash]);
  const [hovered, setHovered] = useState(null);
  const [hoveredBinder, setHoveredBinder] = useState(null);
  const [hoveredBin, setHoveredBin] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [binderPage, setBinderPage] = useState(0);
  const [pick, setPick] = useState(null); // card picker for one binder pocket: { slot, query, cardId, error, busy }
  const [boxUi, setBoxUi] = useState({ drawerId: null, cardId: null }); // which drawer the rolodex shows, and the card chosen in it
  const spread = useSpread(stage);
  const reducedMotion = useReducedMotion();
  const { world, lookup } = room;
  const selectedBinder = useMemo(() => lookup?.binder(route.binderId) ?? null, [lookup, route.binderId]);
  const selectedBinderCard = selectedBinder?.cards.find((card) => String(card.id) === route.binderCardId) ?? null;
  const selectedBox = useMemo(() => lookup?.box(route.boxId) ?? null, [lookup, route.boxId]);
  const selectedDisplayCard = useMemo(() => lookup?.displayCard(route.displayId) ?? null, [lookup, route.displayId]);
  const unplacedItems = (world?.meta.unplaced.binders ?? 0) + (world?.meta.unplaced.boxes ?? 0);
  // Whatever the user opens must be on screen in its shelf unit: page it into view (no-op if it already is, or unplaced).
  const revealItem = room.nav.reveal;
  useEffect(() => {
    if (route.binderId) revealItem('binder', route.binderId);
    if (route.boxId) revealItem('box', route.boxId);
    if (route.displayId) revealItem('display', route.displayId);
  }, [revealItem, route.binderId, route.boxId, route.displayId]);

  // Room views are steps in the browser history, like the rest of the site; `replace` for corrections.
  const navigate = useCallback((nextRoute, replace = false) => {
    routerNavigate({ pathname: location.pathname, search: location.search, hash: routeHash({ ...EMPTY_ROUTE, ...nextRoute }) }, { replace });
  }, [routerNavigate, location.pathname, location.search]);
  // A link to something that no longer exists (deleted binder, emptied slot) falls back to its zone.
  useEffect(() => {
    if (room.status !== 'ready') return;
    if ((route.binderId && !selectedBinder) || (route.boxId && !selectedBox) || (route.displayId && !selectedDisplayCard)) navigate({ focus: route.focus }, true);
  }, [room.status, navigate, route, selectedBinder, selectedBox, selectedDisplayCard]);
  useEffect(() => {
    const el = stage.current;
    if (el) el.style.cursor = hovered || hoveredBinder || hoveredBin || hoveredCard !== null ? 'pointer' : '';
  }, [hovered, hoveredBinder, hoveredBin, hoveredCard]);

  // A string is a binder/box id from the furniture; an object is an item from a list.
  const selectBinder = (value) => { const item = typeof value === 'string' ? lookup?.binder(value) : value; if (item) navigate({ focus: 'binders', binderId: String(item.id) }); };
  const selectBox = (value) => { const item = typeof value === 'string' ? lookup?.box(value) : value; if (item) navigate({ focus: 'storage', boxId: String(item.id) }); };
  const openFromBrowser = (kind, id) => navigate(kind === 'binder' ? { focus: 'binders', binderId: id } : kind === 'box' ? { focus: 'storage', boxId: id } : { focus: 'display', displayId: id });
  const selectDisplay = (value) => { const item = typeof value === 'number' ? world?.displayCards.find((card) => card.displayIndex === value) : value; if (item) navigate({ focus: 'display', displayId: String(item.id) }); };
  const selectZone = (focus) => (focus === 'explore' ? routerNavigate('/explore') : navigate({ focus }));
  // Furniture that leads to another page of the site; the three collection pieces are this room's own zones.
  const onRoute = useCallback((path) => {
    const zone = { '/storage': 'storage', '/binders': 'binders', '/display': 'display' }[path];
    if (zone) navigate({ focus: zone }); else routerNavigate(path);
  }, [navigate, routerNavigate]);
  const closeItem = () => navigate({ focus: route.focus });
  const selected = Boolean(selectedBinder || selectedBox || selectedDisplayCard);
  const goBack = () => route.binderCardId ? navigate({ focus: 'binders', binderId: route.binderId }) : selected ? closeItem() : navigate(EMPTY_ROUTE);

  // Opening a different binder or box starts it fresh: first page, no picker, first drawer.
  useEffect(() => { setBinderPage(0); setPick(null); }, [route.binderId]);
  useEffect(() => { setBoxUi({ drawerId: null, cardId: null }); }, [route.boxId]);
  useEffect(() => { if (!selectedBinder) setPick(null); }, [selectedBinder]);

  const boxDrawer = selectedBox ? (selectedBox.drawers.find((d) => d.id === boxUi.drawerId) ?? selectedBox.drawers[0] ?? null) : null;
  const pickerSearch = usePocketSearch(room.raw, pick ? pick.query : null);
  const pickerCards = pickerSearch.cards;
  const chosenPickerCard = pick ? pickerCards.find((c) => c.id === pick.cardId) ?? null : null;
  const binderPages = selectedBinder ? pageCount(selectedBinder.cards.map((c) => c.slotIndex).filter((n) => n != null), selectedBinder.pocketSize) : 0;
  const rolodexCards = pick ? pickerCards : boxDrawer?.cards ?? [];
  const rolodexSelectedId = pick ? pick.cardId : boxUi.cardId;
  const openPicker = (slot) => setPick({ slot, query: '', cardId: null, error: null, busy: false });
  const placePicked = async () => {
    if (!chosenPickerCard || !selectedBinder) return;
    setPick((p) => ({ ...p, busy: true, error: null }));
    try {
      await room.placeInPocket({ binderId: String(selectedBinder.id), slotIndex: pick.slot, card: chosenPickerCard });
      setPick(null);
    } catch (error) {
      setPick((p) => (p ? { ...p, busy: false, error: error?.response?.data?.message ?? error?.message ?? 'Could not save that pocket.' } : p));
    }
  };
  const freeSlot = (() => { const used = new Set(selectedBinder?.cards.map((c) => c.slotIndex) ?? []); let i = 0; while (used.has(i)) i++; return i; })();

  // Esc steps back one level: focused field → picked card → picker → open card → binder/box → zone → whole room.
  const escape = useRef(null);
  escape.current = () => {
    const field = document.activeElement;
    if (field && ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)) { field.blur(); return true; }
    if (pick) { if (pick.cardId) setPick({ ...pick, cardId: null, error: null }); else setPick(null); return true; }
    if (boxUi.cardId) { setBoxUi((u) => ({ ...u, cardId: null })); return true; }
    if (route.focus) { goBack(); return true; }
    return false;
  };
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented && escape.current()) event.preventDefault(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hint = room.status !== 'ready' ? null
    : pick ? `Swipe through the cards${pick.query.trim().length >= 2 ? '' : ' you own, or search the catalog'}, tap one, then place it in pocket ${pick.slot + 1}.`
    : selectedBox && boxDrawer ? 'Scroll or drag through this box; tap a card to read it.'
    : world.meta.isEmpty && !route.focus ? 'Your room is ready for your first binders, boxes and display cases.'
    : selectedBinder ? 'Flip pages with ← → or the page bar. Tap a card to read it, or an empty pocket to fill it.'
    : selectedDisplayCard ? 'The card you chose from the display cabinet.'
    : route.focus ? `${TAP} a single item on the furniture, or pick it from the list.`
    : `${TAP} the box shelf, bookcase or cabinet — or the desk, pinboard and window for the rest of CardStacks.`;

  return (
    <div className="room3d-stage" ref={stage}>
      <Canvas shadows dpr={CANVAS.dpr} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} camera={{ fov: 37, near: 0.1, far: 50, position: DEFAULT_CAM.pos }}
        onCreated={({ gl, scene, camera }) => { gl.toneMapping = CANVAS.toneMapping; gl.toneMappingExposure = CANVAS.exposure; gl.shadowMap.type = CANVAS.shadowType; if (import.meta.env.DEV) window.__nook3d = { scene, camera, gl, THREE }; }}
        aria-label="3D collection room">
        <color attach="background" args={[CANVAS.background]} />
        <Suspense fallback={null}>
          <ClubhouseRoom activeZone={route.focus} onSelect={selectZone} hovered={hovered} setHovered={setHovered}
            zones={world?.zones} onRoute={onRoute}
            onSelectBinder={selectBinder} hoveredBinder={hoveredBinder} selectedBinder={selectedBinder?.id ?? null} setHoveredBinder={setHoveredBinder}
            onSelectBin={selectBox} hoveredBin={hoveredBin} selectedBin={selectedBox?.id ?? null} setHoveredBin={setHoveredBin}
            displayCards={world?.displayCards ?? []} selectedCard={selectedDisplayCard?.displayIndex ?? null} hoveredCard={hoveredCard} setHoveredCard={setHoveredCard} onSelectCard={selectDisplay} />
          <BinderBook active={Boolean(selectedBinder) && !pick} binder={selectedBinder} page={binderPage} onPage={setBinderPage}
            selectedCardId={selectedBinderCard?.id ?? null} onPickSlot={openPicker}
            onSelectCard={(card) => navigate({ focus: 'binders', binderId: String(selectedBinder.id), binderCardId: card ? String(card.id) : null })} />
          <CardRolodex active={Boolean(pick) || Boolean(boxDrawer)} cards={rolodexCards} selectedCardId={rolodexSelectedId} resetKey={pick ? `pick:${pick.query}` : `${selectedBox?.id}:${boxDrawer?.id}`}
            onSelectCard={(card) => (pick ? setPick((p) => ({ ...p, cardId: card?.id ?? null, error: null })) : setBoxUi((u) => ({ ...u, cardId: card?.id ?? null })))} />
        </Suspense>
        <FixedCameraRig focus={route.focus} reducedMotion={reducedMotion} inspectSeed={selectedDisplayCard?.displayIndex ?? null} />
      </Canvas>
      {hint && <div className={`hud${selectedBinder || pick ? ' hud--quiet' : ''}`}>{hint}{unplacedItems > 0 && !selected && !route.focus && <><br />{unplacedItems === 1 ? '1 binder or box isn’t' : `${unplacedItems} binders or boxes aren’t`} on a shelf yet — find {unplacedItems === 1 ? 'it' : 'them'} under Unplaced in Binders or Card boxes.</>}</div>}
      <RoomStatus room={room} focused={Boolean(route.focus)} onHelp={onHelp} />
      {room.status === 'ready' && !selected && !pick && <button type="button" className={`add-fab${route.focus ? ' add-fab--focus' : ''}${world.meta.isEmpty ? ' add-fab--pulse' : ''}`} onClick={() => routerNavigate('/add')}><span aria-hidden="true">+</span> {world.meta.isEmpty ? 'Add your first cards' : 'Add cards'}</button>}
      {!route.focus && <nav className="zone-nav" aria-label="Room areas"><button type="button" onClick={() => navigate({ focus: 'storage' })}><span>01</span> Card boxes</button><button type="button" onClick={() => navigate({ focus: 'binders' })}><span>02</span> Binders</button><button type="button" onClick={() => navigate({ focus: 'display' })}><span>03</span> Display cabinet</button><button type="button" onClick={() => routerNavigate('/explore')}><span>04</span> Explore</button></nav>}
      {route.focus && <button type="button" className="back-btn" onClick={goBack} title="Esc">← {route.binderCardId ? 'Back to binder' : selected ? `Back to ${ZONES[route.focus].label}` : 'Back to room'}</button>}
      {route.focus && <div className="focus-label">{ZONES[route.focus].label}</div>}
      {route.focus && !selected && world && room.state && <ZoneBrowser zone={route.focus} world={world} state={room.state} nav={room.nav} onOpen={openFromBrowser} />}
      {selectedBinder && !pick && <BinderBar pages={binderPages} page={binderPage} spread={spread} onPage={setBinderPage} onAdd={() => { openPicker(freeSlot); setBinderPage(Math.floor(freeSlot / pocketsPerPage(selectedBinder.pocketSize))); }} empty={selectedBinder.cards.length === 0} />}
      {pick && <PickerBar slot={pick.slot} query={pick.query} onQuery={(query) => setPick((p) => ({ ...p, query, cardId: null, error: null }))} resultCount={pickerCards.length} searching={pickerSearch.searching} chosen={chosenPickerCard} onPlace={placePicked} onCancel={() => setPick(null)} busy={pick.busy} error={pick.error} />}
      {selectedBinder && <ItemPanel type="binder" item={selectedBinder} selectedCard={selectedBinderCard} onClose={closeItem} siteLink={{ to: `/binder/${encodeURIComponent(selectedBinder.id)}`, label: 'Open binder page' }} onLink={routerNavigate} />}
      {selectedBox && <ItemPanel type="storage" item={selectedBox} onClose={closeItem} drawerId={boxDrawer?.id} onDrawer={(id) => setBoxUi({ drawerId: id, cardId: null })} cardId={boxUi.cardId} onCard={(id) => setBoxUi((u) => ({ ...u, cardId: id }))}
        siteLink={{ to: spacesLink({ space: selectedBox.spaceId, area: 'storage', unit: selectedBox.unitId, box: selectedBox.id }), label: 'Manage in Spaces' }} onLink={routerNavigate} />}
      {selectedDisplayCard && <ItemPanel type="display" item={selectedDisplayCard} onClose={closeItem}
        siteLink={{ to: spacesLink({ space: selectedDisplayCard.spaceId, area: 'displays', case: selectedDisplayCard.caseId }), label: 'Manage display case' }} onLink={routerNavigate} />}
    </div>
  );
}
