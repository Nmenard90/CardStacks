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
const RELAYED_HOSTS = new Set(['tcgplayer-cdn.tcgplayer.com', 'product-images.tcgplayer.com', 'cdn.tcgtracking.com']);

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

/** pokemontcg.io's small image for a hi-res one ("…/31_hires.png" → "…/31.png"); null for anything else. */
function smallFromHires(url) {
  return typeof url === 'string' && /_hires\.\w+$/.test(url) ? url.replace(/_hires(\.\w+)$/, '$1') : null;
}

/**
 * PURPOSE: The drawable URLs to try for a card, best first: the large art, then the small one. pokemontcg.io's hi-res
 *   images sometimes fail (HTTP 503) while the small ones still load, and one failed picture used to leave the card
 *   as a blank placeholder for good.
 * @param {{ imageUrl?: string|null, imageSmall?: string|null }|null|undefined} card
 * @return {string[]}
 */
export function artCandidates(card) {
  const raw = [card?.imageUrl, card?.imageSmall, smallFromHires(card?.imageUrl)];
  return [...new Set(raw.map(drawableArtUrl).filter(Boolean))];
}

/**
 * PURPOSE: Loads the first of `urls` that works and hands it to `onLoad`. When every one fails, tries the list once
 *   more after `retryMs` (the art CDNs' failures are usually brief), then gives up and the placeholder stays.
 * @param {string[]} urls  from artCandidates
 * @param {(image: HTMLImageElement) => void} onLoad
 * @param {number} [retryMs]
 * @param {typeof Image} [ImageImpl]  injected in tests
 */
export function loadCardArt(urls, onLoad, retryMs = 4000, ImageImpl = globalThis.Image) {
  let index = 0;
  let retried = false;
  const tryNext = () => {
    if (index >= urls.length) {
      if (retried || urls.length === 0) return;
      retried = true;
      index = 0;
      setTimeout(tryNext, retryMs);
      return;
    }
    const image = new ImageImpl();
    image.crossOrigin = 'anonymous';
    image.onload = () => onLoad(image);
    image.onerror = () => { index += 1; tryNext(); };
    image.src = urls[index];
  };
  tryNext();
}
