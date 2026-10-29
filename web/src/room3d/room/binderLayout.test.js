/** Binder page geometry. Run with `node --test "src/room/*.test.js"`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstFreeSlot, pageCount, pocketCenter, pocketsPerPage, visiblePages } from './binderLayout.js';

test('pocket sizes map to the real grids', () => {
  assert.deepEqual(['Four', 'Nine', 'Twelve'].map(pocketsPerPage), [4, 9, 12]);
  assert.equal(pocketsPerPage('mystery'), 9, 'unknown sizes fall back to nine');
});

test('pockets run row by row from the top-left and stay centred on the page', () => {
  const first = pocketCenter('Nine', 0);
  const last = pocketCenter('Nine', 8);
  assert.ok(first.x < 0 && first.y > 0 && last.x > 0 && last.y < 0);
  assert.ok(Math.abs(first.x + last.x) < 1e-9 && Math.abs(first.y + last.y) < 1e-9);
  assert.equal(pocketCenter('Nine', 4).x, 0); // middle pocket
  assert.ok(pocketCenter('Nine', 1).x > pocketCenter('Nine', 0).x);
  assert.ok(pocketCenter('Nine', 3).y < pocketCenter('Nine', 0).y);
});

test('an empty binder still offers a spread; a full page gains a blank one', () => {
  assert.equal(pageCount([], 'Nine'), 2);
  assert.equal(pageCount([0, 1, 2], 'Nine'), 2);
  assert.equal(pageCount([8], 'Nine'), 2); // page 0 full → page 1 is the blank one
  assert.equal(pageCount([9], 'Nine'), 4); // uses page 1 → blank page 2 → rounded to whole spreads
});

test('spreads start on an even page, narrow screens show one page', () => {
  assert.deepEqual(visiblePages(3, 6, true), [2, 3]);
  assert.deepEqual(visiblePages(3, 6, false), [3]);
  assert.deepEqual(visiblePages(5, 5, true), [4]);
});

test('the first free pocket fills gaps before extending', () => {
  assert.equal(firstFreeSlot([]), 0);
  assert.equal(firstFreeSlot([0, 1, 3]), 2);
  assert.equal(firstFreeSlot([0, 1, 2]), 3);
});
