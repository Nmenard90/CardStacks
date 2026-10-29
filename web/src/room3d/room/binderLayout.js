/**
 * binderLayout.js — pocket-page geometry for the open binder. Pure functions, no three.js.
 *
 * A binder is a book of pages; each page is a grid of pockets (Four 2×2, Nine 3×3, Twelve 4×3).
 * A card's `slotIndex` is its pocket counted across the whole binder, so page = floor(slot / perPage).
 * Pages are shown as spreads (left + right) on wide screens and one at a time on narrow ones.
 */

export const POCKET_GRIDS = { Four: { cols: 2, rows: 2 }, Nine: { cols: 3, rows: 3 }, Twelve: { cols: 4, rows: 3 } };
export const POCKET_W = 0.46;
export const POCKET_H = 0.64; // 63 : 88 card ratio
const GAP = 0.07;
const MARGIN = 0.1;

const gridOf = (pocketSize) => POCKET_GRIDS[pocketSize] ?? POCKET_GRIDS.Nine;

export const pocketsPerPage = (pocketSize) => { const g = gridOf(pocketSize); return g.cols * g.rows; };

/** World size of one page. */
export function pageSize(pocketSize) {
  const { cols, rows } = gridOf(pocketSize);
  return { w: cols * POCKET_W + (cols - 1) * GAP + 2 * MARGIN, h: rows * POCKET_H + (rows - 1) * GAP + 2 * MARGIN };
}

/** Centre of pocket `index` (0 = top-left, row by row) relative to the page centre; y grows upward. */
export function pocketCenter(pocketSize, index) {
  const { cols, rows } = gridOf(pocketSize);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: (col - (cols - 1) / 2) * (POCKET_W + GAP),
    y: ((rows - 1) / 2 - row) * (POCKET_H + GAP),
  };
}

/** Pages to offer: everything holding a card plus one blank page, never fewer than two, always an even count (whole spreads). */
export function pageCount(slotIndexes, pocketSize) {
  const per = pocketsPerPage(pocketSize);
  const last = slotIndexes.length ? Math.max(...slotIndexes) : -1;
  const used = Math.floor(last / per) + 1;
  const withBlank = Math.max(2, used + 1);
  return withBlank % 2 === 0 ? withBlank : withBlank + 1;
}

/** Page numbers visible when the reader is on `page`: a spread starts on an even page, narrow screens show one. */
export function visiblePages(page, total, spread) {
  const first = spread ? page - (page % 2) : page;
  return (spread ? [first, first + 1] : [first]).filter((p) => p >= 0 && p < total);
}

/** Smallest empty pocket index, or `total` pockets in if every pocket is taken. */
export function firstFreeSlot(slotIndexes) {
  const used = new Set(slotIndexes);
  let index = 0;
  while (used.has(index)) index++;
  return index;
}
