/**
 * lamplightTextures.js — procedural surfaces for the Lamplight look: dark walnut floor, moss-green plaster over a
 * charcoal board wainscot, and the soft radial gradient used for baked light pools.
 *
 * Everything is drawn once on small canvases from a seeded generator, so the room looks identical on every load.
 * The floor is one 1024×512 tile that covers 2 m × 1 m (plus a half-size height map for the plank grooves); the
 * two walls are single-face textures. Total is a few MB against the classic floor's 2048² alone. The caller owns
 * the returned textures and must dispose them.
 */
import * as THREE from 'three';

/** mulberry32: tiny seeded PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { srgb = true, repeat, anisotropy = 4 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]); }
  tex.anisotropy = anisotropy;
  return tex;
}

const ROWS = 7;

/**
 * Plank layout shared by the colour and height passes so grooves line up with the colour exactly.
 * Planks run along x; each row has staggered joints and wraps seamlessly at the tile edge.
 */
function plankLayout(width, height, seed) {
  const rand = rng(seed);
  const rowH = height / ROWS;
  const planks = [];
  for (let row = 0; row < ROWS; row++) {
    let x = rand() * width;
    const start = x;
    while (x < start + width - 8) {
      const len = Math.min(width * (0.36 + rand() * 0.28), start + width - x);
      planks.push({ row, x, len, y: row * rowH, h: rowH, tone: rand(), grain: Math.floor(rand() * 1e6) });
      x += len;
    }
  }
  return { rowH, planks };
}

/** Draw `fn` at x and x − width so a plank crossing the tile edge wraps seamlessly. */
function wrapped(width, x, len, fn) {
  fn(x);
  if (x + len > width) fn(x - width);
}

/** @returns {{ map: THREE.CanvasTexture, bump: THREE.CanvasTexture }} Dark walnut planks: tile = 2 m × 1 m, wrapping. */
export function makeLamplightFloor() {
  const W = 1024; const H = 512;
  const { planks } = plankLayout(W, H, 7);
  const [color, ctx] = makeCanvas(W, H);
  ctx.fillStyle = '#1a100a';
  ctx.fillRect(0, 0, W, H);
  planks.forEach((p) => {
    const rand = rng(p.grain);
    // Walnut range: deep brown through warm reddish brown, one plank at a time.
    const r = 62 + p.tone * 30; const g = 38 + p.tone * 17; const b = 24 + p.tone * 9;
    wrapped(W, p.x, p.len, (x) => {
      const grad = ctx.createLinearGradient(x, 0, x + p.len, 0);
      grad.addColorStop(0, `rgb(${r - 8},${g - 5},${b - 3})`);
      grad.addColorStop(0.5, `rgb(${r + 6},${g + 3},${b + 1})`);
      grad.addColorStop(1, `rgb(${r - 6},${g - 4},${b - 2})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x, p.y + 1, p.len - 1.5, p.h - 2);
      for (let k = 0; k < 16; k++) { // wavy grain streaks
        const gy = p.y + 4 + rand() * (p.h - 8);
        ctx.strokeStyle = rand() > 0.35 ? `rgba(20,10,5,${0.1 + rand() * 0.16})` : `rgba(150,96,56,${0.05 + rand() * 0.08})`;
        ctx.lineWidth = 0.6 + rand() * 1.4;
        ctx.beginPath();
        const phase = rand() * 6; const amp = 0.6 + rand() * 1.8;
        ctx.moveTo(x, gy);
        for (let sx = 0; sx <= p.len; sx += 32) ctx.lineTo(x + sx, gy + Math.sin(sx * 0.02 + phase) * amp);
        ctx.stroke();
      }
      if (rand() > 0.82) { // the occasional knot
        const kx = x + p.len * (0.2 + rand() * 0.6); const ky = p.y + p.h * (0.3 + rand() * 0.4);
        ctx.fillStyle = 'rgba(16,8,4,0.35)';
        ctx.beginPath(); ctx.ellipse(kx, ky, 9 + rand() * 6, 4 + rand() * 3, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,214,160,0.07)'; // worn top bevel
      ctx.fillRect(x, p.y + 1, p.len - 1.5, 1.2);
      ctx.fillStyle = 'rgba(8,4,2,0.75)'; // joint at the plank's end
      ctx.fillRect(x + p.len - 2, p.y, 2, p.h);
    });
  });
  ctx.fillStyle = 'rgba(8,4,2,0.8)'; // gaps between rows
  for (let row = 0; row < ROWS; row++) ctx.fillRect(0, row * (H / ROWS) - 1, W, 2);

  const [height, hctx] = makeCanvas(W / 2, H / 2);
  hctx.fillStyle = '#9a9a9a';
  hctx.fillRect(0, 0, W / 2, H / 2);
  hctx.scale(0.5, 0.5);
  hctx.fillStyle = '#000';
  planks.forEach((p) => wrapped(W, p.x, p.len, (x) => hctx.fillRect(x + p.len - 3, p.y, 3, p.h)));
  for (let row = 0; row < ROWS; row++) hctx.fillRect(0, row * (H / ROWS) - 1.5, W, 3);

  return { map: toTexture(color, { repeat: [0.5, 1], anisotropy: 8 }), bump: toTexture(height, { srgb: false, repeat: [0.5, 1], anisotropy: 4 }) };
}

/**
 * Moss-green plaster over a charcoal board wainscot with a brass-dark rail.
 * @param {'back'|'left'} kind picks the face size so board lines keep a believable width on each wall
 */
export function makeLamplightWall(kind) {
  const W = kind === 'back' ? 1024 : 768; const H = 512;
  const rand = rng(kind === 'back' ? 21 : 33);
  const [c, ctx] = makeCanvas(W, H);
  const railY = H * 0.7; // wainscot top (the wall is 4 m tall: about 1.2 m of panelling)

  // Plaster: mossy base, soft mottling, fine speckle.
  ctx.fillStyle = kind === 'back' ? '#3b5a43' : '#35523d';
  ctx.fillRect(0, 0, W, railY);
  for (let i = 0; i < 520; i++) {
    const x = rand() * W; const y = rand() * railY; const r = 18 + rand() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rand() > 0.5;
    g.addColorStop(0, light ? `rgba(92,128,98,${0.035 + rand() * 0.04})` : `rgba(10,22,16,${0.05 + rand() * 0.05})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 3500; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(150,190,150,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(rand() * W, rand() * railY, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }

  // Wainscot: vertical boards, each a touch different.
  const boardW = kind === 'back' ? 14 : 12;
  for (let x = 0; x < W; x += boardW) {
    const t = rand();
    ctx.fillStyle = `rgb(${46 + t * 9},${48 + t * 9},${50 + t * 9})`;
    ctx.fillRect(x, railY, boardW, H - railY);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, railY, 1.4, H - railY);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(x + 1.4, railY, 1, H - railY);
    for (let k = 0; k < 3; k++) { // faint grain
      ctx.strokeStyle = `rgba(0,0,0,${0.06 + rand() * 0.06})`;
      ctx.lineWidth = 0.8;
      const gx = x + 3 + rand() * (boardW - 6);
      ctx.beginPath(); ctx.moveTo(gx, railY); ctx.lineTo(gx + (rand() - 0.5) * 3, H); ctx.stroke();
    }
  }
  // Rail: brass-dark cap with a shadow underneath and a sheen on top.
  ctx.fillStyle = '#6f5128'; ctx.fillRect(0, railY - 5, W, 7);
  ctx.fillStyle = 'rgba(255,215,150,0.35)'; ctx.fillRect(0, railY - 5, W, 1.5);
  const shade = ctx.createLinearGradient(0, railY + 2, 0, railY + 34);
  shade.addColorStop(0, 'rgba(0,0,0,0.5)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade; ctx.fillRect(0, railY + 2, W, 32);

  // Depth: darker under the ceiling and into the corners, so light reads as pooling rather than flat.
  const ceiling = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  ceiling.addColorStop(0, 'rgba(0,0,0,0.34)'); ceiling.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ceiling; ctx.fillRect(0, 0, W, H);
  const edges = ctx.createLinearGradient(0, 0, W, 0);
  edges.addColorStop(0, 'rgba(0,0,0,0.2)'); edges.addColorStop(0.18, 'rgba(0,0,0,0)');
  edges.addColorStop(0.82, 'rgba(0,0,0,0)'); edges.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = edges; ctx.fillRect(0, 0, W, H);

  return toTexture(c, { anisotropy: 4 });
}

/** A white radial falloff, tinted and added to the scene by LightPools. 128² is plenty for a soft gradient. */
export function makeLightPoolTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return toTexture(c, { srgb: false, anisotropy: 1 });
}
