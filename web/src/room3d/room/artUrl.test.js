import test from 'node:test';
import assert from 'node:assert/strict';
import { artCandidates, drawableArtUrl, loadCardArt } from './artUrl.js';

test('a card tries its large art, then the small art', () => {
  assert.deepEqual(artCandidates({ imageUrl: 'https://images.pokemontcg.io/sm7/31_hires.png' }),
    ['https://images.pokemontcg.io/sm7/31_hires.png', 'https://images.pokemontcg.io/sm7/31.png']);
  assert.deepEqual(artCandidates({ imageUrl: 'https://cdn.tcgtracking.com/product/1_800w.jpg', imageSmall: 'https://cdn.tcgtracking.com/product/1_200w.jpg' }),
    ['/card-art?u=https%3A%2F%2Fcdn.tcgtracking.com%2Fproduct%2F1_800w.jpg', '/card-art?u=https%3A%2F%2Fcdn.tcgtracking.com%2Fproduct%2F1_200w.jpg']);
  assert.deepEqual(artCandidates({}), []);
  assert.deepEqual(artCandidates(null), []);
});

test('a failed picture falls back to the next one, then retries the list once', async () => {
  const tried = [];
  // Fails everything on the first pass; on the retry, the small image loads.
  class FakeImage {
    set src(url) { tried.push(url); queueMicrotask(() => (tried.length >= 4 && url.endsWith('small') ? this.onload() : this.onerror())); }
  }
  const loaded = await new Promise(resolve => loadCardArt(['large', 'small'], img => resolve(img), 1, FakeImage));
  assert.ok(loaded instanceof FakeImage);
  assert.deepEqual(tried, ['large', 'small', 'large', 'small']);
  // Gives up after the one retry: onLoad is never called and nothing more is tried.
  const tries = []
  class Broken { set src(url) { tries.push(url); queueMicrotask(() => this.onerror()) } }
  loadCardArt(['a'], () => assert.fail('nothing loads'), 1, Broken);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(tries, ['a', 'a']);
});

test('TCGplayer art goes through the relay; CORS-enabled art is used directly', () => {
  assert.equal(drawableArtUrl('https://images.pokemontcg.io/base1/4_hires.png'), 'https://images.pokemontcg.io/base1/4_hires.png');
  assert.equal(drawableArtUrl('https://tcgplayer-cdn.tcgplayer.com/product/1_800w.jpg'), '/card-art?u=https%3A%2F%2Ftcgplayer-cdn.tcgplayer.com%2Fproduct%2F1_800w.jpg');
  // TCGTracking's own CDN (where its API points art now) has no CORS headers either.
  assert.equal(drawableArtUrl('https://cdn.tcgtracking.com/product/712934_800w.jpg'), '/card-art?u=https%3A%2F%2Fcdn.tcgtracking.com%2Fproduct%2F712934_800w.jpg');
  assert.equal(drawableArtUrl(''), null);
  assert.equal(drawableArtUrl(undefined), null);
  assert.equal(drawableArtUrl('not a url'), null);
});
