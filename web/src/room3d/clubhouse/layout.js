/**
 * layout.js — where everything in the Clubhouse room stands, as data.
 *
 * A layout is a list of pieces: `{ id, type, x, z, rot, y?, props? }`. The renderer builds the room by reading this list,
 * so moving a sofa is a data change, not a code change. This module also knows what is allowed: pieces stay inside the
 * room, solid furniture does not overlap, wall pieces hang on a wall and stay clear of the window, and the collection
 * furniture (binders, boxes, display cabinet) can never be removed. Pure module: no THREE, no DOM.
 *
 * Conventions: metres. The room spans x ∈ [-4.5, 4.5], z ∈ [-3.5, 3.5]; the back wall is z = -3.5 and the left wall x = -4.5.
 * A piece's local +z is its "front". `rot` is the turn about the vertical axis in radians: 0 faces +z (into the room from
 * the back wall), π/2 faces +x (a piece on the left wall). The collection furniture is built by the app facing the other
 * way, so it uses rot π against the back wall. Positions snap to a 5 cm grid, rotations to quarter turns.
 */

export const ROOM = Object.freeze({ w: 9, d: 7, h: 3.8, x0: -4.5, x1: 4.5, z0: -3.5, z1: 3.5 });
export const GRID = 0.05;
const HALF_PI = Math.PI / 2;

/**
 * Piece catalogue. `footprint` is [width, depth] on the floor in local axes plus an optional `front` clearance (e.g. a desk
 * chair) added to the +z side. `mount: 'wall'` pieces hang at height `y` and use `size` = [width, height] on the wall.
 * `flat` pieces (rugs, cushions) lie on the floor and never collide. `backdrop` wall pieces sit behind others.
 * `locked` pieces are the collection furniture: required, and they cannot be removed.
 * `route` is where the piece leads when the room becomes the site's home page.
 */
export const PIECE_TYPES = Object.freeze({
  desk: { label: 'Collector desk', mount: 'floor', footprint: [1.9, 0.7], front: 0.55, route: '/add' },
  drawerCart: { label: 'Drawer cart', mount: 'floor', footprint: [0.5, 0.5] },
  sofa: { label: 'Sofa', mount: 'floor', footprint: [2.2, 0.95] },
  coffeeTable: { label: 'Coffee table', mount: 'floor', footprint: [1.2, 0.7], route: '/analyzer' },
  pouf: { label: 'Pouf', mount: 'floor', footprint: [0.64, 0.64], freeRot: true },
  floorLamp: { label: 'Floor lamp', mount: 'floor', footprint: [0.3, 0.3], freeRot: true },
  plant: { label: 'Plant', mount: 'floor', footprint: [0.5, 0.5], scaleFootprint: true, freeRot: true },
  gameTable: { label: 'Card table', mount: 'floor', footprint: [2.6, 3.0], route: '/convention' },
  dogBed: { label: 'Dog bed', mount: 'floor', footprint: [1.1, 1.1], freeRot: true },
  basket: { label: 'Blanket basket', mount: 'floor', footprint: [0.36, 0.36], freeRot: true },
  rug: { label: 'Rug', mount: 'floor', footprint: [2.6, 3.0], flat: true },
  floorCushions: { label: 'Floor cushions', mount: 'floor', footprint: [0.9, 0.9], flat: true },
  slippers: { label: 'Slippers', mount: 'floor', footprint: [0.4, 0.4], flat: true },
  pinboard: { label: 'Pinboard', mount: 'wall', size: [1.7, 0.98], route: '/shop/requests' },
  wallShelf: { label: 'Wall shelf', mount: 'wall', size: [1.6, 0.3] },
  frame: { label: 'Framed print', mount: 'wall', size: [0.5, 0.66], sizeFromProps: true },
  clock: { label: 'Wall clock', mount: 'wall', size: [0.5, 0.5] },
  slatPanel: { label: 'Oak slat panel', mount: 'wall', size: [3.6, 3.3], backdrop: true },
  storageRack: { label: 'Card box shelf', mount: 'floor', footprint: [2.6, 0.8], locked: true, route: '/storage' },
  binderLibrary: { label: 'Binder bookcase', mount: 'floor', footprint: [3.5, 0.72], locked: true, route: '/binders' },
  displayCabinet: { label: 'Display cabinet', mount: 'floor', footprint: [1.4, 0.46], locked: true, route: '/display' },
});

/** Fixed architecture the layout must work around: the window and its curtains on the left wall. */
export const KEEP_CLEAR = Object.freeze([{ wall: 'left', from: -1.25, to: 1.45, yFrom: 0.9, yTo: 3.3, label: 'window and curtains' }]);

const TOL_FLOOR = 0.1; // soft furnishings may brush against each other by up to 10 cm
const TOL_WALL = 0.15;
const TOL_BOUNDS = 0.05;

const roundTo = (v, step) => Math.round(v / step) * step;
export const snapValue = (v) => Math.round(roundTo(v, GRID) * 1e4) / 1e4;
export const snapRot = (rot) => roundTo(rot, HALF_PI);
const isQuarterTurn = (rot) => Math.abs(rot / HALF_PI - Math.round(rot / HALF_PI)) < 1e-6;

/** Floor footprint of a piece as a world-space box { x0, x1, z0, z1 }, accounting for rotation and any plant scale. */
export function footprintBox(piece) {
  const spec = PIECE_TYPES[piece.type];
  let [w, d] = spec.footprint;
  if (spec.scaleFootprint) { const s = piece.props?.scale ?? 1; w *= s; d *= s; }
  const front = spec.front ?? 0;
  const rot = piece.rot ?? 0; const c = Math.cos(rot); const s = Math.sin(rot);
  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2 + front], [-w / 2, d / 2 + front]].map(([lx, lz]) => [piece.x + lx * c + lz * s, piece.z - lx * s + lz * c]); // rotation about +y
  const xs = corners.map((p) => p[0]); const zs = corners.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

const boxesOverlap = (a, b, tol) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > tol && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > tol;

/** Which wall a wall piece hangs on: 'left' (x ≈ -4.5, faces +x) or 'back' (z ≈ -3.5, faces +z), else null. */
export function wallOf(piece) {
  const rot = piece.rot ?? 0;
  if (Math.abs(piece.x - ROOM.x0) <= 0.3 && Math.abs(rot - HALF_PI) < 1e-3) return 'left';
  if (Math.abs(piece.z - ROOM.z0) <= 0.3 && Math.abs(rot) < 1e-3) return 'back';
  return null;
}

function wallRect(piece) {
  const spec = PIECE_TYPES[piece.type];
  const [w, h] = spec.sizeFromProps ? [piece.props?.w ?? spec.size[0], piece.props?.h ?? spec.size[1]] : spec.size;
  const wall = wallOf(piece); const t = wall === 'left' ? piece.z : piece.x;
  return { wall, a0: t - w / 2, a1: t + w / 2, y0: piece.y - h / 2, y1: piece.y + h / 2 };
}
const rectsOverlap = (p, q, tol) => p.wall === q.wall && Math.min(p.a1, q.a1) - Math.max(p.a0, q.a0) > tol && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > tol;

/** Every problem with a layout, as `{ code, ids, message }`. An empty list means the layout is valid. */
export function validateLayout(layout) {
  const errors = []; const add = (code, ids, message) => errors.push({ code, ids, message });
  const seen = new Set();
  for (const piece of layout) {
    const spec = PIECE_TYPES[piece.type];
    if (!spec) { add('unknown-type', [piece.id], `${piece.id}: unknown piece type "${piece.type}"`); continue; }
    if (seen.has(piece.id)) add('duplicate-id', [piece.id], `Two pieces share the id "${piece.id}"`);
    seen.add(piece.id);
    if (![piece.x, piece.z].every(Number.isFinite)) { add('bad-position', [piece.id], `${piece.id}: position is not a number`); continue; }
    if (spec.mount === 'floor') {
      const box = footprintBox(piece);
      if (box.x0 < ROOM.x0 - TOL_BOUNDS || box.x1 > ROOM.x1 + TOL_BOUNDS || box.z0 < ROOM.z0 - TOL_BOUNDS || box.z1 > ROOM.z1 + TOL_BOUNDS) add('out-of-room', [piece.id], `${spec.label} sticks out of the room`);
      if (!isQuarterTurn(piece.rot ?? 0) && !spec.flat && !spec.freeRot) add('bad-rotation', [piece.id], `${spec.label} must be turned in quarter turns`);
    } else if (!Number.isFinite(piece.y)) add('bad-position', [piece.id], `${spec.label}: needs a height`);
    else if (!wallOf(piece)) add('not-on-wall', [piece.id], `${spec.label} is not against a wall`);
    else if (piece.y < 0.3 || piece.y > ROOM.h - 0.1) add('out-of-room', [piece.id], `${spec.label} is outside the wall`);
  }
  const floor = layout.filter((p) => PIECE_TYPES[p.type]?.mount === 'floor' && !PIECE_TYPES[p.type].flat && Number.isFinite(p.x) && Number.isFinite(p.z));
  for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) {
    if (boxesOverlap(footprintBox(floor[i]), footprintBox(floor[j]), TOL_FLOOR)) add('overlap', [floor[i].id, floor[j].id], `${PIECE_TYPES[floor[i].type].label} overlaps ${PIECE_TYPES[floor[j].type].label}`);
  }
  const wall = layout.filter((p) => PIECE_TYPES[p.type]?.mount === 'wall' && Number.isFinite(p.y) && wallOf(p) && !PIECE_TYPES[p.type].backdrop);
  const rects = wall.map((p) => ({ piece: p, rect: wallRect(p) }));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i].rect, rects[j].rect, 0.03)) add('wall-overlap', [rects[i].piece.id, rects[j].piece.id], `${PIECE_TYPES[rects[i].piece.type].label} overlaps ${PIECE_TYPES[rects[j].piece.type].label}`);
    for (const k of KEEP_CLEAR) {
      const r = rects[i].rect;
      if (r.wall === k.wall && Math.min(r.a1, k.to) - Math.max(r.a0, k.from) > TOL_WALL && Math.min(r.y1, k.yTo) - Math.max(r.y0, k.yFrom) > TOL_WALL) add('blocks-window', [rects[i].piece.id], `${PIECE_TYPES[rects[i].piece.type].label} blocks the ${k.label}`);
    }
  }
  for (const type of Object.keys(PIECE_TYPES).filter((t) => PIECE_TYPES[t].locked)) {
    const count = layout.filter((p) => p.type === type).length;
    if (count !== 1) add('locked-missing', [], `The room needs exactly one ${PIECE_TYPES[type].label} (found ${count})`);
  }
  return errors;
}

/** Move and/or turn one piece. Positions snap to the grid; the result is rejected (layout unchanged) if it would introduce a problem. */
export function movePiece(layout, id, { x, z, rot, y } = {}) {
  const index = layout.findIndex((p) => p.id === id);
  if (index < 0) return { layout, errors: [{ code: 'unknown-id', ids: [id], message: `No piece "${id}"` }] };
  const current = layout[index];
  const next = {
    ...current,
    x: x === undefined ? current.x : snapValue(x),
    z: z === undefined ? current.z : snapValue(z),
    rot: rot === undefined ? current.rot : snapRot(rot),
    ...(y !== undefined || current.y !== undefined ? { y: y === undefined ? current.y : snapValue(y) } : {}),
  };
  const candidate = layout.map((p, i) => (i === index ? next : p));
  const before = new Set(validateLayout(layout).map((e) => `${e.code}:${e.ids.join('|')}`));
  const introduced = validateLayout(candidate).filter((e) => !before.has(`${e.code}:${e.ids.join('|')}`));
  return introduced.length ? { layout, errors: introduced } : { layout: candidate, errors: [] };
}

/** Remove a piece. The collection furniture is locked and cannot be removed. */
export function removePiece(layout, id) {
  const piece = layout.find((p) => p.id === id);
  if (!piece) return { layout, errors: [{ code: 'unknown-id', ids: [id], message: `No piece "${id}"` }] };
  if (PIECE_TYPES[piece.type]?.locked) return { layout, errors: [{ code: 'locked', ids: [id], message: `${PIECE_TYPES[piece.type].label} is part of your collection and can't be removed` }] };
  return { layout: layout.filter((p) => p.id !== id), errors: [] };
}

/** Save format: only plain data, so it is safe to store and share. */
export const serializeLayout = (layout) => JSON.stringify({ v: 1, pieces: layout });

/** Load a layout; anything unknown or malformed is dropped, and an invalid result falls back to the default layout. */
export function parseLayout(json) {
  try {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || data.v !== 1 || !Array.isArray(data.pieces)) return DEFAULT_LAYOUT;
    const pieces = data.pieces.filter((p) => p && typeof p.id === 'string' && PIECE_TYPES[p.type] && Number.isFinite(p.x) && Number.isFinite(p.z))
      .map((p) => ({ id: p.id, type: p.type, x: p.x, z: p.z, rot: Number.isFinite(p.rot) ? p.rot : 0, ...(Number.isFinite(p.y) ? { y: p.y } : {}), ...(p.props && typeof p.props === 'object' ? { props: p.props } : {}) }));
    return validateLayout(pieces).length ? DEFAULT_LAYOUT : pieces;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** The room as designed: collection wall along the back, workbench and window on the left, seating, a card table in the middle. */
export const DEFAULT_LAYOUT = Object.freeze([
  // collection wall (locked)
  { id: 'storage-rack', type: 'storageRack', x: -3.12, z: -3.14, rot: Math.PI },
  { id: 'binder-library', type: 'binderLibrary', x: 0.0, z: -3.17, rot: Math.PI },
  { id: 'display-cabinet', type: 'displayCabinet', x: 2.62, z: -3.27, rot: Math.PI },
  { id: 'slat-panel', type: 'slatPanel', x: 0.0, y: 1.78, z: -3.475, rot: 0, props: { count: 36 } },
  { id: 'clock', type: 'clock', x: 0.0, y: 3.5, z: -3.46, rot: 0 },
  { id: 'back-print-1', type: 'frame', x: -3.7, y: 3.42, z: -3.46, rot: 0, props: { w: 0.5, h: 0.5, art: 'print:4' } },
  { id: 'back-print-2', type: 'frame', x: -2.85, y: 3.42, z: -3.46, rot: 0, props: { w: 0.62, h: 0.5, art: 'print:6' } },
  { id: 'corner-plant', type: 'plant', x: 3.9, z: -3.0, rot: 0, props: { scale: 0.9, seed: 7, pot: 'cream', tall: 1 } },
  // hobby workspace (left wall)
  { id: 'desk', type: 'desk', x: -4.15, z: -1.85, rot: Math.PI / 2 },
  { id: 'pinboard', type: 'pinboard', x: -4.46, y: 2.4, z: -1.95, rot: Math.PI / 2 },
  { id: 'wall-shelf', type: 'wallShelf', x: -4.38, y: 3.3, z: -1.95, rot: Math.PI / 2 },
  { id: 'drawer-cart', type: 'drawerCart', x: -4.2, z: -0.55, rot: Math.PI / 2 },
  { id: 'window-plant', type: 'plant', x: -4.05, z: 0.75, rot: 0, props: { scale: 1, seed: 3, pot: 'coral', tall: 1.1 } },
  // seating (left wall, front)
  { id: 'sofa', type: 'sofa', x: -4.02, z: 2.05, rot: Math.PI / 2 },
  { id: 'coffee-table', type: 'coffeeTable', x: -2.55, z: 2.05, rot: Math.PI / 2 },
  { id: 'rug', type: 'rug', x: -2.45, z: 1.85, rot: 0 },
  { id: 'pouf', type: 'pouf', x: -1.3, z: 3.0, rot: 0 },
  { id: 'floor-cushions', type: 'floorCushions', x: -0.95, z: 0.975, rot: 0 },
  { id: 'floor-lamp', type: 'floorLamp', x: -4.1, z: 3.3, rot: 0 },
  { id: 'basket', type: 'basket', x: -3.45, z: 3.3, rot: 0 },
  { id: 'slippers', type: 'slippers', x: -3.115, z: 1.475, rot: 0 },
  { id: 'dog-bed', type: 'dogBed', x: -3.3, z: 0.35, rot: 0, props: { name: 'GRATON' } },
  { id: 'left-print-1', type: 'frame', x: -4.46, y: 2.3, z: 1.85, rot: Math.PI / 2, props: { w: 0.5, h: 0.66, art: 'print:1' } },
  { id: 'left-print-2', type: 'frame', x: -4.46, y: 2.4, z: 2.6, rot: Math.PI / 2, props: { w: 0.7, h: 0.9, art: 'card:23' } },
  { id: 'left-print-3', type: 'frame', x: -4.46, y: 2.28, z: 3.22, rot: Math.PI / 2, props: { w: 0.44, h: 0.58, art: 'print:8' } },
  // open floor
  { id: 'card-table', type: 'gameTable', x: 1.15, z: 1.9, rot: 0 },
  { id: 'east-plant', type: 'plant', x: 4.0, z: 0.2, rot: 0, props: { scale: 0.85, seed: 5, pot: 'teal', tall: 1 } },
]);
