/** normalizeFaceUVs: the front face must span exactly 0–1 in both directions. Run with `node --test "src/room/*.test.js"`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry } from 'three';
import { normalizeFaceUVs } from './cardUV.js';

test('UVs cover the whole card face once, whatever the card size', () => {
  const geometry = new BoxGeometry(0.58, 0.8, 0.018);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.58, uv.getY(i) * 0.8); // what RoundedBox produces: metres, not 0–1
  normalizeFaceUVs(geometry, 0.58, 0.8);
  const xs = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
  const ys = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`); // BoxGeometry positions are float32
  near(Math.min(...xs), 0); near(Math.max(...xs), 1);
  near(Math.min(...ys), 0); near(Math.max(...ys), 1);
});
