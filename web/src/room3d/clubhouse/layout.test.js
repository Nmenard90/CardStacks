import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYOUT, PIECE_TYPES, ROOM, footprintBox, movePiece, parseLayout, removePiece, serializeLayout, snapValue, validateLayout } from './layout.js';

const clone = () => structuredClone(DEFAULT_LAYOUT);

test('the default layout is valid', () => {
  assert.deepEqual(validateLayout(DEFAULT_LAYOUT).map((e) => e.message), []);
});

test('every piece in the default layout uses a known type, and ids are unique', () => {
  for (const piece of DEFAULT_LAYOUT) assert.ok(PIECE_TYPES[piece.type], piece.type);
  assert.equal(new Set(DEFAULT_LAYOUT.map((p) => p.id)).size, DEFAULT_LAYOUT.length);
});

test('the three collection pieces are present exactly once and locked', () => {
  for (const type of ['storageRack', 'binderLibrary', 'displayCabinet']) {
    assert.equal(DEFAULT_LAYOUT.filter((p) => p.type === type).length, 1, type);
    assert.equal(PIECE_TYPES[type].locked, true);
  }
});

test('rotation turns a footprint: a desk on the left wall is deep along x and wide along z', () => {
  const box = footprintBox({ type: 'desk', x: -4.15, z: -1.95, rot: Math.PI / 2 });
  assert.ok(Math.abs(box.x0 - -4.5) < 1e-6 && Math.abs(box.x1 - -3.25) < 1e-6, `${box.x0}..${box.x1}`); // 0.7 deep plus the chair's 0.55
  assert.ok(Math.abs(box.z1 - box.z0 - 1.9) < 1e-6);
});

test('moving a piece onto another is refused and the layout is unchanged', () => {
  const layout = clone();
  const result = movePiece(layout, 'sofa', { x: -2.55, z: 2.05 });
  assert.equal(result.layout, layout);
  assert.ok(result.errors.some((e) => e.code === 'overlap'));
});

test('moving a piece out of the room is refused', () => {
  const result = movePiece(clone(), 'pouf', { x: 9 });
  assert.ok(result.errors.some((e) => e.code === 'out-of-room'));
});

test('a legal move snaps to the 5 cm grid', () => {
  const layout = clone();
  const result = movePiece(layout, 'pouf', { x: -1.27, z: 2.98 });
  assert.deepEqual(result.errors, []);
  const pouf = result.layout.find((p) => p.id === 'pouf');
  assert.equal(pouf.x, snapValue(-1.27)); assert.equal(pouf.x, -1.25); assert.equal(pouf.z, 3);
  assert.equal(layout.find((p) => p.id === 'pouf').x, -1.3, 'the original layout is not mutated');
});

test('a wall piece cannot cover the window', () => {
  const result = movePiece(clone(), 'left-print-1', { z: 0.1 });
  assert.ok(result.errors.some((e) => e.code === 'blocks-window'));
});

test('wall pieces cannot overlap each other', () => {
  const result = movePiece(clone(), 'back-print-2', { x: -3.4 });
  assert.ok(result.errors.some((e) => e.code === 'wall-overlap'));
});

test('collection furniture cannot be removed, other furniture can', () => {
  for (const id of ['storage-rack', 'binder-library', 'display-cabinet']) assert.equal(removePiece(DEFAULT_LAYOUT, id).errors[0].code, 'locked');
  const removed = removePiece(DEFAULT_LAYOUT, 'sofa');
  assert.deepEqual(removed.errors, []);
  assert.equal(removed.layout.some((p) => p.id === 'sofa'), false);
  assert.deepEqual(validateLayout(removed.layout), []);
});

test('flat pieces such as rugs never collide', () => {
  const result = movePiece(clone(), 'rug', { x: -3.1, z: 0.35 }); // directly under the dog bed
  assert.deepEqual(result.errors, []);
});

test('a layout survives a save and load round trip', () => {
  assert.deepEqual(parseLayout(serializeLayout(DEFAULT_LAYOUT)), DEFAULT_LAYOUT.map((p) => ({ ...p })));
});

test('bad or hostile saved layouts fall back to the default', () => {
  for (const bad of ['', '{', 'null', '{"v":2,"pieces":[]}', '{"v":1,"pieces":"x"}', undefined]) assert.equal(parseLayout(bad), DEFAULT_LAYOUT);
  const missingCollection = JSON.stringify({ v: 1, pieces: [{ id: 'a', type: 'sofa', x: 0, z: 0 }] });
  assert.equal(parseLayout(missingCollection), DEFAULT_LAYOUT);
  const unknown = JSON.parse(serializeLayout(DEFAULT_LAYOUT)); unknown.pieces.push({ id: 'evil', type: 'rocket', x: 0, z: 0 });
  assert.equal(parseLayout(unknown).some((p) => p.id === 'evil'), false);
});

test('the room is the size the furniture was designed for', () => {
  assert.equal(ROOM.x1 - ROOM.x0, ROOM.w); assert.equal(ROOM.z1 - ROOM.z0, ROOM.d);
});
