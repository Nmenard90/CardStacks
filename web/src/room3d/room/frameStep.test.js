import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameStep } from './frameStep.js';

test('a long pause before a move counts as one ordinary frame, so the move is animated, not a jump', () => {
  assert.equal(frameStep(3.2), 1 / 60);
  assert.equal(frameStep(0.3), 1 / 60);
});

test('frames while moving count in full, so a slow computer still finishes a move in about the same time', () => {
  assert.equal(frameStep(1 / 60), 1 / 60);
  assert.equal(frameStep(0.05), 0.05);
  assert.equal(frameStep(0.2), 0.1); // capped: one very slow frame doesn't leap most of the way
});
