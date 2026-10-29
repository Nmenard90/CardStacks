/**
 * artUrl.js — the URL the room loads a card image from, so WebGL is allowed to draw it.
 *
 * WebGL can only use cross-origin images served with CORS headers. pokemontcg.io sends them; TCGplayer's CDN (art for
 * TCGTracking sets) doesn't, so those images go through the site's own /card-art relay (web/cardArt.mjs), which only
 * relays these exact hosts.
 *
 * USED BY: room/cardTextures.js, textures.js
 */

/** Must match ART_HOSTS in web/cardArt.mjs. */
const RELAYED_HOSTS = new Set(['tcgplayer-cdn.tcgplayer.com', 'product-images.tcgplayer.com']);

/**
 * PURPOSE: A drawable URL for a card image.
 * @param {string|null|undefined} url  the image URL from the API
 * @return {string|null} the same URL, the relay URL for TCGplayer images, or null when there is no usable URL
 */
export function drawableArtUrl(url) {
  if (!url) return null;
  try {
    return RELAYED_HOSTS.has(new URL(url).hostname) ? `/card-art?u=${encodeURIComponent(url)}` : url;
  } catch {
    return null;
  }
}
