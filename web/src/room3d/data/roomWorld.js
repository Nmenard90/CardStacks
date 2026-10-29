/**
 * roomWorld.js — the dynamic room model. Where roomAdapter.js squeezes a
 * collection into the baked 4 × 10 / 2-2-2-1 furniture, this describes what to
 * draw when furniture is generated from CardStacks' own units:
 *
 *  - one FOCUSED storage unit per zone (binders, boxes) at full detail, shown
 *    through a paged window (see room/unitLayout.js), so rendering cost is
 *    bounded no matter how many containers exist;
 *  - one focused display case, shown five slots at a time on the cabinet;
 *  - a navigator describing EVERY unit and case, and lookups that resolve ANY
 *    binder, box or displayed card (placed or not) — so nothing in the
 *    collection is ever unreachable because of what the 3D view can fit;
 *  - `revealNav`, which pages the right unit/window/slot into view for any item.
 *
 * Pure: reads a RoomState through selectors.js and returns plain data.
 */
import {
  selectBinderView, selectBoxView, selectDisplayCaseView, selectIsEmpty, selectRoomOverview, selectUnitView, selectUnplaced,
} from './selectors.js';
import { toPanelCard } from './roomAdapter.js';
import { BINDER_STYLE, BOX_STYLE, binderVariant, locate, pageFor, planWindow } from '../room/unitLayout.js';

/** The cabinet has five card positions, so a display case is shown five slots per page. */
export const DISPLAY_PAGE_SIZE = 5;

const EMPTY_WIN = Object.freeze({ shelfPage: 0, positionPage: 0 });
export const DEFAULT_NAV = Object.freeze({ binderUnitId: null, binderWin: EMPTY_WIN, boxUnitId: null, boxWin: EMPTY_WIN, caseId: null, casePage: 0 });

const allUnits = (state) => state.spaces.flatMap((space) => space.storageUnits);
const chooseUnit = (units, explicitId, hasItems) => units.find((u) => u.id === explicitId) ?? units.find(hasItems) ?? units[0] ?? null;
const unitSummary = (unit) => unit && ({
  id: unit.id, name: unit.name, unitType: unit.unitType, color: unit.color,
  shelfCount: unit.shelfCount, positionsPerShelf: unit.positionsPerShelf, maxStackHeight: unit.maxStackHeight,
});

function buildShelfZone(state, style, unit, win) {
  const plan = planWindow(unit, style, win);
  const items = [];
  let inUnit = 0;
  if (unit) {
    for (const shelf of selectUnitView(state, unit.id).shelves) {
      for (const cell of shelf.positions) {
        if (style.kind === 'binders') {
          const binder = cell.binder;
          if (!binder) continue;
          inUnit++;
          const at = locate(plan, cell.shelfIndex, cell.position);
          if (at) items.push({ kind: 'binder', id: binder.id, name: binder.name, color: binder.color, cardCount: binder.cardCount, shelfIndex: cell.shelfIndex, position: cell.position, ...at, variant: binderVariant(cell.shelfIndex, cell.position) });
        } else {
          cell.boxes.forEach((box, level) => {
            if (!box) return;
            inUnit++;
            const at = locate(plan, cell.shelfIndex, cell.position);
            if (at) items.push({ kind: 'box', id: box.id, name: box.name, color: box.color ?? '#d76555', cardCount: box.cardCount, fill: box.fill, shelfIndex: cell.shelfIndex, position: cell.position, level, ...at });
          });
        }
      }
    }
  }
  return { unit: unitSummary(unit), plan, items, inUnit };
}

function panelBinder(state, binderId, setNames) {
  const view = selectBinderView(state, binderId);
  if (!view) return null;
  const cards = view.cards.map((card) => toPanelCard(card, card.allocationId, setNames));
  return {
    id: view.id, meshId: null, userId: state.userId, name: view.name, pocketSize: view.pocketSize, shelfIndex: view.shelfIndex, shelfPosition: view.shelfPosition,
    cards, slots: cards, cardCount: view.cardCount, capacity: null, accent: view.color, unitId: view.unitId, placed: view.unitId != null, updatedAt: view.updatedAt,
  };
}

function panelBox(state, boxId, setNames) {
  const view = selectBoxView(state, boxId);
  if (!view) return null;
  const drawers = view.drawers.map((drawer) => ({
    id: drawer.id, boxId: view.id, name: drawer.name, position: drawer.position, cardCount: drawer.cardCount,
    cards: drawer.cards.map((card) => toPanelCard(card, card.allocationId, setNames)),
  }));
  return {
    id: view.id, meshId: null, userId: state.userId, name: view.name, kind: 'box', boxType: view.boxType, capacity: view.capacity, color: view.color,
    shelfIndex: view.shelfIndex, stackIndex: view.stackIndex, drawers, cardCount: view.cardCount, unitId: view.unitId, spaceId: view.spaceId ?? null, placed: view.unitId != null, updatedAt: view.updatedAt,
  };
}

const orderedSlots = (caseView) => caseView.slots.slice().sort((a, b) => a.shelfIndex - b.shelfIndex || a.slotIndex - b.slotIndex);

function panelDisplayCard(state, slotId, setNames) {
  for (const space of state.spaces) {
    for (const displayCase of space.displayCases) {
      if (!displayCase.slots.some((s) => s.id === slotId)) continue;
      const slots = orderedSlots(selectDisplayCaseView(state, displayCase.id));
      const index = slots.findIndex((s) => s.slotId === slotId);
      if (!slots[index].card) return null;
      return { ...toPanelCard(slots[index].card, slotId, setNames), displayIndex: index % DISPLAY_PAGE_SIZE, displaySlotId: slotId, sourceCardId: slots[index].card.cardId, quantity: 1, caseId: displayCase.id, spaceId: space.id };
    }
  }
  return null;
}

/**
 * Resolvers for ANY binder / box / displayed card by id, placed or not. Depends only on the
 * collection (not on which shelf is showing), so callers can memoise it on `state` and the
 * panel objects (and the Rolodex textures built from them) stay stable while paging.
 */
export function createLookup(state, setNames = {}) {
  return {
    binder: (id) => (id ? panelBinder(state, id, setNames) : null),
    box: (id) => (id ? panelBox(state, id, setNames) : null),
    displayCard: (slotId) => (slotId ? panelDisplayCard(state, slotId, setNames) : null),
  };
}

/**
 * @param {import('./contracts.js').RoomState} state
 * @param {{ nav?: typeof DEFAULT_NAV, setNames?: Record<string,string> }} [options]
 */
export function toWorldModel(state, { nav = DEFAULT_NAV, setNames = {} } = {}) {
  const overview = selectRoomOverview(state);
  const units = allUnits(state);
  const unitInfo = overview.spaces.flatMap((space) => space.units);
  const cases = overview.spaces.flatMap((space) => space.displayCases);

  const binderUnit = chooseUnit(units, nav.binderUnitId, (u) => state.binders.some((b) => b.storageUnitId === u.id));
  const boxUnit = chooseUnit(units, nav.boxUnitId, (u) => state.boxes.some((b) => b.storageUnitId === u.id));
  const binders = buildShelfZone(state, BINDER_STYLE, binderUnit, nav.binderWin);
  const boxes = buildShelfZone(state, BOX_STYLE, boxUnit, nav.boxWin);

  const displayCase = cases.find((c) => c.id === nav.caseId) ?? cases.find((c) => c.filledCount > 0) ?? cases[0] ?? null;
  const display = { case: displayCase, page: 0, pageCount: 1, slots: [] };
  const displayCards = [];
  if (displayCase) {
    const slots = orderedSlots(selectDisplayCaseView(state, displayCase.id));
    display.pageCount = Math.max(1, Math.ceil(slots.length / DISPLAY_PAGE_SIZE));
    display.page = Math.min(Math.max(0, nav.casePage ?? 0), display.pageCount - 1);
    slots.slice(display.page * DISPLAY_PAGE_SIZE, (display.page + 1) * DISPLAY_PAGE_SIZE).forEach((slot, displayIndex) => {
      display.slots.push({ slotId: slot.slotId, displayIndex, filled: Boolean(slot.card) });
      if (slot.card) displayCards.push({ ...toPanelCard(slot.card, slot.slotId, setNames), displayIndex, displaySlotId: slot.slotId, sourceCardId: slot.card.cardId, quantity: 1, caseId: displayCase.id });
    });
  }

  const unplaced = selectUnplaced(state);
  return {
    profile: { id: state.userId, username: state.meta.devFixture ? 'Dev fixture · test data' : 'Local collection' },
    totals: {
      binders: state.binders.length, boxes: state.boxes.length, displayCards: state.allocations.filter((a) => a.displaySlotId).length,
      // The collection's own count when the API gave one; pocket lots (liveState.js) are cards in binders, not owned copies.
      ownedCards: state.meta.ownedCopies ?? state.lots.reduce((n, lot) => n + (lot.synthetic ? 0 : lot.quantity), 0),
    },
    meta: { isEmpty: selectIsEmpty(state), devFixture: state.meta.devFixture, unplaced: { binders: unplaced.binders.length, boxes: unplaced.boxes.length } },
    zones: { binders, boxes, display },
    displayCards,
    navigator: { units: unitInfo, cases, binderUnitId: binderUnit?.id ?? null, boxUnitId: boxUnit?.id ?? null, caseId: displayCase?.id ?? null, unplaced },
    lookup: createLookup(state, setNames),
  };
}

/**
 * The navigation state that puts an item on screen. Returns the SAME `nav`
 * object when the item is already visible (or has no shelf position), so it is
 * safe to call on every selection.
 * @param {'binder'|'box'|'display'} kind
 */
export function revealNav(state, nav, kind, id) {
  const unitOf = (unitId) => allUnits(state).find((u) => u.id === unitId);
  if (kind === 'binder') {
    const binder = state.binders.find((b) => b.id === id);
    const unit = binder?.storageUnitId && unitOf(binder.storageUnitId);
    if (!unit) return nav;
    const win = pageFor(unit, BINDER_STYLE, binder.shelfIndex, binder.shelfPosition);
    const current = chooseUnit(allUnits(state), nav.binderUnitId, (u) => state.binders.some((b) => b.storageUnitId === u.id));
    if (current?.id === unit.id && nav.binderWin.shelfPage === win.shelfPage && nav.binderWin.positionPage === win.positionPage) return nav;
    return { ...nav, binderUnitId: unit.id, binderWin: win };
  }
  if (kind === 'box') {
    const box = state.boxes.find((b) => b.id === id);
    const unit = box?.storageUnitId && unitOf(box.storageUnitId);
    if (!unit) return nav;
    const win = pageFor(unit, BOX_STYLE, box.shelfIndex, box.stackIndex);
    const current = chooseUnit(allUnits(state), nav.boxUnitId, (u) => state.boxes.some((b) => b.storageUnitId === u.id));
    if (current?.id === unit.id && nav.boxWin.shelfPage === win.shelfPage && nav.boxWin.positionPage === win.positionPage) return nav;
    return { ...nav, boxUnitId: unit.id, boxWin: win };
  }
  if (kind === 'display') {
    for (const space of state.spaces) {
      for (const displayCase of space.displayCases) {
        if (!displayCase.slots.some((s) => s.id === id)) continue;
        const index = orderedSlots(selectDisplayCaseView(state, displayCase.id)).findIndex((s) => s.slotId === id);
        const casePage = Math.floor(index / DISPLAY_PAGE_SIZE);
        const world = toWorldModel(state, { nav });
        return world.navigator.caseId === displayCase.id && world.zones.display.page === casePage ? nav : { ...nav, caseId: displayCase.id, casePage };
      }
    }
  }
  return nav;
}
