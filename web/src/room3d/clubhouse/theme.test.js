import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_KEYS, DEFAULT_COLORS, PRESETS, isHex, makeTheme, parseTheme, sanitizeColors, serializeTheme, tokenColor } from './theme.js';

test('every default colour is a valid hex', () => {
  for (const key of COLOR_KEYS) assert.ok(isHex(DEFAULT_COLORS[key]), key);
});

test('every preset only overrides known, valid tokens', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const [key, value] of Object.entries(preset.colors)) {
      assert.ok(COLOR_KEYS.includes(key), `${name}: unknown token ${key}`);
      assert.ok(isHex(value), `${name}.${key}`);
    }
  }
});

test('overrides win over the preset and defaults', () => {
  const theme = makeTheme({ preset: 'forest-lodge', overrides: { wall: '#112233' } });
  assert.equal(theme.colors.wall, '#112233');
  assert.equal(theme.colors.wallLow, PRESETS['forest-lodge'].colors.wallLow);
  assert.equal(theme.colors.oak, DEFAULT_COLORS.oak);
});

test('junk colours are dropped, never passed through', () => {
  assert.deepEqual(sanitizeColors({ wall: 'red', oak: '#abc', nope: '#112233', teal: '#0a1b2c' }), { teal: '#0A1B2C' });
  assert.deepEqual(sanitizeColors(null), {});
  assert.equal(makeTheme({ overrides: { wall: 'javascript:alert(1)' } }).colors.wall, DEFAULT_COLORS.wall);
});

test('a theme survives a save and load round trip, and only stores changes', () => {
  const theme = makeTheme({ preset: 'sunset-den', overrides: { sofa: '#334455' }, mode: 'night' });
  const saved = JSON.parse(serializeTheme(theme));
  assert.deepEqual(saved.overrides, { sofa: '#334455' });
  const loaded = parseTheme(serializeTheme(theme));
  assert.deepEqual(loaded.colors, theme.colors);
  assert.equal(loaded.mode, 'night');
});

test('bad saved data falls back to the default theme', () => {
  for (const bad of ['', '{', 'null', '{"v":9}', undefined]) assert.deepEqual(parseTheme(bad).colors, DEFAULT_COLORS);
});

test('token names and literal hex values both resolve', () => {
  assert.equal(tokenColor(DEFAULT_COLORS, 'coral'), DEFAULT_COLORS.coral);
  assert.equal(tokenColor(DEFAULT_COLORS, '#123456'), '#123456');
  assert.equal(tokenColor(DEFAULT_COLORS, 'not-a-token'), DEFAULT_COLORS.cream);
});
