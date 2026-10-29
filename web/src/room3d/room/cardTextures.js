/**
 * cardTextures.js — shared, size-capped cache of card-face textures for binder pockets and the rolodex.
 *
 * A texture starts as a small placeholder (card name on parchment) so a card is
 * never blank while its artwork downloads, then the real image replaces it.
 * Only CACHE_LIMIT textures of each size are kept; the least recently used one is disposed,
 * which keeps an 800-card box from holding 800 canvases and GPU uploads.
 * A disposed texture that is still on screen simply re-uploads when drawn.
 */
import * as THREE from 'three';
import { drawableArtUrl } from './artUrl.js';

const SIZES = { small: [256, 358], large: [734, 1024] }; // 63 : 88, the real card ratio; large matches the hi-res source, so no detail is thrown away
// Kept apart because a large texture costs ~7 MB (canvas + GPU with mipmaps) against ~1 MB for a small one, and only the card being read needs one.
const CACHE_LIMIT = { small: 64, large: 6 };
const caches = { small: new Map(), large: new Map() }; // card key → texture, oldest first

/**
 * The art URL for a card: the large image (small textures simply downscale it, so the browser caches one file),
 * relayed when its CDN sends no CORS headers (see artUrl.js).
 */
const artUrl = (card) => drawableArtUrl(card.imageUrl || card.imageSmall);

function drawPlaceholder(ctx, card, [WIDTH, HEIGHT]) {
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = '#c9b88d';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, WIDTH - 8, HEIGHT - 8);
  ctx.fillStyle = '#4a4130';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(card.name ?? 'Card', WIDTH / 2, HEIGHT / 2, WIDTH - 30);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = '#7b6f55';
  ctx.fillText(card.number ? `#${card.number}` : '', WIDTH / 2, HEIGHT / 2 + 28);
}

/**
 * @param {{ id?: string, cardId?: string, name?: string, number?: string, imageUrl?: string, imageSmall?: string }} card
 * @param {'small'|'large'} [size] `large` uses the hi-res art, for the one card being read up close
 */
export function getCardTexture(card, size = 'small') {
  const [WIDTH, HEIGHT] = SIZES[size];
  const key = card.cardId ?? card.id;
  const cache = caches[size];
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // refresh recency

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  drawPlaceholder(ctx, card, SIZES[size]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const url = artUrl(card);
  if (url) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { ctx.drawImage(image, 0, 0, WIDTH, HEIGHT); texture.needsUpdate = true; };
    image.src = url;
  }

  cache.set(key, texture);
  while (cache.size > CACHE_LIMIT[size]) {
    const [oldKey, oldTexture] = cache.entries().next().value;
    cache.delete(oldKey);
    oldTexture.dispose();
  }
  return texture;
}
