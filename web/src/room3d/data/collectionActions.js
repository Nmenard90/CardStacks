/**
 * collectionActions.js — the "add to my collection" operations behind the room's Add panel.
 *
 * Each action composes the repository's primitives (same calls the real API
 * modules will get) and puts things where a collector expects them: a new
 * binder lands on the first free binder-shelf spot, a new box on the first free
 * rack spot, creating a shelf unit only when none has room. Actions are plain
 * async functions over a repository, so they are testable without React.
 *
 * Failures throw RoomDataError (see contracts.js) with a message safe to show.
 */
import { BOX_PRESETS, DISPLAY_PRESETS, RoomDataError, SHELF_PRESETS } from './contracts.js';
import { REAL_CARD_ROWS } from './realCards.js';
import { realCardCatalog } from './fixtures.js';

const BINDER_SHELF = SHELF_PRESETS.find((p) => p.preset === 'wood_shelf');
const BOX_RACK = SHELF_PRESETS.find((p) => p.preset === 'heavy_duty_rack');

const fail = (code, message) => { throw new RoomDataError(code, message); };
const defaultSpace = (repo) => repo.getState().spaces.find((s) => s.isDefault) ?? repo.getState().spaces[0];

/*
 * Free-spot scans read the live state directly. selectors.js caches its index per state object, which is
 * only safe on committed snapshots — inside a batch the draft is mutated in place and the cache would go stale.
 */
function unitById(state, unitId) {
  return state.spaces.flatMap((sp) => sp.storageUnits).find((u) => u.id === unitId) ?? null;
}

function findFreeBinderSpot(state, unitId) {
  const unit = unitById(state, unitId);
  const taken = new Set(state.binders.filter((b) => b.storageUnitId === unitId).map((b) => `${b.shelfIndex}:${b.shelfPosition}`));
  for (let shelfIndex = 0; unit && shelfIndex < unit.shelfCount; shelfIndex++) {
    for (let shelfPosition = 0; shelfPosition < unit.positionsPerShelf; shelfPosition++) {
      if (!taken.has(`${shelfIndex}:${shelfPosition}`)) return { spaceId: unit.spaceId, unitId, shelfIndex, shelfPosition };
    }
  }
  return null;
}

function findFreeBoxSpot(state, unitId) {
  const unit = unitById(state, unitId);
  const taken = new Set(state.boxes.filter((b) => b.storageUnitId === unitId).map((b) => `${b.shelfIndex}:${b.stackIndex}:${b.stackLevel}`));
  for (let shelfIndex = 0; unit && shelfIndex < unit.shelfCount; shelfIndex++) {
    for (let stackIndex = 0; stackIndex < unit.positionsPerShelf; stackIndex++) {
      for (let stackLevel = 0; stackLevel < unit.maxStackHeight; stackLevel++) {
        if (!taken.has(`${shelfIndex}:${stackIndex}:${stackLevel}`)) return { spaceId: unit.spaceId, unitId, shelfIndex, stackIndex, stackLevel };
      }
    }
  }
  return null;
}

/** Find a unit of `preset` with a free spot, or build a new one. Returns the spot. */
async function ensureSpot(repo, preset, findSpot) {
  const userId = repo.getState().userId;
  const space = defaultSpace(repo);
  for (const unit of space.storageUnits.filter((u) => u.preset === preset.preset)) {
    const spot = findSpot(repo.getState(), unit.id);
    if (spot) return spot;
  }
  const count = space.storageUnits.filter((u) => u.preset === preset.preset).length;
  const unit = await repo.createStorageUnit(userId, { spaceId: space.id, ...preset, name: `${preset.name} ${count + 1}` });
  return findSpot(repo.getState(), unit.id);
}

/** @returns the new binder, already standing on a shelf. */
export async function addBinder(repo, { name, pocketSize = 'Nine', accent }) {
  const userId = repo.getState().userId;
  return repo.batch(async (r) => {
    const binder = await r.createBinder(userId, name, pocketSize, { accent });
    await r.placeBinder(userId, binder.id, await ensureSpot(r, BINDER_SHELF, findFreeBinderSpot));
    return binder;
  });
}

/** @param {number} presetIndex index into BOX_PRESETS @returns the new box, already racked. */
export async function addBox(repo, { name, presetIndex = 0 }) {
  const preset = BOX_PRESETS[presetIndex] ?? fail('invalid-preset', 'Choose a box size.');
  const userId = repo.getState().userId;
  return repo.batch(async (r) => {
    const box = await r.createBox(userId, name, preset.boxType, preset.capacity, preset.color);
    await r.placeBox(userId, box.id, await ensureSpot(r, BOX_RACK, findFreeBoxSpot));
    return box;
  });
}

/** @param {number} presetIndex index into DISPLAY_PRESETS */
export async function addDisplayCase(repo, { name, presetIndex = 1 }) {
  const preset = DISPLAY_PRESETS[presetIndex] ?? fail('invalid-preset', 'Choose a display case.');
  return repo.createDisplayCase(repo.getState().userId, { spaceId: defaultSpace(repo).id, ...preset, name });
}

/** Smallest binder slot index with no card in it. */
function firstFreeBinderSlot(state, binderId) {
  const slotIds = new Map(state.binderSlots.filter((s) => s.binderId === binderId).map((s) => [s.id, s.slotIndex]));
  const used = new Set(state.allocations.filter((a) => slotIds.has(a.binderSlotId)).map((a) => slotIds.get(a.binderSlotId)));
  let index = 0;
  while (used.has(index)) index++;
  return index;
}

/** The first empty slot of the first display case that has one, or null. */
function firstFreeDisplaySlot(state) {
  const taken = new Set(state.allocations.map((a) => a.displaySlotId).filter(Boolean));
  for (const space of state.spaces) for (const c of space.displayCases) for (const slot of c.slots) if (!taken.has(slot.id)) return slot.id;
  return null;
}

/**
 * Add copies of a catalog card to the collection and put them somewhere.
 * @param {{ cardId: string, quantity?: number, condition?: string, to: { binderId?: string, boxId?: string, display?: true } }} options
 *   `to` picks the destination: a binder (one card per pocket, so `quantity` pockets), a box (its first drawer), or the display case.
 */
export async function addCards(repo, { cardId, quantity = 1, condition = 'NM', to }) {
  const userId = repo.getState().userId;
  const missing = repo.getState().cards[cardId] ? null : realCardCatalog().find((c) => c.id === cardId);
  if (!repo.getState().cards[cardId] && !missing) fail('unknown-card', 'That card is not in the catalog.');
  return repo.batch(async (r) => {
    if (missing) r.registerCards([missing]);
    const lot = await r.addCopies(userId, { cardId, quantity, condition });
    if (to?.binderId) {
      for (let i = 0; i < quantity; i++) {
        await r.placeInBinderSlot(userId, to.binderId, firstFreeBinderSlot(r.getState(), to.binderId), { lotId: lot.id, quantity: 1, protection: 'sleeved' });
      }
    } else if (to?.boxId) {
      const box = r.getState().boxes.find((b) => b.id === to.boxId) ?? fail('not-found', 'That box no longer exists.');
      await r.placeCopies(userId, { lotId: lot.id, drawerId: box.drawers[0].id, quantity, protection: 'raw' });
    } else if (to?.display) {
      for (let i = 0; i < quantity; i++) {
        const slotId = firstFreeDisplaySlot(r.getState()) ?? fail('display-full', 'Every display slot is taken — add another display case.');
        await r.placeCopies(userId, { lotId: lot.id, displaySlotId: slotId, quantity: 1, protection: 'magnetic_holder' });
      }
    }
    return lot;
  });
}

/**
 * Add one copy of a catalog card and put it in a specific binder pocket.
 * A taken pocket is rejected before anything is written, so no stray copy is left in the inventory.
 */
export async function addCardToBinderSlot(repo, { cardId, binderId, slotIndex, condition = 'NM' }) {
  const userId = repo.getState().userId;
  const missing = repo.getState().cards[cardId] ? null : realCardCatalog().find((c) => c.id === cardId);
  if (!repo.getState().cards[cardId] && !missing) fail('unknown-card', 'That card is not in the catalog.');
  return repo.batch(async (r) => {
    if (missing) r.registerCards([missing]);
    const lot = await r.addCopies(userId, { cardId, quantity: 1, condition });
    return r.placeInBinderSlot(userId, binderId, slotIndex, { lotId: lot.id, quantity: 1, protection: 'sleeved' });
  });
}

/** Search the bundled card catalog by name, id, or "#number"; capped so the list stays fast. */
export function searchCatalog(query, limit = 40) {
  const q = query.trim().toLowerCase();
  const rows = q ? REAL_CARD_ROWS.filter(([id, name, number]) => name.toLowerCase().includes(q) || id.toLowerCase().includes(q) || `#${number}` === q) : REAL_CARD_ROWS;
  return rows.slice(0, limit).map(([id, name, number, rarity, setId]) => ({
    id, cardId: id, name, number, rarity, setId,
    imageSmall: `https://images.pokemontcg.io/${setId}/${number}.png`, imageUrl: `https://images.pokemontcg.io/${setId}/${number}_hires.png`,
  }));
}

/**
 * A small starter collection so a first-time visitor can see a lived-in room:
 * three binders, two boxes and a display case, all holding real cards.
 * Only loads into an empty room.
 */
export async function loadStarterCollection(repo) {
  const s = repo.getState();
  if (s.binders.length || s.boxes.length || s.lots.length) fail('not-empty', 'The starter collection only loads into an empty room.');
  const catalog = realCardCatalog();
  const jungle = catalog.filter((c) => c.setId === 'base2');
  const mew = catalog.filter((c) => c.setId === 'sv3pt5');
  return repo.batch(async (r) => {
  r.registerCards(catalog);

  const binders = [
    await addBinder(r, { name: 'Jungle Holos', pocketSize: 'Nine', accent: 'forest' }),
    await addBinder(r, { name: '151 Favourites', pocketSize: 'Twelve', accent: 'coral' }),
    await addBinder(r, { name: 'Trade Binder', pocketSize: 'Nine', accent: 'gold' }),
  ];
  const boxes = [
    await addBox(r, { name: 'Bulk Commons', presetIndex: 2 }),
    await addBox(r, { name: 'Deck Box', presetIndex: 4 }),
  ];
  await addDisplayCase(r, { name: 'Showcase', presetIndex: 1 });

  for (const card of jungle.slice(0, 9)) await addCards(r, { cardId: card.id, to: { binderId: binders[0].id } });
  for (const card of mew.slice(0, 14)) await addCards(r, { cardId: card.id, to: { binderId: binders[1].id } });
  for (const card of jungle.slice(20, 24)) await addCards(r, { cardId: card.id, to: { binderId: binders[2].id } });
  for (const card of mew.slice(20, 50)) await addCards(r, { cardId: card.id, quantity: 2, to: { boxId: boxes[0].id } });
  for (const card of jungle.slice(30, 40)) await addCards(r, { cardId: card.id, to: { boxId: boxes[1].id } });
  for (const card of [jungle[0], mew[5], mew[10]]) await addCards(r, { cardId: card.id, to: { display: true } });
  return { binders: binders.length, boxes: boxes.length };
  });
}
