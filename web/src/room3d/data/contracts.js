/**
 * contracts.js — the data contract between the standalone 3D room and the
 * CardStacks application.
 *
 * Every typedef below mirrors an interface in the main app's
 * `web/src/types/index.ts` (read-only reference; nothing here imports from
 * that repo). The room must never invent a parallel collection model: when
 * the live adapter is built, these shapes are what the real API returns.
 *
 * Shapes that exist ONLY in the prototype are marked "local-only".
 */

/**
 * @typedef {'raw'|'sleeved'|'double_sleeved'|'toploader'|'magnetic_holder'|'graded_slab'} ProtectionType
 * @typedef {'collection_room'|'archive'|'trade_station'|'showcase'|'custom'} SpaceType
 * @typedef {'shelf'|'rack'|'cabinet'|'closet'|'custom'} StorageUnitType
 * @typedef {'wall_case'|'lit_cabinet'|'museum_vitrine'|'floating_shelf'|'pedestal'|'custom'} DisplayCaseType
 * @typedef {'Four'|'Nine'|'Twelve'} PocketSize
 *
 * @typedef {{ small: string, large: string }} CardImage
 * @typedef {{ id: string, setId: string, name: string, number: string, rarity?: string, images: CardImage }} Card
 *
 * @typedef {{ id: string, boxId: string, name: string, position: number, cardCount: number, createdAt: string, updatedAt: string }} StorageDrawer
 * @typedef {{ id: string, userId: string, name: string, kind?: 'box'|'display_case', boxType?: string, capacity?: number, color?: string, position: number, spaceId?: string, storageUnitId?: string, shelfIndex?: number, stackIndex?: number, stackLevel?: number, drawers: StorageDrawer[], createdAt: string, updatedAt: string }} StorageBox
 *
 * @typedef {{ id: string, userId: string, name: string, pocketSize: PocketSize, coverImage?: string, spaceId?: string, storageUnitId?: string, shelfIndex?: number, shelfPosition?: number, slots: BinderSlot[], createdAt: string, updatedAt: string }} Binder
 * @typedef {{ slotIndex: number, cardId?: string, cardName?: string, imageUrl?: string }} BinderSlot
 *
 * @typedef {{ id: string, spaceId: string, name: string, unitType: StorageUnitType, preset: string, color: string, shelfCount: number, positionsPerShelf: number, maxStackHeight: number, position: number, config: string, createdAt: string, updatedAt: string }} StorageUnit
 * @typedef {{ id: string, displayCaseId: string, shelfIndex: number, slotIndex: number, label?: string }} DisplaySlot
 * @typedef {{ id: string, spaceId: string, name: string, caseType: DisplayCaseType, preset: string, frameColor: string, lightColor: string, lightEnabled: boolean, shelfCount: number, slotsPerShelf: number, position: number, config: string, slots: DisplaySlot[], createdAt: string, updatedAt: string }} DisplayCase
 * @typedef {{ id: string, userId: string, name: string, spaceType: SpaceType, isDefault: boolean, position: number, storageUnits: StorageUnit[], displayCases: DisplayCase[], createdAt: string, updatedAt: string }} CollectionSpace
 *
 * @typedef {{ id: string, userId: string, cardId: string, variantKey: string, edition: string, language: string, condition: string, quantity: number, allocated: number, createdAt: string, updatedAt: string }} InventoryLot
 * @typedef {{ id: string, lotId: string, drawerId?: string, binderSlotId?: string, displaySlotId?: string, quantity: number, protection?: ProtectionType, notes?: string, createdAt: string, updatedAt: string }} CardAllocation
 *
 * local-only: the main app creates a binder-slot row lazily (see
 * `placeInBinderSlot` in web/src/api/rooms.ts); the local repository keeps
 * those rows explicitly so allocations can reference `binderSlotId`.
 * @typedef {{ id: string, binderId: string, slotIndex: number }} BinderSlotRow
 *
 * The complete local state. `cards` is a catalog (Card by id) standing in for
 * the card data the main app joins onto owned cards.
 * @typedef {{
 *   schemaVersion: number,
 *   userId: string,
 *   meta: { devFixture: boolean, nextId: number },
 *   spaces: CollectionSpace[], boxes: StorageBox[], binders: Binder[],
 *   binderSlots: BinderSlotRow[], lots: InventoryLot[], allocations: CardAllocation[],
 *   cards: Record<string, Card>,
 *   localMeta: { binderAccent: Record<string, string> },
 * }} RoomState
 */

export const SCHEMA_VERSION = 1;

export const POCKET_SIZES = ['Four', 'Nine', 'Twelve'];
export const PROTECTION_TYPES = ['raw', 'sleeved', 'double_sleeved', 'toploader', 'magnetic_holder', 'graded_slab'];

/** The empty organisational space every new user starts with. */
export const DEFAULT_SPACE = { name: 'My Collection Room', spaceType: 'collection_room' };

/** local-only: binder colours. The real Binder has no colour field yet — see Phase 1 notes. Hexes match the Blender palette. */
export const BINDER_ACCENTS = {
  gold: '#f5b400', cream: '#fff7e8', teal: '#1fb79a', violet: '#8a63d6', coral: '#ff6f61', forest: '#2a9d6f',
};

/** Mirrors BOX_PRESETS in web/src/pages/SpacesLivePage.tsx. */
export const BOX_PRESETS = [
  { name: '800 Count Box', boxType: 'long-800', capacity: 800, color: '#d8d0c0' },
  { name: '1600 Count Box', boxType: 'row-1600', capacity: 1600, color: '#315c73' },
  { name: '3200 Count Box', boxType: 'row-3200', capacity: 3200, color: '#98483e' },
  { name: '5000 Count Box', boxType: 'row-5000', capacity: 5000, color: '#50684c' },
  { name: 'Deck Box', boxType: 'deck-100', capacity: 100, color: '#68527a' },
];

/** Mirrors the shelf presets in SpacesLivePage.tsx. */
export const SHELF_PRESETS = [
  { name: 'Heavy-Duty Rack', unitType: 'rack', preset: 'heavy_duty_rack', color: '#4b4f52', shelfCount: 5, positionsPerShelf: 6, maxStackHeight: 4 },
  { name: 'Wood Collection Shelf', unitType: 'shelf', preset: 'wood_shelf', color: '#8a5a34', shelfCount: 4, positionsPerShelf: 5, maxStackHeight: 3 },
  { name: 'Enclosed Cabinet', unitType: 'cabinet', preset: 'enclosed_cabinet', color: '#2c2f33', shelfCount: 3, positionsPerShelf: 4, maxStackHeight: 3 },
  { name: 'Closet Storage', unitType: 'closet', preset: 'closet_storage', color: '#5c4b3a', shelfCount: 6, positionsPerShelf: 3, maxStackHeight: 5 },
];

/** Mirrors the display-case presets in SpacesLivePage.tsx. */
export const DISPLAY_PRESETS = [
  { name: 'Wall-Mounted Case', caseType: 'wall_case', preset: 'wall_mounted', frameColor: '#1c2024', lightColor: '#fff3d1', shelfCount: 2, slotsPerShelf: 4 },
  { name: 'Lit Standing Cabinet', caseType: 'lit_cabinet', preset: 'collector_led', frameColor: '#17141F', lightColor: '#FFF1B8', shelfCount: 3, slotsPerShelf: 3 },
  { name: 'Museum Vitrine', caseType: 'museum_vitrine', preset: 'museum_vitrine', frameColor: '#111619', lightColor: '#bfe3ff', shelfCount: 2, slotsPerShelf: 3 },
  { name: 'Floating Display Shelf', caseType: 'floating_shelf', preset: 'floating_shelf', frameColor: '#2a2420', lightColor: '#ffe3a5', shelfCount: 1, slotsPerShelf: 5 },
  { name: 'Pedestal Case', caseType: 'pedestal', preset: 'pedestal_case', frameColor: '#151515', lightColor: '#ffffff', shelfCount: 1, slotsPerShelf: 1 },
];

/** Thrown for every rejected mutation; `code` is stable for UI messages and tests. */
export class RoomDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomDataError';
    this.code = code;
  }
}

/**
 * Structural invariants every RoomState must satisfy. Returns a list of
 * problems (empty = healthy). Used by the repository tests and available to
 * dev tooling; it never mutates the state.
 * @param {RoomState} state
 * @returns {string[]}
 */
export function checkInvariants(state) {
  const problems = [];
  const lotsById = new Map(state.lots.map((lot) => [lot.id, lot]));
  const sums = new Map();
  const drawerIds = new Set(state.boxes.flatMap((box) => box.drawers.map((drawer) => drawer.id)));
  const slotIds = new Set(state.binderSlots.map((slot) => slot.id));
  const displaySlotIds = new Set(state.spaces.flatMap((space) => space.displayCases.flatMap((c) => c.slots.map((s) => s.id))));
  const claimedTargets = new Set();

  for (const allocation of state.allocations) {
    const lot = lotsById.get(allocation.lotId);
    if (!lot) { problems.push(`allocation ${allocation.id} references missing lot ${allocation.lotId}`); continue; }
    sums.set(lot.id, (sums.get(lot.id) ?? 0) + allocation.quantity);
    const targets = [
      ['drawer', allocation.drawerId, drawerIds], ['binder-slot', allocation.binderSlotId, slotIds], ['display-slot', allocation.displaySlotId, displaySlotIds],
    ].filter(([, id]) => id);
    if (targets.length !== 1) { problems.push(`allocation ${allocation.id} must have exactly one target`); continue; }
    const [kind, id, known] = targets[0];
    if (!known.has(id)) problems.push(`allocation ${allocation.id} targets missing ${kind} ${id}`);
    if (kind !== 'drawer') {
      if (claimedTargets.has(id)) problems.push(`${kind} ${id} holds more than one allocation`);
      claimedTargets.add(id);
    }
  }
  for (const lot of state.lots) {
    if ((sums.get(lot.id) ?? 0) !== lot.allocated) problems.push(`lot ${lot.id} allocated=${lot.allocated} but allocations sum to ${sums.get(lot.id) ?? 0}`);
    if (lot.allocated > lot.quantity) problems.push(`lot ${lot.id} is over-allocated`);
  }

  const units = new Map(state.spaces.flatMap((space) => space.storageUnits.map((unit) => [unit.id, unit])));
  const spots = new Set();
  for (const binder of state.binders) {
    if (binder.storageUnitId == null) continue;
    const unit = units.get(binder.storageUnitId);
    if (!unit) { problems.push(`binder ${binder.id} sits in missing unit`); continue; }
    if (binder.shelfIndex >= unit.shelfCount || binder.shelfPosition >= unit.positionsPerShelf) problems.push(`binder ${binder.id} is out of its unit's bounds`);
    const key = `binder:${unit.id}:${binder.shelfIndex}:${binder.shelfPosition}`;
    if (spots.has(key)) problems.push(`two binders share ${key}`);
    spots.add(key);
  }
  for (const box of state.boxes) {
    if (box.storageUnitId == null) continue;
    const unit = units.get(box.storageUnitId);
    if (!unit) { problems.push(`box ${box.id} sits in missing unit`); continue; }
    if (box.shelfIndex >= unit.shelfCount || box.stackIndex >= unit.positionsPerShelf || box.stackLevel >= unit.maxStackHeight) problems.push(`box ${box.id} is out of its unit's bounds`);
    const key = `box:${unit.id}:${box.shelfIndex}:${box.stackIndex}:${box.stackLevel}`;
    if (spots.has(key)) problems.push(`two boxes share ${key}`);
    spots.add(key);
  }
  return problems;
}
