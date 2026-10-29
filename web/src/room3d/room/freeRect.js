/**
 * freeRect.js — the part of the screen the open panels leave free.
 *
 * Measured from the page itself, so it is right at any size or layout: the best empty rectangle that overlaps
 * none of the open panels and starts under the Back button / sync chip. The camera rig and the open binder both fit to it.
 * Coordinates are relative to the room's stage (.room3d-stage), which sits below the site header, not the window.
 *
 * USED BY: App.jsx (FixedCameraRig), room/BinderBook.jsx
 */

const MIN_SIDE = 40; // px; anything thinner is not a place to put a subject

/**
 * @param {number} width   stage (canvas) width in px
 * @param {number} height  stage (canvas) height in px
 * @param {number} [aspect] width / height of the thing to place; when given, the rectangle that lets it show largest wins,
 *                          otherwise the rectangle with the most area
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function freeRect(width, height, aspect = 0) {
  const origin = document.querySelector('.room3d-stage')?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const local = (el) => { const r = el.getBoundingClientRect(); return { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top, width: r.width, height: r.height }; };
  let under = 0; // the floating Back button and sync chip sit over the scene, so the free area starts below them
  for (const el of document.querySelectorAll('.room3d-stage .back-btn, .room3d-stage .sync-chip')) {
    const r = local(el);
    if (r.width > 0 && r.left < width / 2) under = Math.max(under, r.bottom);
  }
  const top = Math.min(under, height * 0.3);
  const whole = { x: 0, y: top, w: width, h: height - top };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const boxes = [];
  for (const el of document.querySelectorAll('.room3d-stage :is(.item-panel, .zone-picker, .view-bar, .hud, .zone-nav, .add-fab)')) {
    const r = local(el);
    if (r.width >= 1 && r.height >= 1) boxes.push(r);
  }
  if (!boxes.length) return whole;

  // Every empty rectangle worth considering has its edges on the screen edges or on a panel edge.
  const xs = [...new Set([0, width, ...boxes.flatMap((b) => [clamp(b.left, 0, width), clamp(b.right, 0, width)])])].sort((a, b) => a - b);
  const ys = [...new Set([top, height, ...boxes.flatMap((b) => [clamp(b.top, top, height), clamp(b.bottom, top, height)])])].sort((a, b) => a - b);
  let best = null, bestScore = 0;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    const w = xs[j] - xs[i];
    if (w < MIN_SIDE) continue;
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      const h = ys[l] - ys[k];
      if (h < MIN_SIDE) continue;
      const score = aspect ? Math.min(w, h * aspect) : w * h;
      if (score <= bestScore) continue;
      if (boxes.some((b) => b.left < xs[j] && b.right > xs[i] && b.top < ys[l] && b.bottom > ys[k])) continue;
      best = { x: xs[i], y: ys[k], w, h }; bestScore = score;
    }
  }
  return best ?? whole;
}
