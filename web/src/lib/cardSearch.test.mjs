/** Tests for lib/cardSearch.ts (Node strips the types). Run: npm run test:lib */
import assert from 'node:assert/strict'
import test from 'node:test'
import { newestReleasedSet } from './cardSearch.ts'

const set = (id, releaseDate) => ({ id, releaseDate })

test('opens on the newest set that is already out, not one announced for later', () => {
  const sets = [set('old', '2026/08/01'), set('current', '2026-10-17'), set('upcoming', '2026-11-06')]
  assert.equal(newestReleasedSet(sets, '2026-10-29').id, 'current')
})

test('a set released today counts as out', () => {
  assert.equal(newestReleasedSet([set('a', '2026-10-01'), set('b', '2026-10-29')], '2026-10-29').id, 'b')
})

test('mixes "YYYY/MM/DD" and "YYYY-MM-DD" dates correctly', () => {
  assert.equal(newestReleasedSet([set('slash', '2026/10/20'), set('dash', '2026-10-10')], '2026-10-29').id, 'slash')
})

test('with nothing released yet, falls back to the newest set', () => {
  assert.equal(newestReleasedSet([set('a', '2027-01-01'), set('b', '2027-02-01')], '2026-10-29').id, 'b')
})
