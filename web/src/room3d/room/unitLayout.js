/**
 * unitLayout.js — pure geometry for one shelf unit, driven by CardStacks'
 * StorageUnit numbers (shelfCount × positionsPerShelf × maxStackHeight).
 *
 * The baked furniture was a fixed 4 × 10 binder library and a fixed 2/2/2/1
 * bin wall. This module generalises exactly those dimensions (taken from
 * assets/build_nook_furniture.py and the GLB node positions): at the default
 * window sizes the frames come out the same size as the originals, and any
 * larger unit is shown through a PAGED WINDOW so a frame never outgrows the
 * room and the number of rendered objects stays bounded however big the
 * collection is. Every cell of every unit belongs to exactly one window.
 *
 * Coordinates are unit-local, in metres, Y up, and the FRONT of the unit faces
 * -Z (the same convention as the GLBs). Shelf row 0 is the lowest shelf.
 */

/** Binder library (3.5 m wide for 10 binders; planks 0.78 m apart). */
export const BINDER_STYLE = Object.freeze({
  kind: 'binders', pitch: 0.31, marginX: 0.4, depth: 0.68, firstLevel: 0.07, spacing: 0.78, maxPositions: 10, maxShelves: 4, topPad: 0.08,
});

/** Storage wall (bins 1.14 m apart; a stacked box rises 0.62 m; 0.12 m clearance under each plank). */
const ORIGINAL_BOX_STYLE = {
  kind: 'boxes', pitch: 1.14, marginX: 0.27, depth: 0.76, firstLevel: 0.07, stackPitch: 0.62, clearance: 0.12, maxPositions: 2, maxHeight: 3.3, topPad: 0.04,
};
/** The Clubhouse draws each container as one row of five long card boxes (clubhouse/collection.js), so cells are narrower and levels stack close together. */
const CLUBHOUSE_BOX_STYLE = { ...ORIGINAL_BOX_STYLE, pitch: 0.78, stackPitch: 0.19, clearance: 0.16, maxPositions: 3 };
// Read from the URL here (not clubhouse/config.js, which needs a browser window) so this module stays testable in Node.
const clubhouse = typeof location !== 'undefined' && new URLSearchParams(location.search).get('room') === 'clubhouse';
export const BOX_STYLE = Object.freeze(clubhouse ? CLUBHOUSE_BOX_STYLE : ORIGINAL_BOX_STYLE);

/** The three binder heights/widths the original library cycled through, measured from the GLB bounding boxes. */
export const BINDER_VARIANTS = Object.freeze([
  { height: 0.52, width: 0.234 }, { height: 0.55, width: 0.246 }, { height: 0.58, width: 0.26 },
]);

/** What a zone draws when the collection has no unit yet: the original furniture, empty. */
export const DEFAULT_UNITS = Object.freeze({
  binders: Object.freeze({ shelfCount: 4, positionsPerShelf: 10, maxStackHeight: 1 }),
  boxes: Object.freeze({ shelfCount: 4, positionsPerShelf: 2, maxStackHeight: 1 }),
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const plankTop = 0.05; // planks are 0.1 m thick, centred on their level

/** Window size limits for a unit in a given zone style. */
export function windowSizes(unit, style) {
  const stack = style.kind === 'boxes' ? Math.max(1, unit.maxStackHeight) : 1;
  const spacing = style.kind === 'boxes' ? style.stackPitch * stack + style.clearance : style.spacing;
  const maxShelves = style.kind === 'boxes'
    ? clamp(Math.floor((style.maxHeight - style.firstLevel - 0.1) / spacing), 1, 4)
    : style.maxShelves;
  return {
    stack, spacing, maxShelves, maxPositions: style.maxPositions,
    shelfPages: Math.max(1, Math.ceil(unit.shelfCount / maxShelves)),
    positionPages: Math.max(1, Math.ceil(unit.positionsPerShelf / style.maxPositions)),
  };
}

/**
 * The visible window of a unit plus the frame that holds it.
 * @param {{shelfCount:number,positionsPerShelf:number,maxStackHeight:number}|null} unit  null → the default empty furniture
 * @param {typeof BINDER_STYLE | typeof BOX_STYLE} style
 * @param {{shelfPage?:number, positionPage?:number}} [win]
 */
export function planWindow(unit, style, win = {}) {
  const u = unit ?? DEFAULT_UNITS[style.kind];
  const sizes = windowSizes(u, style);
  const shelfPage = clamp(win.shelfPage ?? 0, 0, sizes.shelfPages - 1);
  const positionPage = clamp(win.positionPage ?? 0, 0, sizes.positionPages - 1);
  const shelfStart = shelfPage * sizes.maxShelves;
  const positionStart = positionPage * sizes.maxPositions;
  const rows = Math.min(sizes.maxShelves, u.shelfCount - shelfStart);
  const cols = Math.min(sizes.maxPositions, u.positionsPerShelf - positionStart);
  const levels = Array.from({ length: rows + 1 }, (_, i) => style.firstLevel + sizes.spacing * i);
  return {
    kind: style.kind, style, ...sizes, shelfPage, positionPage, shelfStart, positionStart, rows, cols,
    shelfCount: u.shelfCount, positionsPerShelf: u.positionsPerShelf,
    frame: { width: cols * style.pitch + style.marginX, height: levels[rows] + style.topPad, depth: style.depth, levels },
  };
}

/** Window-relative row/column of an absolute shelf/position, or null when it is outside this window. */
export function locate(plan, shelfIndex, position) {
  const row = shelfIndex - plan.shelfStart;
  const col = position - plan.positionStart;
  return row >= 0 && row < plan.rows && col >= 0 && col < plan.cols ? { row, col } : null;
}

/** Which window page holds a given absolute cell. */
export function pageFor(unit, style, shelfIndex, position) {
  const sizes = windowSizes(unit, style);
  return { shelfPage: Math.floor(shelfIndex / sizes.maxShelves), positionPage: Math.floor(position / style.maxPositions) };
}

const columnX = (plan, col) => (col - (plan.cols - 1) / 2) * plan.style.pitch;

/** The original library cycled heights by (position + shelf) % 3. */
export const binderVariant = (shelfIndex, position) => (shelfIndex + position) % BINDER_VARIANTS.length;

/** Unit-local centre of a binder body of the given variant. */
export function binderPlacement(plan, row, col, variant) {
  const { height, width } = BINDER_VARIANTS[variant];
  return { x: columnX(plan, col), y: plan.frame.levels[row] + plankTop + height / 2, z: -0.04, height, width };
}

/** Unit-local centre of a box body at a stack level (0 = on the plank). */
export function boxPlacement(plan, row, col, level) {
  return { x: columnX(plan, col), y: plan.frame.levels[row] + plankTop + 0.29 + level * plan.style.stackPitch, z: -0.03 };
}
