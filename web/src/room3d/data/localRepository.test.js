/**
 * Repository tests — run with `node --test "src/data/*.test.js"` (Node's built-in runner).
 * Do NOT run a bare `node --test`: it also auto-discovers the browser scripts in scripts/test-*.mjs.
 * They pin the rules the real CardStacks data must also obey: empty start, no
 * sample cards, position bounds, inventory quantities vs allocations, atomic
 * writes, and persistence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_PRESETS, SHELF_PRESETS, BOX_PRESETS, RoomDataError, checkInvariants } from './contracts.js';
import { createEmptyState, createLocalRepository } from './localRepository.js';
import { selectIsEmpty } from './selectors.js';

const U = 'local-user';
const fixedNow = () => '2026-10-23T12:00:00.000Z';
const newRepo = (options = {}) => createLocalRepository({ now: fixedNow, ...options });
const testCard = (id, name) => ({ id, setId: 'test', name, number: '1', images: { small: `https://img.test/${id}.png`, large: `https://img.test/${id}_hires.png` } });
const rejects = (promise, code) => assert.rejects(promise, (error) => error instanceof RoomDataError && error.code === code);
const memoryStorage = () => { const data = new Map(); return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }; };
const makeShelf = (repo, preset = SHELF_PRESETS[1]) => repo.createStorageUnit(U, { ...preset, spaceId: 'space-1', name: 'Test shelf' });

test('a new user starts with one empty default space and nothing else', () => {
  const state = newRepo().getState();
  assert.equal(state.spaces.length, 1);
  assert.equal(state.spaces[0].isDefault, true);
  assert.deepEqual([state.spaces[0].storageUnits, state.spaces[0].displayCases, state.boxes, state.binders, state.lots, state.allocations], [[], [], [], [], [], []]);
  assert.equal(selectIsEmpty(state), true);
  assert.deepEqual(checkInvariants(state), []);
  assert.deepEqual(createEmptyState(U, fixedNow), state);
});

test('a created binder is empty and unplaced — never sample cards', async () => {
  const repo = newRepo();
  const binder = await repo.createBinder(U, '  Trade Night  ', 'Nine', { accent: 'teal' });
  assert.equal(binder.name, 'Trade Night');
  assert.equal(binder.storageUnitId, undefined);
  assert.deepEqual((await repo.getBinder(U, binder.id)).slots, []);
  assert.equal(repo.getState().lots.length, 0);
  assert.equal(repo.getState().allocations.length, 0);
  await rejects(repo.createBinder(U, '   ', 'Nine'), 'invalid-name');
  await rejects(repo.createBinder(U, 'x', 'Thirteen'), 'invalid-pocket-size');
  await rejects(repo.createBinder(U, 'x', 'Nine', { accent: 'not-a-colour' }), 'invalid-color');
});

test('binders keep to their shelf unit: bounds, occupancy, moves', async () => {
  const repo = newRepo();
  const unit = await makeShelf(repo); // 4 shelves × 5 positions
  const a = await repo.createBinder(U, 'A', 'Nine');
  const b = await repo.createBinder(U, 'B', 'Nine');
  const spot = (shelfIndex, shelfPosition) => ({ spaceId: 'space-1', unitId: unit.id, shelfIndex, shelfPosition });
  await repo.placeBinder(U, a.id, spot(1, 2));
  await rejects(repo.placeBinder(U, b.id, spot(1, 2)), 'position-occupied');
  await rejects(repo.placeBinder(U, b.id, spot(4, 0)), 'out-of-bounds');
  await rejects(repo.placeBinder(U, b.id, spot(0, 5)), 'out-of-bounds');
  await repo.placeBinder(U, a.id, spot(0, 0)); // moving frees the old spot
  await repo.placeBinder(U, b.id, spot(1, 2));
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('boxes stack up to the unit limit and never overlap', async () => {
  const repo = newRepo();
  const unit = await makeShelf(repo); // stack height 3
  const boxes = [];
  for (let i = 0; i < 4; i++) boxes.push(await repo.createBox(U, `Box ${i}`, BOX_PRESETS[0].boxType, 800));
  const at = (stackLevel) => ({ spaceId: 'space-1', unitId: unit.id, shelfIndex: 0, stackIndex: 0, stackLevel });
  await repo.placeBox(U, boxes[0].id, at(0));
  await repo.placeBox(U, boxes[1].id, at(1));
  await repo.placeBox(U, boxes[2].id, at(2));
  await rejects(repo.placeBox(U, boxes[3].id, at(3)), 'out-of-bounds');
  await rejects(repo.placeBox(U, boxes[3].id, at(2)), 'position-occupied');
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('inventory: copies are limited by quantity, one card per pocket, removal frees the copy', async () => {
  const repo = newRepo();
  repo.registerCards([testCard('c1', 'Test Card')]);
  const binder = await repo.createBinder(U, 'B', 'Nine');
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 2 });
  assert.equal((await repo.addCopies(U, { cardId: 'c1', quantity: 1 })).id, lot.id, 'same card/condition merges into one lot');
  const first = await repo.placeInBinderSlot(U, binder.id, 0, { lotId: lot.id, quantity: 1 });
  await rejects(repo.placeInBinderSlot(U, binder.id, 0, { lotId: lot.id, quantity: 1 }), 'slot-occupied');
  await rejects(repo.placeInBinderSlot(U, binder.id, 1, { lotId: lot.id, quantity: 2 }), 'invalid-quantity');
  await repo.placeInBinderSlot(U, binder.id, 1, { lotId: lot.id, quantity: 1 });
  await repo.placeInBinderSlot(U, binder.id, 2, { lotId: lot.id, quantity: 1 });
  await rejects(repo.placeInBinderSlot(U, binder.id, 3, { lotId: lot.id, quantity: 1 }), 'insufficient-copies');
  assert.equal(repo.getState().lots[0].allocated, 3);
  const detail = await repo.getBinder(U, binder.id);
  assert.deepEqual(detail.slots.map((s) => [s.slotIndex, s.cardName, s.imageUrl]), [0, 1, 2].map((i) => [i, 'Test Card', 'https://img.test/c1_hires.png']));
  await repo.removePlacement(U, first.id);
  assert.equal(repo.getState().lots[0].allocated, 2);
  await rejects(repo.removeCopies(U, lot.id, 2), 'insufficient-copies');
  await repo.removeCopies(U, lot.id, 1);
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('drawers hold multiple copies and keep their count; bad targets are rejected', async () => {
  const repo = newRepo();
  repo.registerCards([testCard('c1', 'Test Card')]);
  const box = await repo.createBox(U, 'Bulk', 'long-800', 800);
  const drawerId = box.drawers[0].id;
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 5 });
  const placement = await repo.placeCopies(U, { lotId: lot.id, drawerId, quantity: 3, protection: 'sleeved' });
  assert.equal(repo.getState().boxes[0].drawers[0].cardCount, 3);
  await rejects(repo.placeCopies(U, { lotId: lot.id, drawerId, quantity: 3 }), 'insufficient-copies');
  await rejects(repo.placeCopies(U, { lotId: lot.id, quantity: 1 }), 'invalid-target');
  await rejects(repo.placeCopies(U, { lotId: lot.id, drawerId, binderSlotId: 'x', quantity: 1 }), 'invalid-target');
  await rejects(repo.placeCopies(U, { lotId: lot.id, drawerId: 'nope', quantity: 1 }), 'not-found');
  await rejects(repo.placeCopies(U, { lotId: lot.id, drawerId, quantity: 1, protection: 'foil-wrap' }), 'invalid-protection');
  await repo.removePlacement(U, placement.id);
  assert.equal(repo.getState().boxes[0].drawers[0].cardCount, 0);
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('display cases create every slot empty; a slot holds one card', async () => {
  const repo = newRepo();
  repo.registerCards([testCard('c1', 'Test Card')]);
  const preset = DISPLAY_PRESETS.find((p) => p.caseType === 'lit_cabinet');
  const displayCase = await repo.createDisplayCase(U, { ...preset, spaceId: 'space-1', name: 'Cabinet' });
  assert.equal(displayCase.slots.length, preset.shelfCount * preset.slotsPerShelf);
  assert.equal(repo.getState().allocations.length, 0);
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 2 });
  const slotId = displayCase.slots[0].id;
  await repo.placeCopies(U, { lotId: lot.id, displaySlotId: slotId, quantity: 1 });
  await rejects(repo.placeCopies(U, { lotId: lot.id, displaySlotId: slotId, quantity: 1 }), 'slot-occupied');
  await rejects(repo.placeCopies(U, { lotId: lot.id, displaySlotId: 'ghost', quantity: 1 }), 'not-found');
  assert.equal((await repo.getCaseAllocations(U, displayCase.id)).length, 1);
  await repo.setDisplayLights(U, displayCase.id, false);
  assert.equal((await repo.listSpaces())[0].displayCases[0].lightEnabled, false);
});

test('deleting a binder or box releases its copies back to free inventory', async () => {
  const repo = newRepo();
  repo.registerCards([testCard('c1', 'Test Card')]);
  const binder = await repo.createBinder(U, 'B', 'Nine');
  const box = await repo.createBox(U, 'Box', 'long-800', 800);
  const lot = await repo.addCopies(U, { cardId: 'c1', quantity: 4 });
  await repo.placeInBinderSlot(U, binder.id, 0, { lotId: lot.id, quantity: 1 });
  await repo.placeCopies(U, { lotId: lot.id, drawerId: box.drawers[0].id, quantity: 2 });
  assert.equal(repo.getState().lots[0].allocated, 3);
  await repo.deleteBinder(U, binder.id);
  assert.equal(repo.getState().lots[0].allocated, 2);
  await repo.deleteBox(box.id);
  assert.equal(repo.getState().lots[0].allocated, 0);
  assert.equal(repo.getState().lots[0].quantity, 4, 'cards are unassigned, never deleted');
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('rejected writes and failed batches leave the state object untouched', async () => {
  const repo = newRepo();
  repo.registerCards([testCard('c1', 'Test Card')]);
  const before = repo.getState();
  await rejects(repo.placeCopies(U, { lotId: 'missing', drawerId: 'x', quantity: 1 }), 'not-found');
  assert.equal(repo.getState(), before);
  await assert.rejects(repo.batch(async (r) => { await r.createBinder(U, 'Half done', 'Nine'); throw new Error('boom'); }), /boom/);
  assert.equal(repo.getState(), before);
  assert.equal(repo.getState().binders.length, 0);
});

test('subscribers hear one notification per commit, and one per batch', async () => {
  const repo = newRepo();
  let heard = 0;
  const unsubscribe = repo.subscribe(() => { heard++; });
  await repo.createBinder(U, 'One', 'Nine');
  assert.equal(heard, 1);
  await repo.batch(async (r) => { await r.createBinder(U, 'Two', 'Nine'); await r.createBinder(U, 'Three', 'Nine'); });
  assert.equal(heard, 2);
  assert.equal(repo.getState().binders.length, 3);
  unsubscribe();
  await repo.createBinder(U, 'Four', 'Nine');
  assert.equal(heard, 2);
});

test('state persists through injected storage; corrupt or foreign data falls back to empty', async () => {
  const storage = memoryStorage();
  const first = newRepo({ storage });
  const binder = await first.createBinder(U, 'Saved', 'Four', { accent: '#112233' });
  const second = newRepo({ storage });
  assert.equal(second.getState().binders[0].id, binder.id);
  assert.equal(second.getState().localMeta.binderAccent[binder.id], '#112233');
  assert.equal(newRepo({ storage, userId: 'someone-else' }).getState().binders.length, 0);
  storage.setItem('cardstacks-nook:room:v1', '{not json');
  assert.equal(selectIsEmpty(newRepo({ storage }).getState()), true);
  await first.createBinder(U, 'Saved again', 'Four');
  first.reset();
  assert.equal(selectIsEmpty(first.getState()), true);
  assert.equal(selectIsEmpty(newRepo({ storage }).getState()), true, 'reset also overwrites the persisted room');
});

test('a failing storage never breaks the room', async () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const repo = newRepo({ storage });
  await repo.createBinder(U, 'Still works', 'Nine');
  assert.equal(repo.getState().binders.length, 1);
  assert.match(String(repo.getPersistError()), /quota/);
});

test('binder colour is a local preference: set, change, clear, validate', async () => {
  const repo = newRepo();
  const binder = await repo.createBinder(U, 'B', 'Nine');
  assert.equal(repo.getState().localMeta.binderAccent[binder.id], undefined);
  await repo.setBinderAccent(binder.id, 'violet');
  assert.equal(repo.getState().localMeta.binderAccent[binder.id], 'violet');
  await repo.setBinderAccent(binder.id, '#AABBCC');
  assert.equal(repo.getState().localMeta.binderAccent[binder.id], '#aabbcc');
  await rejects(repo.setBinderAccent(binder.id, 'blurple'), 'invalid-color');
  await repo.setBinderAccent(binder.id, null);
  assert.equal(repo.getState().localMeta.binderAccent[binder.id], undefined);
});

test('cards must be in the catalog before they can be owned', async () => {
  const repo = newRepo();
  await rejects(repo.addCopies(U, { cardId: 'ghost', quantity: 1 }), 'unknown-card');
  repo.registerCards([testCard('c1', 'Known')]);
  await rejects(repo.addCopies(U, { cardId: 'c1', quantity: 0 }), 'invalid-quantity');
});

test('getSnapshot stays on the committed state while a batch is open, so renders mid-batch never see the draft', async () => {
  const repo = newRepo();
  const before = repo.getSnapshot();
  let during;
  await repo.batch(async (r) => {
    await r.createBinder(U, 'Draft only', 'Nine');
    during = { snapshot: repo.getSnapshot(), live: repo.getState() };
  });
  assert.equal(during.snapshot, before, 'snapshot is the old committed object');
  assert.notEqual(during.live, before, 'getState still exposes the draft to batch code');
  assert.equal(during.snapshot.binders.length, 0);
  assert.notEqual(repo.getSnapshot(), before);
  assert.equal(repo.getSnapshot().binders.length, 1);
});
