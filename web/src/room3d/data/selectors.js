/**
 * selectors.js — pure read-only view models over a RoomState.
 *
 * The 3D scene, panels and search UI read ONLY through these functions, never
 * raw repository arrays, so the room cannot drift from the CardStacks
 * organisation (space → shelf unit → binders/boxes, display cases, inventory
 * lots + allocations). Each selector is safe on the empty state.
 *
 * Performance: a lookup index is built once per RoomState object (WeakMap).
 * The repository replaces the state object on every commit, so the index can
 * never go stale — call selectors on committed snapshots, not on a batch
 * draft that is still being mutated.
 */
import { BINDER_ACCENTS } from './contracts.js';

const indexes = new WeakMap();

/** @param {import('./contracts.js').RoomState} state */
function indexOf(state) {
  let index = indexes.get(state);
  if (index) return index;
  const lotsById = new Map(state.lots.map((lot) => [lot.id, lot]));
  const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  const slotRowsByBinder = new Map();
  for (const row of state.binderSlots) push(slotRowsByBinder, row.binderId, row);
  const allocByDrawer = new Map();
  const allocByBinderSlot = new Map();
  const allocByDisplaySlot = new Map();
  for (const allocation of state.allocations) {
    if (allocation.drawerId) push(allocByDrawer, allocation.drawerId, allocation);
    else if (allocation.binderSlotId) push(allocByBinderSlot, allocation.binderSlotId, allocation);
    else if (allocation.displaySlotId) push(allocByDisplaySlot, allocation.displaySlotId, allocation);
  }
  const bindersByUnit = new Map();
  for (const binder of state.binders) if (binder.storageUnitId) push(bindersByUnit, binder.storageUnitId, binder);
  const boxesByUnit = new Map();
  for (const box of state.boxes) if (box.storageUnitId) push(boxesByUnit, box.storageUnitId, box);
  index = { lotsById, slotRowsByBinder, allocByDrawer, allocByBinderSlot, allocByDisplaySlot, bindersByUnit, boxesByUnit };
  indexes.set(state, index);
  return index;
}

/** FNV-1a — stable, dependency-free, enough to spread default binder colours. */
const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Local colour if the user picked one, otherwise a deterministic palette colour from the binder's id. */
export function binderColor(state, binderId) {
  const chosen = state.localMeta.binderAccent[binderId];
  if (chosen) return { colorKey: chosen in BINDER_ACCENTS ? chosen : null, color: BINDER_ACCENTS[chosen] ?? chosen, colorChosen: true };
  const keys = Object.keys(BINDER_ACCENTS);
  const colorKey = keys[hash(binderId) % keys.length];
  return { colorKey, color: BINDER_ACCENTS[colorKey], colorChosen: false };
}

/** Real card name and artwork when the catalog knows the card; a readable fallback when it does not. */
export function cardView(state, cardId) {
  const card = state.cards[cardId];
  return {
    cardId, known: Boolean(card), name: card?.name ?? cardId, number: card?.number ?? null, setId: card?.setId ?? null,
    rarity: card?.rarity ?? null, artist: card?.artist ?? null, imageSmall: card?.images?.small ?? null, imageLarge: card?.images?.large ?? null,
  };
}

function allocationView(state, index, allocation) {
  const lot = index.lotsById.get(allocation.lotId);
  return {
    allocationId: allocation.id, lotId: allocation.lotId, quantity: allocation.quantity, protection: allocation.protection ?? null, notes: allocation.notes ?? null,
    condition: lot?.condition ?? null, variantKey: lot?.variantKey ?? null, edition: lot?.edition ?? null, language: lot?.language ?? null,
    unitPrice: lot?.unitPrice ?? null, printLabel: lot?.printLabel ?? null, // set by liveState.js from the site's price math
    ...cardView(state, lot?.cardId ?? 'unknown'),
  };
}

const sumQuantity = (allocations = []) => allocations.reduce((n, a) => n + a.quantity, 0);

function binderCardCount(index, binderId) {
  return (index.slotRowsByBinder.get(binderId) ?? []).reduce((n, row) => n + (index.allocByBinderSlot.get(row.id)?.length ?? 0), 0);
}
function boxCardCount(index, box) {
  return box.drawers.reduce((n, drawer) => n + sumQuantity(index.allocByDrawer.get(drawer.id)), 0);
}

function binderSummary(state, index, binder) {
  return {
    kind: 'binder', id: binder.id, name: binder.name, pocketSize: binder.pocketSize, ...binderColor(state, binder.id),
    cardCount: binderCardCount(index, binder.id), spaceId: binder.spaceId ?? null, unitId: binder.storageUnitId ?? null,
    shelfIndex: binder.shelfIndex ?? null, shelfPosition: binder.shelfPosition ?? null, updatedAt: binder.updatedAt,
  };
}
function boxSummary(state, index, box) {
  const cardCount = boxCardCount(index, box);
  return {
    kind: 'box', id: box.id, name: box.name, boxType: box.boxType ?? 'custom', color: box.color ?? null, capacity: box.capacity ?? 0,
    cardCount, fill: box.capacity ? Math.min(1, cardCount / box.capacity) : 0, drawerCount: box.drawers.length,
    spaceId: box.spaceId ?? null, unitId: box.storageUnitId ?? null, shelfIndex: box.shelfIndex ?? null, stackIndex: box.stackIndex ?? null,
    stackLevel: box.stackLevel ?? null, updatedAt: box.updatedAt,
  };
}

/** True for a brand-new user: no containers, no furniture, no inventory. */
export function selectIsEmpty(state) {
  return state.binders.length === 0 && state.boxes.length === 0 && state.lots.length === 0
    && state.spaces.every((s) => s.storageUnits.length === 0 && s.displayCases.length === 0);
}

/** Containers with no shelf position yet — shown in the separate "unplaced" area. */
export function selectUnplaced(state) {
  const index = indexOf(state);
  return {
    binders: state.binders.filter((b) => !b.storageUnitId).map((b) => binderSummary(state, index, b)),
    boxes: state.boxes.filter((b) => !b.storageUnitId).map((b) => boxSummary(state, index, b)),
  };
}

/**
 * The multi-furniture room overview: every shelf unit and display case, with
 * enough summary data to draw them all in one environment while only one is
 * rendered at full detail. Individual containers are NOT listed — only counts.
 */
export function selectRoomOverview(state) {
  const index = indexOf(state);
  const unplaced = selectUnplaced(state);
  return {
    isEmpty: selectIsEmpty(state),
    devFixture: state.meta.devFixture,
    unplaced: { binders: unplaced.binders.length, boxes: unplaced.boxes.length },
    spaces: state.spaces.map((space) => ({
      id: space.id, name: space.name, spaceType: space.spaceType, isDefault: space.isDefault,
      units: space.storageUnits.map((unit) => {
        const binderCount = index.bindersByUnit.get(unit.id)?.length ?? 0;
        const boxCount = index.boxesByUnit.get(unit.id)?.length ?? 0;
        const binderSpots = unit.shelfCount * unit.positionsPerShelf;
        const boxSpots = binderSpots * unit.maxStackHeight;
        return {
          id: unit.id, name: unit.name, unitType: unit.unitType, preset: unit.preset, color: unit.color,
          shelfCount: unit.shelfCount, positionsPerShelf: unit.positionsPerShelf, maxStackHeight: unit.maxStackHeight,
          binderCount, boxCount, binderSpots, boxSpots, freeBinderSpots: binderSpots - binderCount, freeBoxSpots: boxSpots - boxCount,
        };
      }),
      displayCases: space.displayCases.map((c) => ({
        id: c.id, name: c.name, caseType: c.caseType, preset: c.preset, frameColor: c.frameColor, lightColor: c.lightColor, lightEnabled: c.lightEnabled,
        slotCount: c.slots.length, filledCount: c.slots.filter((slot) => index.allocByDisplaySlot.has(slot.id)).length,
      })),
    })),
  };
}

/**
 * One shelf unit at full detail: a shelves × positions grid. Each position holds
 * a binder summary or null, and a stack of box summaries (array index = stack level).
 */
export function selectUnitView(state, unitId) {
  const index = indexOf(state);
  const unit = state.spaces.flatMap((space) => space.storageUnits).find((u) => u.id === unitId);
  if (!unit) return null;
  const binders = index.bindersByUnit.get(unitId) ?? [];
  const boxes = index.boxesByUnit.get(unitId) ?? [];
  const binderAt = new Map(binders.map((b) => [`${b.shelfIndex}:${b.shelfPosition}`, b]));
  const stackAt = new Map();
  for (const box of boxes) {
    const key = `${box.shelfIndex}:${box.stackIndex}`;
    if (!stackAt.has(key)) stackAt.set(key, []);
    stackAt.get(key)[box.stackLevel] = box;
  }
  const shelves = Array.from({ length: unit.shelfCount }, (_, shelfIndex) => ({
    shelfIndex,
    positions: Array.from({ length: unit.positionsPerShelf }, (__, position) => {
      const binder = binderAt.get(`${shelfIndex}:${position}`);
      const stack = stackAt.get(`${shelfIndex}:${position}`) ?? [];
      return {
        shelfIndex, position,
        binder: binder ? binderSummary(state, index, binder) : null,
        boxes: Array.from(stack, (box) => (box ? boxSummary(state, index, box) : null)),
      };
    }),
  }));
  return { unit: { ...unit }, shelves, binderCount: binders.length, boxCount: boxes.length };
}

/** Everything a binder's Rolodex needs: real cards in pocket order. Empty binders return `cards: []`. */
export function selectBinderView(state, binderId) {
  const index = indexOf(state);
  const binder = state.binders.find((b) => b.id === binderId);
  if (!binder) return null;
  const cards = [];
  for (const row of index.slotRowsByBinder.get(binderId) ?? []) {
    for (const allocation of index.allocByBinderSlot.get(row.id) ?? []) cards.push({ slotIndex: row.slotIndex, binderSlotId: row.id, ...allocationView(state, index, allocation) });
  }
  cards.sort((a, b) => a.slotIndex - b.slotIndex);
  return { ...binderSummary(state, index, binder), cards, isEmpty: cards.length === 0 };
}

/** A box with each drawer's real cards. Empty drawers and boxes return empty lists, never placeholders. */
export function selectBoxView(state, boxId) {
  const index = indexOf(state);
  const box = state.boxes.find((b) => b.id === boxId);
  if (!box) return null;
  const drawers = box.drawers.map((drawer) => {
    const cards = (index.allocByDrawer.get(drawer.id) ?? []).map((a) => allocationView(state, index, a));
    return { id: drawer.id, name: drawer.name, position: drawer.position, cards, cardCount: sumQuantity(index.allocByDrawer.get(drawer.id)), isEmpty: cards.length === 0 };
  });
  return { ...boxSummary(state, index, box), drawers };
}

/** A display case: every slot, occupied or not. Empty slots have `card: null` so empty furniture still renders. */
export function selectDisplayCaseView(state, caseId) {
  const index = indexOf(state);
  const displayCase = state.spaces.flatMap((space) => space.displayCases).find((c) => c.id === caseId);
  if (!displayCase) return null;
  const slots = displayCase.slots.map((slot) => {
    const allocation = index.allocByDisplaySlot.get(slot.id)?.[0];
    return { slotId: slot.id, shelfIndex: slot.shelfIndex, slotIndex: slot.slotIndex, label: slot.label ?? null, card: allocation ? allocationView(state, index, allocation) : null };
  });
  const { slots: _raw, ...rest } = displayCase;
  return { ...rest, slots, filledCount: slots.filter((s) => s.card).length, isEmpty: slots.every((s) => !s.card) };
}

/** Owned copies still free to place (quantity − allocated), joined with real card data — the card picker's source. */
export function selectFreeCopies(state) {
  return state.lots
    .filter((lot) => lot.quantity - lot.allocated > 0)
    .map((lot) => ({
      lotId: lot.id, free: lot.quantity - lot.allocated, quantity: lot.quantity, allocated: lot.allocated,
      condition: lot.condition, variantKey: lot.variantKey, edition: lot.edition, language: lot.language, ...cardView(state, lot.cardId),
    }));
}

/**
 * Searchable index over the COMPLETE collection (not just the rendered unit).
 * @param {import('./contracts.js').RoomState} state
 * @param {{ query?: string, kind?: 'binder'|'box'|'case', placement?: 'placed'|'unplaced', unitId?: string, empty?: boolean, sort?: 'name'|'updated'|'cards' }} [options]
 */
export function searchContainers(state, { query = '', kind, placement, unitId, empty, sort = 'name' } = {}) {
  const index = indexOf(state);
  const rows = [];
  for (const binder of state.binders) rows.push(binderSummary(state, index, binder));
  for (const box of state.boxes) rows.push(boxSummary(state, index, box));
  for (const space of state.spaces) {
    for (const c of space.displayCases) {
      const cardCount = c.slots.filter((s) => index.allocByDisplaySlot.has(s.id)).length;
      rows.push({ kind: 'case', id: c.id, name: c.name, color: c.frameColor, cardCount, spaceId: space.id, unitId: null, updatedAt: c.updatedAt });
    }
  }
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => (!kind || row.kind === kind)
    && (!needle || row.name.toLowerCase().includes(needle))
    && (!placement || (placement === 'placed') === (row.kind === 'case' || Boolean(row.unitId)))
    && (!unitId || row.unitId === unitId)
    && (empty === undefined || (row.cardCount === 0) === empty));
  const compare = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    cards: (a, b) => b.cardCount - a.cardCount,
  }[sort] ?? (() => 0);
  return filtered.sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}

/** @template T @param {T[]} items @param {number} [page] @param {number} [pageSize] */
export function paginate(items, page = 0, pageSize = 24) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  return { items: items.slice(safePage * pageSize, (safePage + 1) * pageSize), page: safePage, pageCount, total: items.length };
}

/** First empty binder position in a unit (row by row), or null when the unit is full. */
export function findFreeBinderSpot(state, unitId) {
  const unit = state.spaces.flatMap((s) => s.storageUnits).find((u) => u.id === unitId);
  if (!unit) return null;
  const taken = new Set((indexOf(state).bindersByUnit.get(unitId) ?? []).map((b) => `${b.shelfIndex}:${b.shelfPosition}`));
  for (let shelfIndex = 0; shelfIndex < unit.shelfCount; shelfIndex++) {
    for (let shelfPosition = 0; shelfPosition < unit.positionsPerShelf; shelfPosition++) {
      if (!taken.has(`${shelfIndex}:${shelfPosition}`)) return { spaceId: unit.spaceId, unitId, shelfIndex, shelfPosition };
    }
  }
  return null;
}

/** First box spot in a unit, filling each stack before moving to the next position; null when the unit is full. */
export function findFreeBoxSpot(state, unitId) {
  const unit = state.spaces.flatMap((s) => s.storageUnits).find((u) => u.id === unitId);
  if (!unit) return null;
  const taken = new Set((indexOf(state).boxesByUnit.get(unitId) ?? []).map((b) => `${b.shelfIndex}:${b.stackIndex}:${b.stackLevel}`));
  for (let shelfIndex = 0; shelfIndex < unit.shelfCount; shelfIndex++) {
    for (let stackIndex = 0; stackIndex < unit.positionsPerShelf; stackIndex++) {
      for (let stackLevel = 0; stackLevel < unit.maxStackHeight; stackLevel++) {
        if (!taken.has(`${shelfIndex}:${stackIndex}:${stackLevel}`)) return { spaceId: unit.spaceId, unitId, shelfIndex, stackIndex, stackLevel };
      }
    }
  }
  return null;
}
