import test from 'node:test';
import assert from 'node:assert/strict';
import { drawableArtUrl } from './artUrl.js';

test('TCGplayer art goes through the relay; CORS-enabled art is used directly', () => {
  assert.equal(drawableArtUrl('https://images.pokemontcg.io/base1/4_hires.png'), 'https://images.pokemontcg.io/base1/4_hires.png');
  assert.equal(drawableArtUrl('https://tcgplayer-cdn.tcgplayer.com/product/1_800w.jpg'), '/card-art?u=https%3A%2F%2Ftcgplayer-cdn.tcgplayer.com%2Fproduct%2F1_800w.jpg');
  assert.equal(drawableArtUrl(''), null);
  assert.equal(drawableArtUrl(undefined), null);
  assert.equal(drawableArtUrl('not a url'), null);
});
