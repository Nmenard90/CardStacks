/**
 * liveState.js — turns what the CardStacks API returns into the RoomState the 3D room reads (see contracts.js).
 *
 * PURPOSE
 *   The room's selectors and world model were written against the API's own shapes (spaces, units, boxes, drawers,
 *   display cases, inventory lots, allocations), so most of the data passes straight through. Two things need work:
 *    - Binder pockets. The binder page stores a binder's cards on the binder itself (`slots`: slotIndex, cardId,
 *      cardName, imageUrl), not as allocations. Each filled pocket becomes a binder-slot row plus a one-copy allocation
 *      on a per-card "pocket lot", so the room treats binder cards like every other placed copy. Pocket lots are marked
 *      `synthetic` and never counted as owned copies: a binder can hold a card the user doesn't own.
 *    - Prices. Each lot gets the market price of its own condition and print, worked out by the caller with the same
 *      helpers the rest of the site uses (lib/conditions.ts), so the room never shows a different number than a tile.
 *
 *   Pure: no network, no React. useLiveRoom.ts fetches; this file only reshapes, so it is unit-tested on plain objects.
 *
 * IMPORTS EXPLAINED
 *   SCHEMA_VERSION — the RoomState version the selectors expect.
 *
 * USED BY: data/useLiveRoom.ts
 * DEPENDS ON: data/contracts.js
 */
import { SCHEMA_VERSION } from './contracts.js';

/**
 * PURPOSE: The set id inside a card id — everything before the last dash ("base1-4" → "base1", "tt3-123-456" → "tt3-123").
 * @param {string} cardId
 * @return {string|null} null when the id has no dash to split on
 */
export const setIdOf = (cardId) => {
  const i = String(cardId).lastIndexOf('-');
  return i > 0 ? String(cardId).slice(0, i) : null;
};

/**
 * PURPOSE: Card ids that binder pockets hold but the catalog passed in does not know yet (cards the user doesn't own),
 *          so the caller can fetch just those sets' catalogs instead of every set.
 * @param {Array<{ slots?: Array<{ cardId?: string }> }>} binders  binders with their slots loaded
 * @param {Record<string, unknown>} known  card id → card already fetched
 * @return {string[]} distinct unknown card ids
 */
export function unknownPocketCards(binders, known) {
  const ids = new Set();
  for (const binder of binders) for (const slot of binder.slots ?? []) if (slot.cardId && !known[slot.cardId]) ids.add(slot.cardId);
  return [...ids];
}

/**
 * PURPOSE: Builds the room's RoomState from one read of the user's collection.
 * @param {{
 *   userId: string,
 *   spaces: any[], boxes: any[], binders: any[], lots: any[], allocations: any[],
 *   cards: Array<{ id: string, setId: string, name: string, number: string, rarity?: string, artist?: string, images: { small: string, large: string } }>,
 *   ownedCopies: number,
 *   priceOf: (card: any, lot: { condition: string, edition: string, variantKey: string }) => { price: number|null, printLabel: string|null },
 * }} input
 *   binders  each with its `slots` (from GET /api/binders/:userId/:binderId)
 *   allocations  every drawer and display-case placement
 *   cards  owned cards plus any card a binder pocket holds
 *   ownedCopies  total copies the user owns (the collection's own count; pocket lots are not owned copies)
 *   priceOf  market price for one copy of `card` in a lot's condition/print; null price = no quote
 * @return {import('./contracts.js').RoomState}
 */
export function buildLiveState({ userId, spaces, boxes, binders, lots, allocations, cards, ownedCopies, priceOf }) {
  const catalog = Object.fromEntries(cards.map((card) => [card.id, card]));
  // Pocket cards the catalog still lacks keep what the binder stored (name + small art), so they are never blank.
  for (const binder of binders) {
    for (const slot of binder.slots ?? []) {
      if (!slot.cardId || catalog[slot.cardId]) continue;
      catalog[slot.cardId] = { id: slot.cardId, setId: setIdOf(slot.cardId) ?? '', name: slot.cardName || slot.cardId, number: '', images: { small: slot.imageUrl ?? '', large: slot.imageUrl ?? '' } };
    }
  }

  const priced = (lot) => {
    const card = catalog[lot.cardId];
    const quote = card ? priceOf(card, lot) : null;
    return { ...lot, unitPrice: quote?.price ?? null, printLabel: quote?.printLabel ?? null };
  };
  const allLots = lots.map(priced);

  const binderSlots = [];
  const pocketAllocations = [];
  const pocketLots = new Map(); // card id → the synthetic lot every pocket holding that card draws from
  for (const binder of binders) {
    for (const slot of binder.slots ?? []) {
      if (!slot.cardId) continue;
      const rowId = `${binder.id}:${slot.slotIndex}`;
      binderSlots.push({ id: rowId, binderId: binder.id, slotIndex: slot.slotIndex });
      let lot = pocketLots.get(slot.cardId);
      if (!lot) {
        // No condition: a pocket only records which card is in it, so the room shows none rather than guessing "NM".
        lot = priced({ id: `pocket-lot:${slot.cardId}`, userId, cardId: slot.cardId, variantKey: '', edition: '', language: '', condition: '', quantity: 0, allocated: 0, createdAt: binder.createdAt, updatedAt: binder.updatedAt, synthetic: true });
        pocketLots.set(slot.cardId, lot);
        allLots.push(lot);
      }
      lot.quantity += 1; lot.allocated += 1;
      pocketAllocations.push({ id: `pocket:${rowId}`, lotId: lot.id, binderSlotId: rowId, quantity: 1, createdAt: binder.createdAt, updatedAt: binder.updatedAt });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    userId,
    meta: { devFixture: false, nextId: 1, live: true, ownedCopies },
    spaces,
    boxes,
    binders: binders.map(({ slots: _slots, ...binder }) => binder), // the slot lists became binderSlots + allocations above
    binderSlots,
    lots: allLots,
    // Drawer/case placements only: the API's own binder-slot allocations mirror `slots`, which pockets already cover.
    allocations: [...allocations.filter((a) => !a.binderSlotId), ...pocketAllocations],
    cards: catalog,
    localMeta: { binderAccent: {} },
  };
}
