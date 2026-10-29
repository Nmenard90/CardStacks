/**
 * Add-to-collection action tests — run with `node --test "src/data/*.test.js"`.
 * They pin what a collector sees after using the Add panel: things land on
 * shelves, cards land in pockets/drawers/slots, and failures leave no half-done state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomDataError, checkInvariants } from './contracts.js';
import { createLocalRepository } from './localRepository.js';
import { addBinder, addBox, addCardToBinderSlot, addCards, addDisplayCase, loadStarterCollection, searchCatalog } from './collectionActions.js';
import { selectIsEmpty } from './selectors.js';

const newRepo = () => createLocalRepository({ now: () => '2026-10-23T12:00:00.000Z' });

test('a new binder is placed on a shelf that is created on demand', async () => {
  const repo = newRepo();
  const binder = await addBinder(repo, { name: 'Trade', pocketSize: 'Nine' });
  const placed = repo.getState().binders.find((b) => b.id === binder.id);
  assert.ok(placed.storageUnitId, 'binder has a shelf');
  assert.equal(repo.getState().spaces[0].storageUnits.length, 1);
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('binders fill a shelf, then a second shelf is added', async () => {
  const repo = newRepo();
  for (let i = 0; i < 21; i++) await addBinder(repo, { name: `B${i}` }); // wood shelf holds 4 x 5 = 20
  assert.equal(repo.getState().spaces[0].storageUnits.length, 2);
  assert.ok(repo.getState().binders.every((b) => b.storageUnitId));
});

test('a new box is racked with its default drawer', async () => {
  const repo = newRepo();
  const box = await addBox(repo, { name: 'Bulk', presetIndex: 2 });
  const racked = repo.getState().boxes.find((b) => b.id === box.id);
  assert.ok(racked.storageUnitId);
  assert.equal(racked.drawers.length, 1);
});

test('cards go into the next free binder pockets', async () => {
  const repo = newRepo();
  const binder = await addBinder(repo, { name: 'B' });
  await addCards(repo, { cardId: 'base2-1', to: { binderId: binder.id } });
  await addCards(repo, { cardId: 'base2-2', quantity: 2, to: { binderId: binder.id } });
  const slots = repo.getState().binderSlots.filter((s) => s.binderId === binder.id).map((s) => s.slotIndex).sort();
  assert.deepEqual(slots, [0, 1, 2]);
  assert.equal(repo.getState().lots.reduce((n, l) => n + l.allocated, 0), 3);
  assert.deepEqual(checkInvariants(repo.getState()), []);
});

test('cards go into a box drawer and count there', async () => {
  const repo = newRepo();
  const box = await addBox(repo, { name: 'Bulk' });
  await addCards(repo, { cardId: 'base2-3', quantity: 4, to: { boxId: box.id } });
  assert.equal(repo.getState().boxes[0].drawers[0].cardCount, 4);
});

test('display cards fill free slots and a full case is reported, not half-applied', async () => {
  const repo = newRepo();
  await addDisplayCase(repo, { name: 'Pedestal', presetIndex: 4 }); // one slot
  await addCards(repo, { cardId: 'base2-1', to: { display: true } });
  const before = repo.getState();
  await assert.rejects(addCards(repo, { cardId: 'base2-2', to: { display: true } }), (e) => e instanceof RoomDataError && e.code === 'display-full');
  assert.equal(repo.getState(), before, 'failed add left state untouched');
});

test('an unknown card is rejected', async () => {
  await assert.rejects(addCards(newRepo(), { cardId: 'nope-1', to: {} }), (e) => e.code === 'unknown-card');
});

test('catalog search matches name and id, and lists everything when empty', () => {
  assert.ok(searchCatalog('flareon').every((c) => c.name.toLowerCase().includes('flareon')));
  assert.ok(searchCatalog('').length > 0);
  assert.equal(searchCatalog('zzzzzz').length, 0);
});

test('the starter collection fills an empty room consistently and refuses a non-empty one', async () => {
  const repo = newRepo();
  await loadStarterCollection(repo);
  const s = repo.getState();
  assert.equal(selectIsEmpty(s), false);
  assert.equal(s.binders.length, 3);
  assert.equal(s.boxes.length, 2);
  assert.ok(s.binders.every((b) => b.storageUnitId) && s.boxes.every((b) => b.storageUnitId));
  assert.deepEqual(checkInvariants(s), []);
  await assert.rejects(loadStarterCollection(repo), (e) => e.code === 'not-empty');
});

test('a card can be placed in an exact binder pocket, and a taken pocket is refused cleanly', async () => {
  const repo = newRepo();
  const binder = await addBinder(repo, { name: 'B' });
  await addCardToBinderSlot(repo, { cardId: 'base2-4', binderId: binder.id, slotIndex: 5 });
  assert.deepEqual(repo.getState().binderSlots.map((s) => s.slotIndex), [5]);
  const before = repo.getState();
  await assert.rejects(addCardToBinderSlot(repo, { cardId: 'base2-5', binderId: binder.id, slotIndex: 5 }), (e) => e.code === 'slot-occupied');
  assert.equal(repo.getState(), before, 'no stray copy or slot row was left behind');
  assert.deepEqual(checkInvariants(repo.getState()), []);
});
