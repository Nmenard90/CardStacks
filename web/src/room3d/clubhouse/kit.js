/**
 * kit.js — small procedural-geometry helpers and the theme-aware materials the Clubhouse furniture is built from.
 *
 * Plain Three.js: rounded boxes, cylinders, canvas textures. No models, no extra dependencies. `makeStyle(theme)` returns
 * the material factories a builder needs; every colour comes from the theme, so changing the theme recolours the room.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tokenColor } from './theme.js';

export { THREE };

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── meshes ────────────────────────────────────────────────────────────────
export function M(geometry, material, { cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  return mesh;
}
export const at = (obj, x = 0, y = 0, z = 0, ry = 0) => { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; };
export const rbox = (w, h, d, r, material, seg = 2) => M(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), material);
export const cyl = (rt, rb, h, material, seg = 24) => M(new THREE.CylinderGeometry(rt, rb, h, seg), material);
export const ball = (r, material, seg = 16) => M(new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.65))), material);
export const torus = (R, r, material, arc = Math.PI * 2, seg = 40) => M(new THREE.TorusGeometry(R, r, 8, Math.min(seg, 28), arc), material);
export const capsule = (r, len, material) => M(new THREE.CapsuleGeometry(r, len, 6, 16), material);
export const glow = (color, intensity = 1.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
export const glass = (color = '#dff7f4', opacity = 0.16) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false, envMapIntensity: 1.4 });

export function rrShape(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2; const y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}

// ── canvas textures ───────────────────────────────────────────────────────
export function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
export function rrectPath(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const CARD_NAMES = ['Sunny Sprout', 'Tide Hopper', 'Moss Rover', 'Honey Drift', 'Cloud Pup', 'Coral Cub', 'Pebble Pal', 'Breeze Finch', 'Mint Comet', 'Puddle Fox', 'Maple Mole', 'Kite Wren'];
const SKY = [['#7fe0d0', '#19b5a5'], ['#ffd27a', '#ff9f43'], ['#ff9e8f', '#ff6f61'], ['#b9f0d9', '#4fcf9f'], ['#bfe9ff', '#3aa7d9'], ['#ffe8a3', '#ffb93b']];
const cardTextures = new Map();

/** Abstract, invented card art (no characters, no franchise). Cached by seed: the same card is drawn once. */
export function cardTexture(seed) {
  if (cardTextures.has(seed)) return cardTextures.get(seed);
  const R = rng(seed * 977 + 13);
  const pair = SKY[seed % SKY.length];
  const tex = canvasTexture(256, 358, (ctx, w, h) => {
    ctx.fillStyle = '#fff6e3'; rrectPath(ctx, 0, 0, w, h, 18); ctx.fill();
    const g = ctx.createLinearGradient(0, 24, 0, 230); g.addColorStop(0, pair[0]); g.addColorStop(1, pair[1]);
    ctx.fillStyle = g; rrectPath(ctx, 16, 36, w - 32, 190, 12); ctx.fill();
    ctx.save(); rrectPath(ctx, 16, 36, w - 32, 190, 12); ctx.clip();
    const kind = seed % 6;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    if (kind === 0) { ctx.beginPath(); ctx.arc(128, 120, 52, 0, 7); ctx.fill(); for (let i = 0; i < 10; i++) { ctx.save(); ctx.translate(128, 120); ctx.rotate(i * 0.628); ctx.fillRect(-5, -92, 10, 24); ctx.restore(); } }
    if (kind === 1) { for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, 170 + i * 14); for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, 170 + i * 14 + Math.sin(x * 0.05 + i) * 9); ctx.lineTo(256, 240); ctx.lineTo(0, 240); ctx.fill(); } }
    if (kind === 2) { ctx.beginPath(); ctx.moveTo(60, 200); ctx.quadraticCurveTo(120, 40, 200, 150); ctx.quadraticCurveTo(150, 210, 60, 200); ctx.fill(); }
    if (kind === 3) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2; const rr = i % 2 ? 30 : 68; ctx.lineTo(128 + Math.cos(a) * rr, 125 + Math.sin(a) * rr); } ctx.fill(); }
    if (kind === 4) { ctx.beginPath(); ctx.arc(100, 140, 34, 0, 7); ctx.arc(138, 126, 42, 0, 7); ctx.arc(172, 146, 30, 0, 7); ctx.fill(); }
    if (kind === 5) { ctx.beginPath(); ctx.moveTo(20, 210); ctx.lineTo(100, 90); ctx.lineTo(150, 170); ctx.lineTo(190, 120); ctx.lineTo(240, 210); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; for (let i = 0; i < 6; i++) ctx.fillRect(R() * 220, 36 + R() * 150, 14 + R() * 30, 5);
    ctx.restore();
    const foil = ctx.createLinearGradient(0, 0, w, h); foil.addColorStop(0.2, 'rgba(255,255,255,0)'); foil.addColorStop(0.5, 'rgba(255,255,255,0.28)'); foil.addColorStop(0.8, 'rgba(255,255,255,0)');
    ctx.fillStyle = foil; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b3a3a'; ctx.font = '800 21px system-ui, sans-serif'; ctx.fillText(CARD_NAMES[seed % CARD_NAMES.length], 20, 26);
    ctx.fillStyle = 'rgba(27,58,58,0.18)'; for (let i = 0; i < 4; i++) ctx.fillRect(20, 246 + i * 18, 150 + R() * 70, 7);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = pair[1]; ctx.beginPath(); ctx.arc(30 + i * 26, 334, 8, 0, 7); ctx.fill(); }
  });
  cardTextures.set(seed, tex);
  return tex;
}
export const CARD_W = 0.36; export const CARD_H = 0.5;
export function card(seed, { w = CARD_W, h = CARD_H } = {}) {
  return rbox(w, h, 0.014, 0.014, new THREE.MeshPhysicalMaterial({ map: cardTexture(seed), roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25 }), 3);
}
/** A small canvas label (pill) used on drawers. */
export function labelTexture(text, bg, fg, w = 256, h = 96) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg; rrectPath(ctx, 2, 2, w - 4, h - 4, h / 2.2); ctx.fill();
    ctx.fillStyle = fg; ctx.font = `800 ${h * 0.5}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2 + 3);
  });
}

// ── theme-aware materials ─────────────────────────────────────────────────
let GRAIN; let WEAVE; let PAINT;
const noise = (size, draw, repeat) => canvasTexture(size, size, draw, { repeat, srgb: false });
export const grain = () => GRAIN ??= canvasTexture(512, 512, (c, W, H) => {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H); const R = rng(4);
  for (let i = 0; i < 140; i++) { c.strokeStyle = `rgba(110,60,15,${0.03 + R() * 0.07})`; c.lineWidth = 0.8 + R() * 2.4; const y = R() * H; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= W; x += 32) c.lineTo(x, y + Math.sin(x * 0.02 + i) * (2 + R() * 4)); c.stroke(); }
  for (let i = 0; i < 18; i++) { c.fillStyle = 'rgba(110,60,15,0.08)'; c.beginPath(); c.ellipse(R() * W, R() * H, 4 + R() * 8, 1.5 + R() * 2, 0, 0, 7); c.fill(); }
});
export const weave = () => WEAVE ??= noise(128, (c, W, H) => { c.fillStyle = '#808080'; c.fillRect(0, 0, W, H); for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) { c.fillStyle = ((x + y) / 4) % 2 ? '#9a9a9a' : '#6a6a6a'; c.fillRect(x, y, 4, 4); } }, [10, 10]);
export const paintNoise = () => PAINT ??= noise(256, (c, W, H) => { c.fillStyle = '#808080'; c.fillRect(0, 0, W, H); const R = rng(9); for (let i = 0; i < 5000; i++) { const v = 90 + R() * 80; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(R() * W, R() * H, 2, 2); } }, [3, 3]);

/**
 * Everything a furniture builder needs, bound to one theme. `tok('coral')` turns a layout prop into a colour;
 * `oak()`, `lac()`, `fab()` and `brass()` are the wood, painted, fabric and metal looks.
 */
export function makeStyle(theme, { lights = true } = {}) {
  const C = theme.colors; const night = theme.mode === 'night';
  const tok = (nameOrHex) => tokenColor(C, nameOrHex);
  return {
    C, night, lights, tok,
    oak: (tint = C.oak) => new THREE.MeshStandardMaterial({ color: tint, map: grain(), bumpMap: grain(), bumpScale: 0.9, roughness: 0.5 }),
    lac: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, bumpMap: paintNoise(), bumpScale: 0.25 }),
    fab: (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, bumpMap: weave(), bumpScale: 1.4 }),
    brass: () => new THREE.MeshStandardMaterial({ color: C.amber, metalness: 0.6, roughness: 0.35 }),
    plain: (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o }),
  };
}

/** Free every geometry, material and texture under `root`. Shared noise textures and card art are cached and kept. */
export function disposeTree(root) {
  const keep = new Set([GRAIN, WEAVE, PAINT, ...cardTextures.values()]);
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) {
      for (const v of Object.values(m)) if (v?.isTexture && !keep.has(v)) v.dispose();
      m.dispose?.();
    }
  });
}
