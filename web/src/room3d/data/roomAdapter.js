/**
 * roomAdapter.js — turns a Phase 1 RoomState into the room model the existing
 * 3D scene and panels already consume (binders/boxes addressed by baked-in
 * mesh id "row_index", a short list of display cards, totals).
 *
 * This is the ONLY place that knows about the baked furniture's fixed layout.
 * The scene and panels never read repository arrays; when dynamic furniture
 * replaces the baked meshes, only this adapter's layout step changes.
 *
 * Baked layout (see assets/build_nook_furniture.py):
 *  - binder library: 4 shelves × 10 positions  → mesh `Binder_<shelf>_<position>`
 *  - storage wall:   4 shelves of 2,2,2,1 bins → mesh `Bin_<shelf>_<index>` (one box high)
 *  - display cabinet: 5 card positions
 * One shelf unit (binders), one unit (boxes) and one display case are shown at
 * a time; items outside the baked grid are counted in `notShown`, never dropped.
 */
import {
  selectBinderView, selectBoxView, selectDisplayCaseView, selectIsEmpty, selectUnitView, selectUnplaced,
} from './selectors.js';

export const BAKED_BINDER_SHELVES = 4;
export const BAKED_BINDER_POSITIONS = 10;
export const BAKED_BIN_ROW_SIZES = [2, 2, 2, 1];
export const BAKED_DISPLAY_SLOTS = 5;

/** Stable small integer from a card id — the scene uses it to pick a foil palette. */
const seedOf = (text) => { let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0; return h % 997; };

/** Selector card view → the card shape the panels and Rolodex textures expect. */
export function toPanelCard(view, id, setNames) {
  const price = view.unitPrice ?? null; // market price for this copy's condition and print, worked out by liveState.js; null = no price
  const quantity = view.quantity ?? 1;
  return {
    id, cardId: view.cardId, name: view.name, cardName: view.name, setName: setNames[view.setId] ?? view.setId ?? '',
    number: view.number ?? '', rarity: view.rarity ?? '', condition: view.condition ?? '', selectedCond: view.condition ?? '',
    quantity: view.quantity ?? 1, protection: view.protection ?? 'raw', language: view.language ?? 'English', edition: view.edition ?? '',
    variantKey: view.variantKey ?? '', seed: seedOf(view.cardId),
    artist: view.artist ?? '', price, printLabel: view.printLabel ?? null,
    value: price != null ? Math.round(price * quantity * 100) / 100 : null, notes: view.notes ?? '',
    imageUrl: view.imageLarge ?? undefined, lotId: view.lotId, allocationId: view.allocationId,
    slotIndex: view.slotIndex, // binder pocket (undefined for box and display cards)
  };
}

/** Explicit choice if it exists, else the first unit that satisfies `wanted`, else the first unit, else null. */
function pickUnit(units, explicitId, wanted) {
  return units.find((u) => u.id === explicitId) ?? units.find(wanted) ?? units[0] ?? null;
}

/**
 * @param {import('./contracts.js').RoomState} state
 * @param {{ setNames?: Record<string,string>, focus?: { binderUnitId?: string, boxUnitId?: string, caseId?: string } }} [options]
 */
export function toRoomModel(state, { setNames = {}, focus = {} } = {}) {
  const units = state.spaces.flatMap((space) => space.storageUnits);
  const cases = state.spaces.flatMap((space) => space.displayCases);
  const binderUnit = pickUnit(units, focus.binderUnitId, (u) => state.binders.some((b) => b.storageUnitId === u.id));
  const boxUnit = pickUnit(units, focus.boxUnitId, (u) => state.boxes.some((b) => b.storageUnitId === u.id));
  const displayCase = cases.find((c) => c.id === focus.caseId) ?? cases[0] ?? null;
  const notShown = { binders: 0, boxes: 0, displayCards: 0 };

  const binders = [];
  if (binderUnit) {
    const unitView = selectUnitView(state, binderUnit.id);
    for (const shelf of unitView.shelves) {
      for (const cell of shelf.positions) {
        if (!cell.binder) continue;
        if (cell.shelfIndex >= BAKED_BINDER_SHELVES || cell.position >= BAKED_BINDER_POSITIONS) { notShown.binders++; continue; }
        const view = selectBinderView(state, cell.binder.id);
        const cards = view.cards.map((card) => toPanelCard(card, card.allocationId, setNames));
        binders.push({
          id: view.id, meshId: `${cell.shelfIndex}_${cell.position}`, userId: state.userId, name: view.name, pocketSize: view.pocketSize,
          shelfIndex: cell.shelfIndex, shelfPosition: cell.position, cards, slots: cards, cardCount: view.cardCount,
          capacity: null, accent: view.color, unitId: binderUnit.id, updatedAt: view.updatedAt,
        });
      }
    }
  }
  // Binders sitting in other units are real and counted, just not on this shelf.
  notShown.binders += state.binders.filter((b) => b.storageUnitId && b.storageUnitId !== binderUnit?.id).length;

  const storageBoxes = [];
  if (boxUnit) {
    const unitView = selectUnitView(state, boxUnit.id);
    for (const shelf of unitView.shelves) {
      for (const cell of shelf.positions) {
        cell.boxes.forEach((summary, level) => {
          if (!summary) return;
          const bakedRow = BAKED_BIN_ROW_SIZES[cell.shelfIndex];
          if (level !== 0 || bakedRow === undefined || cell.position >= bakedRow) { notShown.boxes++; return; }
          const view = selectBoxView(state, summary.id);
          const drawers = view.drawers.map((drawer) => ({
            id: drawer.id, boxId: view.id, name: drawer.name, position: drawer.position, cardCount: drawer.cardCount,
            cards: drawer.cards.map((card) => toPanelCard(card, card.allocationId, setNames)),
          }));
          storageBoxes.push({
            id: view.id, meshId: `${cell.shelfIndex}_${cell.position}`, userId: state.userId, name: view.name, kind: 'box', boxType: view.boxType,
            capacity: view.capacity, color: view.color, shelfIndex: cell.shelfIndex, stackIndex: cell.position, drawers, cardCount: view.cardCount, updatedAt: view.updatedAt,
          });
        });
      }
    }
  }
  notShown.boxes += state.boxes.filter((b) => b.storageUnitId && b.storageUnitId !== boxUnit?.id).length;

  const displayCards = [];
  if (displayCase) {
    const caseView = selectDisplayCaseView(state, displayCase.id);
    const ordered = caseView.slots.slice().sort((a, b) => a.shelfIndex - b.shelfIndex || a.slotIndex - b.slotIndex);
    ordered.forEach((slot, displayIndex) => {
      if (!slot.card) return;
      if (displayIndex >= BAKED_DISPLAY_SLOTS) { notShown.displayCards++; return; }
      displayCards.push({
        ...toPanelCard(slot.card, slot.slotId, setNames), displayIndex, displaySlotId: slot.slotId, sourceCardId: slot.card.cardId, quantity: 1,
      });
    });
  }
  const unplaced = selectUnplaced(state);

  return {
    profile: { id: state.userId, username: state.meta.devFixture ? 'Dev fixture · test data' : 'Local collection' },
    binders, storageBoxes, displayCards,
    totals: {
      binders: state.binders.length, boxes: state.boxes.length, displayCards: state.allocations.filter((a) => a.displaySlotId).length,
      ownedCards: state.lots.reduce((n, lot) => n + lot.quantity, 0),
    },
    meta: {
      isEmpty: selectIsEmpty(state), devFixture: state.meta.devFixture, notShown,
      unplaced: { binders: unplaced.binders.length, boxes: unplaced.boxes.length },
      focus: { binderUnitId: binderUnit?.id ?? null, boxUnitId: boxUnit?.id ?? null, caseId: displayCase?.id ?? null },
    },
  };
}
