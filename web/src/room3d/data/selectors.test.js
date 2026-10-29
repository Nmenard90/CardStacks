/**
 * Selector and dev-fixture tests — run with `node --test "src/data/*.test.js"`.
 * Covers: empty-state safety, the multi-furniture overview, unit grids,
 * real card data in binders/boxes/display cases, the unplaced area,
 * search/paging over the full collection, and the opt-in scale fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDER_ACCENTS, DISPLAY_PRESETS, RoomDataError, SHELF_PRESETS, checkInvariants } from './contracts.js';
import { createLocalRepository } from './localRepository.js';
import { seedDevFixture, realCardCatalog } from './fixtures.js';
import {
  binderColor, findFreeBinderSpot, findFreeBoxSpot, paginate, searchContainers, selectBinderView, selectBoxView, selectDisplayCaseView,
  selectFreeCopies, selectIsEmpty, selectRoomOverview, selectUnitView, selectUnplaced,
} from './selectors.js';

const U = 'local-user';
const fixedNow = () => '2026-10-23T12:00:00.000Z';
const newRepo = () => createLocalRepository({ now: fixedNow });
const card = (id, name) => ({ id, setId: 'test', name, number: '7', rarity: 'Rare', images: { small: `https://img.test/${id}.png`, large: `https://img.test/${id}_hires.png` } });
const shelf = (repo, name, preset = SHELF_PRESETS[1]) => repo.createStorageUnit(U, { ...preset, spaceId: 'space-1', name });

test('every selector is safe on the empty state', () => {
  const state = newRepo().getState();
  assert.equal(selectIsEmpty(state), true);
  const overview = selectRoomOverview(state);
  assert.equal(overview.isEmpty, true);
  assert.deepEqual(overview.spaces[0].units, []);
  assert.deepEqual(overview.unplaced, { binders: 0, boxes: 0 });
  assert.deepEqual(selectUnplaced(state), { binders: [], boxes: [] });
  assert.deepEqual(selectFreeCopies(state), []);
  assert.deepEqual(searchContainers(state), []);
  assert.deepEqual(paginate([], 3), { items: [], page: 0, pageCount: 1, total: 0 });
  assert.equal(selectUnitView(state, 'nope'), null);
  assert.equal(selectBinderView(state, 'nope'), null);
  assert.equal(selectBoxView(state, 'nope'), null);
  assert.equal(selectDisplayCaseView(state, 'nope'), null);
  assert.equal(findFreeBinderSpot(state, 'nope'), null);
});

test('the overview lists every shelf unit and display case so one room can show them together', async () => {
  const repo = newRepo();
  const a = await shelf(repo, 'Binder wall');
  await shelf(repo, 'Box rack', SHELF_PRESETS[0]);
  await repo.createDisplayCase(U, { ...DISPLAY_PRESETS[1], spaceId: 'space-1', name: 'Cabinet' });
  await repo.createDisplayCase(U, { ...DISPLAY_PRESETS[3], spaceId: 'space-1', name: 'Ledge' });
  const binder = await repo.createBinder(U, 'B', 'Nine');
  await repo.placeBinder(U, binder.id, { spaceId: 'space-1', unitId: a.id, shelfIndex: 0, shelfPosition: 0 });
  const overview = selectRoomOverview(repo.getState());
  const [space] = overview.spaces;
  assert.deepEqual(space.units.map((u) => u.name), ['Binder wall', 'Box rack']);
  assert.deepEqual(space.displayCases.map((c) => [c.name, c.slotCount, c.filledCount]), [['Cabinet', 9, 0], ['Ledge', 5, 0]]);
  assert.equal(space.units[0].binderCount, 1);
  assert.equal(space.units[0].freeBinderSpots, 19);
  assert.equal(space.units[1].boxSpots, 5 * 6 * 4);
  assert.equal(overview.isEmpty, false);
});

test('a unit view is a shelves × positions grid with binders and box stacks in place', async () => {
  const repo = newRepo();
  const unit = await shelf(repo, 'Shelf'); // 4 × 5, stack 3
  const binder = await repo.createBinder(U, 'Binder', 'Nine');
  await repo.placeBinder(U, binder.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex: 1, shelfPosition: 2 });
  const low = await repo.createBox(U, 'Low', 'long-800', 800);
  const high = await repo.createBox(U, 'High', 'long-800', 800);
  await repo.placeBox(U, low.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex: 3, stackIndex: 4, stackLevel: 0 });
  await repo.placeBox(U, high.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex: 3, stackIndex: 4, stackLevel: 1 });
  const view = selectUnitView(repo.getState(), unit.id);
  assert.equal(view.shelves.length, 4);
  assert.equal(view.shelves[0].positions.length, 5);
  assert.equal(view.shelves[1].positions[2].binder.name, 'Binder');
  assert.equal(view.shelves[0].positions[0].binder, null);
  assert.deepEqual(view.shelves[3].positions[4].boxes.map((b) => b.name), ['Low', 'High']);
  assert.deepEqual([view.binderCount, view.boxCount], [1, 2]);
});

test('binder and box views carry real card names and artwork; empty ones carry nothing', async () => {
  const repo = newRepo();
  repo.registerCards([card('c1', 'Real Card One'), card('c2', 'Real Card Two')]);
  const binder = await repo.createBinder(U, 'Binder', 'Nine');
  const empty = await repo.createBinder(U, 'Empty', 'Nine');
  const box = await repo.createBox(U, 'Box', 'long-800', 800);
  const lot1 = await repo.addCopies(U, { cardId: 'c1', quantity: 2 });
  const lot2 = await repo.addCopies(U, { cardId: 'c2', quantity: 1 });
  await repo.placeInBinderSlot(U, binder.id, 3, { lotId: lot2.id, quantity: 1 });
  await repo.placeInBinderSlot(U, binder.id, 1, { lotId: lot1.id, quantity: 1 });
  await repo.placeCopies(U, { lotId: lot1.id, drawerId: box.drawers[0].id, quantity: 1 });
  const state = repo.getState();
  const view = selectBinderView(state, binder.id);
  assert.deepEqual(view.cards.map((c) => [c.slotIndex, c.name, c.imageLarge, c.number, c.rarity, c.known]), [
    [1, 'Real Card One', 'https://img.test/c1_hires.png', '7', 'Rare', true],
    [3, 'Real Card Two', 'https://img.test/c2_hires.png', '7', 'Rare', true],
  ]);
  assert.equal(view.cardCount, 2);
  const emptyView = selectBinderView(state, empty.id);
  assert.deepEqual([emptyView.cards, emptyView.isEmpty, emptyView.cardCount], [[], true, 0]);
  const boxView = selectBoxView(state, box.id);
  assert.equal(boxView.cardCount, 1);
  assert.equal(boxView.drawers[0].cards[0].name, 'Real Card One');
  assert.equal(boxView.fill, 1 / 800);
});

test('display cases stay visible when empty, with every slot unoccupied until a card is placed', async () => {
  const repo = newRepo();
  repo.registerCards([card('c1', 'Showpiece')]);
  const displayCase = await repo.createDisplayCase(U, { ...DISPLAY_PRESETS[1], spaceId: 'space-1', name: 'Cabinet' });
  let view = selectDisplayCaseView(repo.getState(), displayCase.id);
  assert.deepEqual([view.slots.length, view.filledCount, view.isEmpty], [9, 0, true]);
  assert.ok(view.slots.every((slot) => slot.card === null));
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 1 });
  await repo.placeCopies(U, { lotId: lot.id, displaySlotId: displayCase.slots[4].id, quantity: 1, protection: 'graded_slab' });
  view = selectDisplayCaseView(repo.getState(), displayCase.id);
  assert.deepEqual([view.filledCount, view.isEmpty], [1, false]);
  assert.equal(view.slots[4].card.name, 'Showpiece');
  assert.equal(view.slots[4].card.imageLarge, 'https://img.test/c1_hires.png');
  assert.equal(view.slots[4].card.protection, 'graded_slab');
  assert.equal(selectFreeCopies(repo.getState()).length, 0, 'the only copy is now on display');
});

test('unplaced containers are listed separately until they get a shelf position', async () => {
  const repo = newRepo();
  const unit = await shelf(repo, 'Shelf');
  const binder = await repo.createBinder(U, 'Loose binder', 'Nine');
  await repo.createBox(U, 'Loose box', 'deck-100', 100);
  let unplaced = selectUnplaced(repo.getState());
  assert.deepEqual([unplaced.binders.map((b) => b.name), unplaced.boxes.map((b) => b.name)], [['Loose binder'], ['Loose box']]);
  assert.deepEqual(selectRoomOverview(repo.getState()).unplaced, { binders: 1, boxes: 1 });
  await repo.placeBinder(U, binder.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex: 0, shelfPosition: 0 });
  unplaced = selectUnplaced(repo.getState());
  assert.deepEqual([unplaced.binders.length, unplaced.boxes.length], [0, 1]);
});

test('search, filter, sort and paging work over the whole collection', async () => {
  const repo = newRepo();
  const unit = await shelf(repo, 'Shelf');
  const placedNames = ['Alpha 10', 'Alpha 2', 'alpha 1'];
  for (const name of [...placedNames, 'Beta']) {
    const binder = await repo.createBinder(U, name, 'Nine');
    if (placedNames.includes(name)) await repo.placeBinder(U, binder.id, { spaceId: 'space-1', unitId: unit.id, shelfIndex: 0, shelfPosition: placedNames.indexOf(name) });
  }
  await repo.createBox(U, 'Alpha box', 'deck-100', 100);
  const state = repo.getState();
  assert.deepEqual(searchContainers(state, { query: 'alpha', kind: 'binder' }).map((r) => r.name), ['alpha 1', 'Alpha 2', 'Alpha 10'], 'natural, case-insensitive order');
  assert.deepEqual(searchContainers(state, { query: ' ALPHA ' }).map((r) => r.kind).sort(), ['binder', 'binder', 'binder', 'box']);
  assert.deepEqual(searchContainers(state, { placement: 'unplaced' }).map((r) => r.name).sort(), ['Alpha box', 'Beta']);
  assert.equal(searchContainers(state, { unitId: unit.id }).length, 3);
  assert.equal(searchContainers(state, { empty: true }).length, 5);
  assert.equal(searchContainers(state, { empty: false }).length, 0);
  const page = paginate(searchContainers(state), 1, 2);
  assert.deepEqual([page.items.length, page.page, page.pageCount, page.total], [2, 1, 3, 5]);
  assert.equal(paginate([1, 2, 3], 99, 2).page, 1, 'out-of-range pages clamp');
});

test('free-spot finders fill in order and report a full unit', async () => {
  const repo = newRepo();
  const tiny = await repo.createStorageUnit(U, { spaceId: 'space-1', name: 'Tiny', unitType: 'shelf', preset: 'custom', color: '#000000', shelfCount: 1, positionsPerShelf: 2, maxStackHeight: 2 });
  assert.deepEqual(findFreeBinderSpot(repo.getState(), tiny.id), { spaceId: 'space-1', unitId: tiny.id, shelfIndex: 0, shelfPosition: 0 });
  for (let i = 0; i < 2; i++) {
    const binder = await repo.createBinder(U, `B${i}`, 'Nine');
    await repo.placeBinder(U, binder.id, findFreeBinderSpot(repo.getState(), tiny.id));
  }
  assert.equal(findFreeBinderSpot(repo.getState(), tiny.id), null);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const box = await repo.createBox(U, `Box${i}`, 'deck-100', 100);
    const spot = findFreeBoxSpot(repo.getState(), tiny.id);
    seen.push([spot.stackIndex, spot.stackLevel]);
    await repo.placeBox(U, box.id, spot);
  }
  assert.deepEqual(seen, [[0, 0], [0, 1], [1, 0], [1, 1]], 'each stack fills before the next position');
  assert.equal(findFreeBoxSpot(repo.getState(), tiny.id), null);
});

test('binder colour is the user choice when set, otherwise stable per binder', async () => {
  const repo = newRepo();
  const binder = await repo.createBinder(U, 'B', 'Nine');
  const defaultColor = binderColor(repo.getState(), binder.id);
  assert.equal(defaultColor.colorChosen, false);
  assert.ok(Object.values(BINDER_ACCENTS).includes(defaultColor.color));
  assert.deepEqual(binderColor(repo.getState(), binder.id), defaultColor, 'deterministic');
  await repo.setBinderAccent(binder.id, 'coral');
  assert.deepEqual(binderColor(repo.getState(), binder.id), { colorKey: 'coral', color: BINDER_ACCENTS.coral, colorChosen: true });
  await repo.setBinderAccent(binder.id, '#0a0b0c');
  assert.deepEqual(binderColor(repo.getState(), binder.id), { colorKey: null, color: '#0a0b0c', colorChosen: true });
});

test('dev fixture: opt-in, real cards, hundreds of containers, every rule still holds', async () => {
  const catalog = realCardCatalog();
  assert.ok(catalog.length > 200);
  assert.ok(catalog.every((c) => c.name && /^https:\/\/images\.pokemontcg\.io\/[\w-]+\/\w+\.png$/.test(c.images.small) && c.images.large.endsWith('_hires.png')));

  const repo = newRepo();
  assert.equal(selectIsEmpty(repo.getState()), true, 'nothing is seeded unless asked for');
  const started = performance.now();
  const summary = await seedDevFixture(repo, { binders: 300, boxes: 400 });
  console.log(`  dev fixture: ${JSON.stringify(summary)} in ${Math.round(performance.now() - started)} ms`);
  const state = repo.getState();
  assert.deepEqual(checkInvariants(state), []);
  assert.equal(state.meta.devFixture, true);
  assert.deepEqual([state.binders.length, state.boxes.length], [300, 400]);
  assert.ok(state.binders.every((b) => b.name.startsWith('[DEV] ')) && state.boxes.every((b) => b.name.startsWith('[DEV] ')));
  const overview = selectRoomOverview(state);
  assert.equal(overview.devFixture, true);
  assert.equal(overview.spaces[0].units.length, 15 + 4, '294 binders over 20-spot shelves, 394 boxes over 120-spot racks');
  assert.deepEqual(overview.unplaced, { binders: 6, boxes: 6 });
  assert.equal(overview.spaces[0].displayCases.length, 3);

  const everyBinder = state.binders.map((b) => selectBinderView(state, b.id));
  assert.equal(everyBinder.filter((b) => b.isEmpty).length, 30, 'every tenth binder is empty');
  const cards = everyBinder.flatMap((b) => b.cards);
  assert.ok(cards.length > 3000);
  assert.ok(cards.every((c) => c.known && c.imageLarge.startsWith('https://images.pokemontcg.io/')), 'only real cards with real artwork');
  assert.ok(searchContainers(state, { query: 'jungle', kind: 'binder' }).length >= 100);
  assert.ok(selectFreeCopies(state).length >= 20, 'spare copies exist for the card picker');

  await assert.rejects(seedDevFixture(repo), (e) => e instanceof RoomDataError && e.code === 'fixture-needs-empty-room', 'never mixes into a populated room');
  repo.reset();
  assert.equal(selectIsEmpty(repo.getState()), true);
  assert.equal(repo.getState().meta.devFixture, false);
});

test('dev fixture is deterministic for a given seed', async () => {
  const a = newRepo();
  const b = newRepo();
  await seedDevFixture(a, { binders: 25, boxes: 25, seed: 7 });
  await seedDevFixture(b, { binders: 25, boxes: 25, seed: 7 });
  assert.deepEqual(a.getState(), b.getState());
  const c = newRepo();
  await seedDevFixture(c, { binders: 25, boxes: 25, seed: 8 });
  assert.notDeepEqual(a.getState().allocations, c.getState().allocations);
});
