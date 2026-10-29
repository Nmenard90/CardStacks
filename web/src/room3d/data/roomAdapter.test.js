/**
 * Adapter tests — run with `node --test "src/data/*.test.js"`.
 * (Never a bare `node --test`: it also discovers the browser scripts in scripts/.)
 * They pin what the 3D room is told to draw: nothing for an empty collection,
 * the right baked-in mesh ids for real items, and honest counts for everything
 * the baked furniture cannot show.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_PRESETS, SHELF_PRESETS } from './contracts.js';
import { createLocalRepository } from './localRepository.js';
import { seedDevFixture } from './fixtures.js';
import { toRoomModel } from './roomAdapter.js';

const U = 'local-user';
const newRepo = () => createLocalRepository({ now: () => '2026-10-23T12:00:00.000Z' });
const card = (id, name) => ({ id, setId: 'test-set', name, number: '12', rarity: 'Rare', images: { small: `https://img.test/${id}.png`, large: `https://img.test/${id}_hires.png` } });
const shelf = (repo, name, overrides = {}) => repo.createStorageUnit(U, { ...SHELF_PRESETS[1], ...overrides, spaceId: 'space-1', name });
const spot = (unitId, shelfIndex, shelfPosition) => ({ spaceId: 'space-1', unitId, shelfIndex, shelfPosition });

test('an empty collection yields no binders, boxes or display cards — and says so', () => {
  const model = toRoomModel(newRepo().getState());
  assert.deepEqual([model.binders, model.storageBoxes, model.displayCards], [[], [], []]);
  assert.deepEqual(model.totals, { binders: 0, boxes: 0, displayCards: 0, ownedCards: 0 });
  assert.equal(model.meta.isEmpty, true);
  assert.deepEqual(model.meta.notShown, { binders: 0, boxes: 0, displayCards: 0 });
  assert.deepEqual(model.meta.focus, { binderUnitId: null, boxUnitId: null, caseId: null });
});

test('furniture without items still yields an empty collection', async () => {
  const repo = newRepo();
  await shelf(repo, 'Shelf');
  await repo.createDisplayCase(U, { ...DISPLAY_PRESETS[1], spaceId: 'space-1', name: 'Cabinet' });
  const model = toRoomModel(repo.getState());
  assert.deepEqual([model.binders.length, model.storageBoxes.length, model.displayCards.length], [0, 0, 0]);
  assert.equal(model.meta.isEmpty, false, 'the room has furniture, so it is not the brand-new state');
  assert.notEqual(model.meta.focus.binderUnitId, null);
  assert.notEqual(model.meta.focus.caseId, null);
});

test('a placed binder maps to its baked mesh id with real cards and the chosen colour', async () => {
  const repo = newRepo();
  repo.registerCards([card('c1', 'Real Card')]);
  const unit = await shelf(repo, 'Shelf');
  const binder = await repo.createBinder(U, 'Trade Night', 'Nine', { accent: 'violet' });
  await repo.placeBinder(U, binder.id, spot(unit.id, 2, 3));
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 1 });
  await repo.placeInBinderSlot(U, binder.id, 0, { lotId: lot.id, quantity: 1, protection: 'sleeved' });
  const model = toRoomModel(repo.getState(), { setNames: { 'test-set': 'Test Set' } });
  assert.equal(model.binders.length, 1);
  const [shown] = model.binders;
  assert.deepEqual([shown.meshId, shown.name, shown.accent, shown.cardCount, shown.capacity], ['2_3', 'Trade Night', '#8a63d6', 1, null]);
  const [first] = shown.cards;
  assert.deepEqual([first.name, first.setName, first.number, first.imageUrl, first.protection, first.value], ['Real Card', 'Test Set', '12', 'https://img.test/c1_hires.png', 'sleeved', null]);
  assert.equal(first.id, first.allocationId, 'card ids are unique per pocket');
  assert.equal(model.totals.ownedCards, 1);
});

test('binders outside the baked 4 × 10 grid or in other units are counted, never silently dropped', async () => {
  const repo = newRepo();
  const wide = await shelf(repo, 'Wide', { shelfCount: 6, positionsPerShelf: 12 });
  const other = await shelf(repo, 'Other');
  const place = async (name, unitId, shelfIndex, position) => {
    const binder = await repo.createBinder(U, name, 'Nine');
    await repo.placeBinder(U, binder.id, spot(unitId, shelfIndex, position));
  };
  await place('inside', wide.id, 3, 9);
  await place('too high', wide.id, 4, 0);
  await place('too far', wide.id, 0, 10);
  await place('elsewhere', other.id, 0, 0);
  await repo.createBinder(U, 'loose', 'Nine');
  const model = toRoomModel(repo.getState());
  assert.equal(model.meta.focus.binderUnitId, wide.id, 'the first unit that holds binders is shown');
  assert.deepEqual(model.binders.map((b) => b.meshId), ['3_9']);
  assert.equal(model.meta.notShown.binders, 3);
  assert.equal(model.meta.unplaced.binders, 1);
  assert.equal(model.totals.binders, 5);
});

test('boxes map to baked bins only at the bottom of a stack; the rest are counted', async () => {
  const repo = newRepo();
  repo.registerCards([card('c1', 'Bulk Card')]);
  const unit = await shelf(repo, 'Rack', { shelfCount: 5, positionsPerShelf: 6, maxStackHeight: 4 });
  const mk = async (name) => repo.createBox(U, name, 'long-800', 800);
  const place = (box, shelfIndex, stackIndex, stackLevel) => repo.placeBox(U, box.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex, stackIndex, stackLevel });
  const good = await mk('good'); await place(good, 1, 1, 0);
  const stacked = await mk('stacked'); await place(stacked, 1, 1, 1);
  const lastRow = await mk('last row, second bin'); await place(lastRow, 3, 1, 0); // row 3 has one bin only
  const lowShelf = await mk('shelf 5'); await place(lowShelf, 4, 0, 0);
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 3 });
  await repo.placeCopies(U, { lotId: lot.id, drawerId: good.drawers[0].id, quantity: 3 });
  const model = toRoomModel(repo.getState());
  assert.deepEqual(model.storageBoxes.map((b) => [b.name, b.meshId]), [['good', '1_1']]);
  assert.equal(model.meta.notShown.boxes, 3);
  const [box] = model.storageBoxes;
  assert.deepEqual([box.cardCount, box.drawers[0].cardCount, box.drawers[0].cards[0].name, box.drawers[0].cards[0].quantity], [3, 3, 'Bulk Card', 3]);
});

test('display cards keep their slot position (displayIndex); slots past the cabinet are counted', async () => {
  const repo = newRepo();
  repo.registerCards([card('c1', 'Showpiece')]);
  const displayCase = await repo.createDisplayCase(U, { ...DISPLAY_PRESETS[1], spaceId: 'space-1', name: 'Cabinet' }); // 9 slots
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 3 });
  for (const index of [4, 1, 7]) await repo.placeCopies(U, { lotId: lot.id, displaySlotId: displayCase.slots[index].id, quantity: 1 });
  const model = toRoomModel(repo.getState());
  assert.deepEqual(model.displayCards.map((c) => [c.displayIndex, c.name, c.id]), [[1, 'Showpiece', displayCase.slots[1].id], [4, 'Showpiece', displayCase.slots[4].id]]);
  assert.equal(model.meta.notShown.displayCards, 1);
  assert.equal(model.totals.displayCards, 3);
});

test('the dev fixture adapts to a valid, bounded set of baked meshes', async () => {
  const repo = newRepo();
  await seedDevFixture(repo, { binders: 300, boxes: 400 });
  const model = toRoomModel(repo.getState());
  const unique = (list) => new Set(list).size === list.length;
  assert.equal(model.binders.length, 20);
  assert.ok(unique(model.binders.map((b) => b.meshId)) && model.binders.every((b) => /^[0-3]_[0-4]$/.test(b.meshId)));
  assert.ok(model.storageBoxes.length >= 1 && model.storageBoxes.length <= 7);
  assert.ok(unique(model.storageBoxes.map((b) => b.meshId)));
  assert.equal(model.meta.unplaced.binders + model.meta.unplaced.boxes, 12);
  assert.equal(model.meta.devFixture, true);
  assert.equal(model.profile.username, 'Dev fixture · test data');
  assert.ok(model.displayCards.every((c) => c.imageUrl.startsWith('https://images.pokemontcg.io/')));
  assert.equal(model.totals.binders, 300);
  assert.equal(model.totals.boxes, 400);
  assert.equal(model.meta.notShown.binders + model.binders.length + model.meta.unplaced.binders, 300, 'every binder is either shown, off this shelf, or unplaced');
});
