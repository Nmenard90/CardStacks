/**
 * fixtures.js — OPT-IN development fixtures. Never loaded by default.
 *
 * `seedDevFixture` fills an EMPTY local repository with hundreds of binders
 * and boxes plus display cases so scale, paging and search can be tested. It
 *  - uses real card names, numbers, rarities and CDN artwork (realCards.js),
 *  - goes through the repository's own API, so every placement and
 *    inventory rule is enforced exactly as for real data,
 *  - labels everything "[DEV]" and flags the state (`meta.devFixture`) so UI
 *    can show a banner,
 *  - refuses to run on a room that already holds anything, so it can never
 *    mix test data into a user's collection. `repo.reset()` removes it.
 * Deterministic for a given `seed`.
 */
import { BINDER_ACCENTS, BOX_PRESETS, DISPLAY_PRESETS, RoomDataError, SHELF_PRESETS } from './contracts.js';
import { REAL_CARD_ROWS, REAL_SETS } from './realCards.js';
import { selectIsEmpty } from './selectors.js';

/** setId → display name, for panels (the Card contract carries only `setId`). */
export const REAL_SET_NAMES = Object.fromEntries(Object.entries(REAL_SETS).map(([id, set]) => [id, set.name]));

/** Real cards in the main app's Card shape; artwork follows the CDN pattern Card.images uses. */
export function realCardCatalog() {
  return REAL_CARD_ROWS.map(([id, name, number, rarity, setId]) => ({
    id, setId, name, number, ...(rarity ? { rarity } : {}),
    images: { small: `https://images.pokemontcg.io/${setId}/${number}.png`, large: `https://images.pokemontcg.io/${setId}/${number}_hires.png` },
  }));
}

/** mulberry32 — tiny seeded PRNG so fixtures are reproducible. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, width = 3) => String(n).padStart(width, '0');

/**
 * @param {ReturnType<typeof import('./localRepository.js').createLocalRepository>} repo
 * @param {{ binders?: number, boxes?: number, displayCases?: number, cardsPerBinder?: number, unplacedBinders?: number, unplacedBoxes?: number, seed?: number }} [options]
 */
export async function seedDevFixture(repo, {
  binders = 300, boxes = 400, displayCases = 3, cardsPerBinder = 12, unplacedBinders = 6, unplacedBoxes = 6, seed = 1,
} = {}) {
  if (!selectIsEmpty(repo.getState())) throw new RoomDataError('fixture-needs-empty-room', 'Dev fixtures only load into an empty room. Call reset() first.');
  const rand = seededRandom(seed);
  const catalog = realCardCatalog();
  const bySet = Object.keys(REAL_SETS).map((setId) => catalog.filter((card) => card.setId === setId));
  const pickCards = (pool, count) => {
    const copy = pool.slice();
    const out = [];
    while (out.length < count && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
    return out;
  };
  const accentKeys = Object.keys(BINDER_ACCENTS);
  const shelfPreset = SHELF_PRESETS.find((p) => p.preset === 'wood_shelf');
  const rackPreset = SHELF_PRESETS.find((p) => p.preset === 'heavy_duty_rack');

  return repo.batch(async (r) => {
    const userId = r.getState().userId;
    const spaceId = r.getState().spaces.find((s) => s.isDefault).id;
    r.registerCards(catalog);
    r.markDevFixture(true);

    const placedBinders = Math.max(0, binders - unplacedBinders);
    const placedBoxes = Math.max(0, boxes - unplacedBoxes);
    const binderCapacity = shelfPreset.shelfCount * shelfPreset.positionsPerShelf;
    const boxCapacity = rackPreset.shelfCount * rackPreset.positionsPerShelf * rackPreset.maxStackHeight;
    const binderUnits = [];
    for (let i = 0; i < Math.ceil(placedBinders / binderCapacity); i++) binderUnits.push(await r.createStorageUnit(userId, { spaceId, ...shelfPreset, name: `[DEV] Binder Shelf ${pad(i + 1, 2)}` }));
    const boxUnits = [];
    for (let i = 0; i < Math.ceil(placedBoxes / boxCapacity); i++) boxUnits.push(await r.createStorageUnit(userId, { spaceId, ...rackPreset, name: `[DEV] Box Rack ${pad(i + 1, 2)}` }));

    /** Card placements, resolved to inventory lots once total demand per card is known. */
    const plan = [];
    const demand = new Map();
    const want = (card, quantity) => demand.set(card.id, (demand.get(card.id) ?? 0) + quantity);

    for (let i = 0; i < binders; i++) {
      const pool = bySet[i % bySet.length];
      const setName = REAL_SETS[pool[0].setId].name;
      const binder = await r.createBinder(userId, `[DEV] ${setName} Binder ${pad(i + 1)}`, ['Four', 'Nine', 'Twelve'][i % 3], { accent: accentKeys[Math.floor(rand() * accentKeys.length)] });
      if (i < placedBinders) {
        const unit = binderUnits[Math.floor(i / binderCapacity)];
        const j = i % binderCapacity;
        await r.placeBinder(userId, binder.id, { spaceId, unitId: unit.id, shelfIndex: Math.floor(j / shelfPreset.positionsPerShelf), shelfPosition: j % shelfPreset.positionsPerShelf });
      }
      if (i % 10 === 9) continue; // every 10th binder stays empty to exercise empty states
      const count = i % 7 === 0 ? cardsPerBinder * 3 : cardsPerBinder; // a few large binders
      pickCards(pool, count).forEach((card, slotIndex) => { plan.push({ binderId: binder.id, slotIndex, card, quantity: 1 }); want(card, 1); });
    }

    for (let k = 0; k < boxes; k++) {
      const preset = BOX_PRESETS[k % BOX_PRESETS.length];
      const box = await r.createBox(userId, `[DEV] ${preset.name} ${pad(k + 1)}`, preset.boxType, preset.capacity, preset.color);
      const drawerIds = [box.drawers[0].id];
      if (k % 3 === 0) drawerIds.push((await r.createDrawer(box.id, 'Trade copies')).id);
      if (k < placedBoxes) {
        const unit = boxUnits[Math.floor(k / boxCapacity)];
        const j = k % boxCapacity;
        const perShelf = rackPreset.positionsPerShelf * rackPreset.maxStackHeight;
        await r.placeBox(userId, box.id, {
          spaceId, unitId: unit.id, shelfIndex: Math.floor(j / perShelf), stackIndex: Math.floor((j % perShelf) / rackPreset.maxStackHeight), stackLevel: j % rackPreset.maxStackHeight,
        });
      }
      if (k % 10 === 9) continue; // every 10th box stays empty
      for (const drawerId of drawerIds) {
        for (const card of pickCards(catalog, 5 + Math.floor(rand() * 30))) {
          const quantity = 1 + Math.floor(rand() * 3);
          plan.push({ drawerId, card, quantity }); want(card, quantity);
        }
      }
    }

    for (let c = 0; c < displayCases; c++) {
      const preset = DISPLAY_PRESETS[c % DISPLAY_PRESETS.length];
      const displayCase = await r.createDisplayCase(userId, { spaceId, ...preset, name: `[DEV] ${preset.name} ${c + 1}` });
      // Fill every other slot; the rest stay empty so empty-slot rendering is exercised.
      displayCase.slots.filter((_, s) => s % 2 === 0).forEach((slot) => {
        const card = pickCards(catalog, 1)[0];
        plan.push({ displaySlotId: slot.id, card, quantity: 1 }); want(card, 1);
      });
    }

    // Inventory sized to what is placed, plus a little spare so the card picker has free copies to offer.
    const lotByCard = new Map();
    for (const [cardId, quantity] of demand) lotByCard.set(cardId, (await r.addCopies(userId, { cardId, quantity: quantity + Math.floor(rand() * 3) })).id);
    for (const card of pickCards(catalog, 20)) await r.addCopies(userId, { cardId: card.id, quantity: 1 + Math.floor(rand() * 4) });

    for (const item of plan) {
      const lotId = lotByCard.get(item.card.id);
      if (item.binderId) await r.placeInBinderSlot(userId, item.binderId, item.slotIndex, { lotId, quantity: 1, protection: 'sleeved' });
      else if (item.drawerId) await r.placeCopies(userId, { lotId, drawerId: item.drawerId, quantity: item.quantity, protection: 'raw' });
      else await r.placeCopies(userId, { lotId, displaySlotId: item.displaySlotId, quantity: 1, protection: 'magnetic_holder' });
    }
    return { binders, boxes, displayCases, binderUnits: binderUnits.length, boxUnits: boxUnits.length, placements: plan.length, ownedLots: lotByCard.size };
  });
}
