/**
 * localRepository.js — in-memory (optionally persisted) implementation of the
 * room's data source, shaped like the main app's API modules
 * (`web/src/api/{binders,storage,rooms}.ts`): same function names, same
 * argument order (userId first), same entity shapes (see contracts.js).
 *
 * Isolation: no network, no auth, no imports from the main app. Persistence
 * goes through an injected `storage` ({ getItem, setItem }), so
 * Node tests and the dev server can use localStorage or a plain object.
 *
 * Mutation model: every write runs on a cloned draft and is committed
 * atomically — a rejected write (RoomDataError) leaves the state, and its
 * object identity, untouched. `getState()` returns an immutable-by-convention
 * snapshot that changes identity on each commit, so React
 * `useSyncExternalStore` and memoised selectors work without extra plumbing.
 *
 * Assumptions to confirm against the Scala routes before the live adapter
 * (none of this is verified backend behaviour):
 *  - createBox attaches one default drawer ("Main").
 *  - A binder pocket or display slot holds exactly one copy.
 *  - Binders and boxes occupy positions independently of each other.
 */
import {
  BINDER_ACCENTS, DEFAULT_SPACE, POCKET_SIZES, PROTECTION_TYPES, RoomDataError, SCHEMA_VERSION,
} from './contracts.js';

const DEFAULT_STORAGE_KEY = 'cardstacks-nook:room:v1';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * A brand-new user's room: one empty default space and nothing else.
 * @param {string} [userId]
 * @param {() => string} [now]
 * @returns {import('./contracts.js').RoomState}
 */
export function createEmptyState(userId = 'local-user', now = () => new Date().toISOString()) {
  const t = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    userId,
    meta: { devFixture: false, nextId: 2 },
    spaces: [{
      id: 'space-1', userId, name: DEFAULT_SPACE.name, spaceType: DEFAULT_SPACE.spaceType,
      isDefault: true, position: 0, storageUnits: [], displayCases: [], createdAt: t, updatedAt: t,
    }],
    boxes: [], binders: [], binderSlots: [], lots: [], allocations: [], cards: {},
    localMeta: { binderAccent: {} },
  };
}

const fail = (code, message) => { throw new RoomDataError(code, message); };
const clone = (value) => structuredClone(value);
const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;
const trimmedName = (name, what) => {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) fail('invalid-name', `A ${what} needs a name.`);
  return value;
};

function loadState(storage, key, userId, now) {
  if (!storage) return createEmptyState(userId, now);
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null');
    const healthy = parsed && parsed.schemaVersion === SCHEMA_VERSION && parsed.userId === userId
      && ['spaces', 'boxes', 'binders', 'binderSlots', 'lots', 'allocations'].every((k) => Array.isArray(parsed[k]))
      && parsed.cards && typeof parsed.cards === 'object' && parsed.localMeta?.binderAccent && parsed.meta;
    return healthy ? parsed : createEmptyState(userId, now);
  } catch {
    return createEmptyState(userId, now);
  }
}

/**
 * @param {{ userId?: string, storage?: { getItem(k:string):string|null, setItem(k:string,v:string):void } | null, storageKey?: string, now?: () => string, initialState?: import('./contracts.js').RoomState }} [options]
 */
export function createLocalRepository({
  userId = 'local-user', storage = null, storageKey = DEFAULT_STORAGE_KEY, now = () => new Date().toISOString(), initialState,
} = {}) {
  let state = initialState ?? loadState(storage, storageKey, userId, now);
  let draft = null; // set while a batch is open
  let persistError = null;
  const listeners = new Set();

  const persist = () => {
    if (!storage) return;
    try { storage.setItem(storageKey, JSON.stringify(state)); persistError = null; } catch (error) { persistError = error; }
  };
  const commit = (next) => { state = next; persist(); listeners.forEach((listener) => listener()); };

  /** Run `fn` on a draft and commit atomically, or join the open batch. */
  const mutate = (fn) => {
    if (draft) return fn(draft);
    const working = clone(state);
    const result = fn(working);
    commit(working);
    return result;
  };

  const touch = (entity) => { entity.updatedAt = now(); return entity; };
  const makeId = (d, kind) => `${kind}-${d.meta.nextId++}`;

  const findSpace = (d, spaceId) => d.spaces.find((s) => s.id === spaceId) ?? fail('not-found', `Space ${spaceId} does not exist.`);
  const findUnit = (d, unitId) => {
    for (const space of d.spaces) { const unit = space.storageUnits.find((u) => u.id === unitId); if (unit) return { space, unit }; }
    return fail('not-found', `Storage unit ${unitId} does not exist.`);
  };
  const findBox = (d, boxId) => d.boxes.find((b) => b.id === boxId) ?? fail('not-found', `Box ${boxId} does not exist.`);
  const findBinder = (d, binderId) => d.binders.find((b) => b.id === binderId) ?? fail('not-found', `Binder ${binderId} does not exist.`);
  const findLot = (d, lotId) => d.lots.find((l) => l.id === lotId) ?? fail('not-found', `Inventory lot ${lotId} does not exist.`);
  const findCase = (d, caseId) => {
    for (const space of d.spaces) { const found = space.displayCases.find((c) => c.id === caseId); if (found) return found; }
    return fail('not-found', `Display case ${caseId} does not exist.`);
  };
  /** Drawer card counts are kept incrementally (the real backend computes them on read; same observable value). */
  const adjustDrawer = (d, drawerId, delta) => {
    for (const box of d.boxes) {
      const drawer = box.drawers.find((x) => x.id === drawerId);
      if (drawer) { drawer.cardCount += delta; return; }
    }
  };
  const releaseAllocation = (d, allocation) => {
    const lot = d.lots.find((l) => l.id === allocation.lotId);
    if (lot) { lot.allocated -= allocation.quantity; touch(lot); }
    if (allocation.drawerId) adjustDrawer(d, allocation.drawerId, -allocation.quantity);
  };
  const dropAllocations = (d, predicate) => {
    const kept = [];
    for (const allocation of d.allocations) (predicate(allocation) ? releaseAllocation(d, allocation) : kept.push(allocation));
    d.allocations = kept;
  };
  const resolveAccent = (accent) => {
    if (accent == null) return null;
    if (accent in BINDER_ACCENTS) return accent;
    if (typeof accent === 'string' && HEX_COLOR.test(accent)) return accent.toLowerCase();
    return fail('invalid-color', 'Binder colour must be a palette name or a #rrggbb hex value.');
  };

  /** Shared by placeCopies and placeInBinderSlot. */
  const allocate = (d, { lotId, drawerId, binderSlotId, displaySlotId, quantity, protection, notes }) => {
    const targets = [drawerId, binderSlotId, displaySlotId].filter(Boolean);
    if (targets.length !== 1) fail('invalid-target', 'Place copies into exactly one drawer, binder slot or display slot.');
    if (!isInt(quantity, 1)) fail('invalid-quantity', 'Quantity must be a whole number of at least 1.');
    if (protection != null && !PROTECTION_TYPES.includes(protection)) fail('invalid-protection', `Unknown protection type ${protection}.`);
    const lot = findLot(d, lotId);
    if (lot.quantity - lot.allocated < quantity) fail('insufficient-copies', `Only ${lot.quantity - lot.allocated} free copies of this card are left.`);
    if (drawerId) {
      if (!d.boxes.some((b) => b.drawers.some((x) => x.id === drawerId))) fail('not-found', `Drawer ${drawerId} does not exist.`);
    } else {
      if (displaySlotId && !d.spaces.some((s) => s.displayCases.some((c) => c.slots.some((x) => x.id === displaySlotId)))) fail('not-found', `Display slot ${displaySlotId} does not exist.`);
      if (quantity !== 1) fail('invalid-quantity', 'A binder pocket or display slot holds exactly one copy.');
      if (d.allocations.some((a) => (binderSlotId ? a.binderSlotId === binderSlotId : a.displaySlotId === displaySlotId))) {
        fail('slot-occupied', 'That slot already holds a card.');
      }
    }
    const t = now();
    const allocation = {
      id: makeId(d, 'alloc'), lotId, quantity, createdAt: t, updatedAt: t,
      ...(drawerId && { drawerId }), ...(binderSlotId && { binderSlotId }), ...(displaySlotId && { displaySlotId }),
      ...(protection && { protection }), ...(notes && { notes }),
    };
    d.allocations.push(allocation);
    lot.allocated += quantity; touch(lot);
    if (drawerId) adjustDrawer(d, drawerId, quantity);
    return allocation;
  };

  const api = {
    // ── store plumbing (local-only) ──
    /** Live state, including an open batch's uncommitted draft. For code running inside `batch`. */
    getState: () => draft ?? state,
    /**
     * Last committed state only. Anything that renders or runs selectors (React's useSyncExternalStore) must
     * use this: a render can happen mid-batch, and selectors cache per state object, so reading the draft would
     * cache an index for an object that is still being mutated.
     */
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Run many writes as one atomic commit with a single notification. Throwing discards them all. */
    async batch(fn) {
      if (draft) return fn(api);
      draft = clone(state);
      try {
        const result = await fn(api);
        const done = draft;
        draft = null;
        commit(done);
        return result;
      } finally { draft = null; }
    },
    getPersistError: () => persistError,
    /** Wipe back to a brand-new empty room; the persisted copy is overwritten with the empty room too. */
    reset() {
      draft = null;
      commit(createEmptyState(userId, now));
    },
    markDevFixture: (value = true) => mutate((d) => { d.meta.devFixture = Boolean(value); }),
    /** Feed the card catalog (stands in for the card data the main app joins onto owned cards). */
    registerCards: (cards) => mutate((d) => { for (const card of cards) d.cards[card.id] = clone(card); }),

    // ── spaces & furniture (web/src/api/rooms.ts) ──
    listSpaces: async () => clone(state.spaces),
    createSpace: async (_userId, name, spaceType = 'custom') => mutate((d) => {
      const t = now();
      const space = { id: makeId(d, 'space'), userId, name: trimmedName(name, 'space'), spaceType, isDefault: false, position: d.spaces.length, storageUnits: [], displayCases: [], createdAt: t, updatedAt: t };
      d.spaces.push(space);
      return clone(space);
    }),
    createStorageUnit: async (_userId, value) => mutate((d) => {
      const space = findSpace(d, value.spaceId);
      if (![value.shelfCount, value.positionsPerShelf, value.maxStackHeight].every((n) => isInt(n, 1))) fail('invalid-size', 'Shelf count, positions per shelf and stack height must be whole numbers of at least 1.');
      const t = now();
      const unit = {
        id: makeId(d, 'unit'), spaceId: space.id, name: trimmedName(value.name, 'storage unit'), unitType: value.unitType, preset: value.preset ?? 'custom',
        color: value.color, shelfCount: value.shelfCount, positionsPerShelf: value.positionsPerShelf, maxStackHeight: value.maxStackHeight,
        position: space.storageUnits.length, config: value.config ?? '{}', createdAt: t, updatedAt: t,
      };
      space.storageUnits.push(unit);
      return clone(unit);
    }),
    createDisplayCase: async (_userId, value) => mutate((d) => {
      const space = findSpace(d, value.spaceId);
      if (![value.shelfCount, value.slotsPerShelf].every((n) => isInt(n, 1))) fail('invalid-size', 'Shelf count and slots per shelf must be whole numbers of at least 1.');
      const t = now();
      const id = makeId(d, 'case');
      const slots = [];
      for (let shelfIndex = 0; shelfIndex < value.shelfCount; shelfIndex++) {
        for (let slotIndex = 0; slotIndex < value.slotsPerShelf; slotIndex++) slots.push({ id: `${id}-slot-${shelfIndex}-${slotIndex}`, displayCaseId: id, shelfIndex, slotIndex });
      }
      const displayCase = {
        id, spaceId: space.id, name: trimmedName(value.name, 'display case'), caseType: value.caseType, preset: value.preset ?? 'custom',
        frameColor: value.frameColor, lightColor: value.lightColor, lightEnabled: true, shelfCount: value.shelfCount, slotsPerShelf: value.slotsPerShelf,
        position: space.displayCases.length, config: value.config ?? '{}', slots, createdAt: t, updatedAt: t,
      };
      space.displayCases.push(displayCase);
      return clone(displayCase);
    }),
    setDisplayLights: async (_userId, caseId, enabled) => mutate((d) => { touch(findCase(d, caseId)).lightEnabled = Boolean(enabled); }),
    placeBox: async (_userId, boxId, { spaceId, unitId, shelfIndex, stackIndex, stackLevel }) => mutate((d) => {
      const box = findBox(d, boxId);
      const { space, unit } = findUnit(d, unitId);
      if (space.id !== spaceId) fail('not-found', `Unit ${unitId} is not in space ${spaceId}.`);
      if (!isInt(shelfIndex) || shelfIndex >= unit.shelfCount || !isInt(stackIndex) || stackIndex >= unit.positionsPerShelf || !isInt(stackLevel) || stackLevel >= unit.maxStackHeight) {
        fail('out-of-bounds', 'That spot is outside the shelf unit.');
      }
      if (d.boxes.some((b) => b.id !== box.id && b.storageUnitId === unit.id && b.shelfIndex === shelfIndex && b.stackIndex === stackIndex && b.stackLevel === stackLevel)) fail('position-occupied', 'Another box already sits there.');
      Object.assign(box, { spaceId, storageUnitId: unit.id, shelfIndex, stackIndex, stackLevel });
      touch(box);
    }),
    placeBinder: async (_userId, binderId, { spaceId, unitId, shelfIndex, shelfPosition }) => mutate((d) => {
      const binder = findBinder(d, binderId);
      const { space, unit } = findUnit(d, unitId);
      if (space.id !== spaceId) fail('not-found', `Unit ${unitId} is not in space ${spaceId}.`);
      if (!isInt(shelfIndex) || shelfIndex >= unit.shelfCount || !isInt(shelfPosition) || shelfPosition >= unit.positionsPerShelf) fail('out-of-bounds', 'That spot is outside the shelf unit.');
      if (d.binders.some((b) => b.id !== binder.id && b.storageUnitId === unit.id && b.shelfIndex === shelfIndex && b.shelfPosition === shelfPosition)) fail('position-occupied', 'Another binder already sits there.');
      Object.assign(binder, { spaceId, storageUnitId: unit.id, shelfIndex, shelfPosition });
      touch(binder);
    }),

    // ── binders (web/src/api/binders.ts) ──
    /** Slot lists come back empty — full slots come from getBinder (same as the real API). */
    listBinders: async () => clone(state.binders),
    /** Never populated with cards: a new binder is empty and unplaced. `options.accent` is local-only. */
    createBinder: async (_userId, name, pocketSize, options = {}) => mutate((d) => {
      if (!POCKET_SIZES.includes(pocketSize)) fail('invalid-pocket-size', `Pocket size must be one of ${POCKET_SIZES.join(', ')}.`);
      const accent = resolveAccent(options.accent);
      const t = now();
      const binder = { id: makeId(d, 'binder'), userId, name: trimmedName(name, 'binder'), pocketSize, slots: [], createdAt: t, updatedAt: t };
      d.binders.push(binder);
      if (accent) d.localMeta.binderAccent[binder.id] = accent;
      return clone(binder);
    }),
    getBinder: async (_userId, binderId) => {
      const binder = clone(findBinder(state, binderId));
      const slotRows = new Map(state.binderSlots.filter((s) => s.binderId === binderId).map((s) => [s.id, s]));
      binder.slots = state.allocations.filter((a) => slotRows.has(a.binderSlotId)).map((a) => {
        const lot = state.lots.find((l) => l.id === a.lotId);
        const card = lot && state.cards[lot.cardId];
        return { slotIndex: slotRows.get(a.binderSlotId).slotIndex, cardId: lot?.cardId, cardName: card?.name, imageUrl: card?.images?.large };
      }).sort((a, b) => a.slotIndex - b.slotIndex);
      return binder;
    },
    updateBinder: async (_userId, binderId, patch) => mutate((d) => {
      const binder = findBinder(d, binderId);
      if (patch.name !== undefined) binder.name = trimmedName(patch.name, 'binder');
      if (patch.pocketSize !== undefined) {
        if (!POCKET_SIZES.includes(patch.pocketSize)) fail('invalid-pocket-size', `Pocket size must be one of ${POCKET_SIZES.join(', ')}.`);
        binder.pocketSize = patch.pocketSize;
      }
      if (patch.coverImage !== undefined) binder.coverImage = patch.coverImage;
      touch(binder);
    }),
    deleteBinder: async (_userId, binderId) => mutate((d) => {
      findBinder(d, binderId);
      const slotIds = new Set(d.binderSlots.filter((s) => s.binderId === binderId).map((s) => s.id));
      dropAllocations(d, (a) => slotIds.has(a.binderSlotId));
      d.binderSlots = d.binderSlots.filter((s) => s.binderId !== binderId);
      d.binders = d.binders.filter((b) => b.id !== binderId);
      delete d.localMeta.binderAccent[binderId];
    }),
    /** local-only: binder colour (palette name or #rrggbb; null clears it). The real Binder has no colour field yet. */
    setBinderAccent: async (binderId, accent) => mutate((d) => {
      touch(findBinder(d, binderId));
      const value = resolveAccent(accent);
      if (value) d.localMeta.binderAccent[binderId] = value; else delete d.localMeta.binderAccent[binderId];
    }),

    // ── boxes & drawers (web/src/api/storage.ts) ──
    listBoxes: async () => clone(state.boxes),
    createBox: async (_userId, name, boxType = 'custom', capacity = 0, color = '#B99B67') => mutate((d) => {
      const t = now();
      const id = makeId(d, 'box');
      const box = {
        id, userId, name: trimmedName(name, 'box'), kind: 'box', boxType, capacity, color, position: d.boxes.length,
        drawers: [{ id: makeId(d, 'drawer'), boxId: id, name: 'Main', position: 0, cardCount: 0, createdAt: t, updatedAt: t }],
        createdAt: t, updatedAt: t,
      };
      d.boxes.push(box);
      return clone(box);
    }),
    updateBox: async (boxId, patch) => mutate((d) => {
      const box = findBox(d, boxId);
      if (patch.name !== undefined) box.name = trimmedName(patch.name, 'box');
      if (patch.position !== undefined) box.position = patch.position;
      touch(box);
    }),
    /** Cascades to its drawers; cards inside become unassigned, not deleted. */
    deleteBox: async (boxId) => mutate((d) => {
      const box = findBox(d, boxId);
      const drawerIds = new Set(box.drawers.map((x) => x.id));
      dropAllocations(d, (a) => drawerIds.has(a.drawerId));
      d.boxes = d.boxes.filter((b) => b.id !== boxId);
    }),
    createDrawer: async (boxId, name) => mutate((d) => {
      const box = findBox(d, boxId);
      const t = now();
      const drawer = { id: makeId(d, 'drawer'), boxId, name: trimmedName(name, 'drawer'), position: box.drawers.length, cardCount: 0, createdAt: t, updatedAt: t };
      box.drawers.push(drawer);
      touch(box);
      return clone(drawer);
    }),
    deleteDrawer: async (drawerId) => mutate((d) => {
      const box = d.boxes.find((b) => b.drawers.some((x) => x.id === drawerId)) ?? fail('not-found', `Drawer ${drawerId} does not exist.`);
      dropAllocations(d, (a) => a.drawerId === drawerId);
      box.drawers = box.drawers.filter((x) => x.id !== drawerId);
      touch(box);
    }),

    // ── inventory & placement (web/src/api/rooms.ts) ──
    getSpaceInventory: async () => clone(state.lots),
    getDrawerPlacements: async (_userId, drawerId) => clone(state.allocations.filter((a) => a.drawerId === drawerId)),
    getCaseAllocations: async (_userId, caseId) => {
      const slotIds = new Set(findCase(state, caseId).slots.map((s) => s.id));
      return clone(state.allocations.filter((a) => slotIds.has(a.displaySlotId)));
    },
    getBinderAllocations: async (_userId, binderId) => {
      findBinder(state, binderId);
      const slotIds = new Set(state.binderSlots.filter((s) => s.binderId === binderId).map((s) => s.id));
      return clone(state.allocations.filter((a) => slotIds.has(a.binderSlotId)));
    },
    placeCopies: async (_userId, value) => mutate((d) => clone(allocate(d, value))),
    placeInBinderSlot: async (_userId, binderId, slotIndex, value) => mutate((d) => {
      findBinder(d, binderId);
      if (!isInt(slotIndex)) fail('invalid-slot', 'Slot index must be a whole number, 0 or higher.');
      let row = d.binderSlots.find((s) => s.binderId === binderId && s.slotIndex === slotIndex);
      if (!row) { row = { id: makeId(d, 'bslot'), binderId, slotIndex }; d.binderSlots.push(row); }
      return clone(allocate(d, { ...value, binderSlotId: row.id }));
    }),
    removePlacement: async (_userId, allocationId) => mutate((d) => {
      const allocation = d.allocations.find((a) => a.id === allocationId) ?? fail('not-found', `Placement ${allocationId} does not exist.`);
      releaseAllocation(d, allocation);
      d.allocations = d.allocations.filter((a) => a.id !== allocationId);
    }),

    // ── owned cards ──
    /** Stands in for saving to the collection (web/src/api/collection.ts, not mirrored yet). Adds copies to the matching inventory lot. */
    addCopies: async (_userId, { cardId, quantity = 1, condition = 'NM', variantKey = 'normal', edition = 'unlimited', language = 'English' }) => mutate((d) => {
      if (!d.cards[cardId]) fail('unknown-card', `Card ${cardId} is not in the card catalog.`);
      if (!isInt(quantity, 1)) fail('invalid-quantity', 'Quantity must be a whole number of at least 1.');
      let lot = d.lots.find((l) => l.cardId === cardId && l.condition === condition && l.variantKey === variantKey && l.edition === edition && l.language === language);
      if (lot) { lot.quantity += quantity; touch(lot); } else {
        const t = now();
        lot = { id: makeId(d, 'lot'), userId, cardId, variantKey, edition, language, condition, quantity, allocated: 0, createdAt: t, updatedAt: t };
        d.lots.push(lot);
      }
      return clone(lot);
    }),
    /** Removes unallocated copies only; allocated copies must be removed from their container first. */
    removeCopies: async (_userId, lotId, quantity = 1) => mutate((d) => {
      const lot = findLot(d, lotId);
      if (!isInt(quantity, 1)) fail('invalid-quantity', 'Quantity must be a whole number of at least 1.');
      if (lot.quantity - lot.allocated < quantity) fail('insufficient-copies', 'Those copies are placed in a container; remove them from it first.');
      lot.quantity -= quantity; touch(lot);
      if (lot.quantity === 0) d.lots = d.lots.filter((l) => l.id !== lotId);
    }),
  };
  return api;
}
