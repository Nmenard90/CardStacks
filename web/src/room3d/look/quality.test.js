/** Quality tier selection. Run with `node --test "src/look/*.test.js"`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY, pickQuality } from './quality.js';

test('touch devices and small screens get the mobile budget', () => {
  assert.equal(pickQuality({ coarse: true, shortSide: 1080 }), QUALITY.mobile);
  assert.equal(pickQuality({ coarse: false, shortSide: 390 }), QUALITY.mobile);
});

test('no tier pays for point lights', () => {
  assert.equal(QUALITY.mobile.pointLights, 0);
  assert.equal(QUALITY.desktop.pointLights, 0);
});

test('desktops get the desktop budget', () => {
  assert.equal(pickQuality({ coarse: false, shortSide: 900 }), QUALITY.desktop);
});

test('the mobile budget is strictly cheaper than desktop', () => {
  assert.ok(QUALITY.mobile.dpr[1] < QUALITY.desktop.dpr[1]);
  assert.ok(QUALITY.mobile.shadowMapSize < QUALITY.desktop.shadowMapSize);
});
