/**
 * collection.js — the Clubhouse look for the collection furniture: card boxes and the display case.
 *
 * Card boxes: real card storage boxes are long and skinny (about 15 × 3 × 4 in) and are shelved end-out. Each container
 * the app draws (one per box in the collection) becomes a row of 5 end-out boxes, so the shelf reads as a wall of
 * card boxes while keeping the app's cell sizes, instancing, picking and label atlas. Colour comes from the lid, tinted
 * per container, exactly as before.
 *
 * Display case: a slim oak and glass vitrine with a closed cupboard below, in place of the old chunky cabinet. It is
 * built facing local +z; Room.jsx turns it to face the same way the cabinet GLB did.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THREE, M, at, rbox, cyl, ball, glass, glow, disposeTree, makeStyle } from './kit.js';
import { MaterialPool, mergeStatic } from './merge.js';
import { RoomMaterial } from '../look/simpleMaterial.js';

// ── card boxes ────────────────────────────────────────────────────────────
const BOX = { L: 0.62, W: 0.125, bodyH: 0.16, lidH: 0.055, overlap: 0.035 }; // a 15 × 3 × 4 in box at 0.0415 m per inch
const PITCH_Y = BOX.bodyH - BOX.overlap + BOX.lidH; // one box on top of the next: body plus the part of the lid above it
const ACROSS = 5; const HIGH = 1; const GAP = 0.136; // one row per container; the shelf stacks containers by level
const BASE_Y = -0.29; // the block's bottom, relative to where ShelfUnit places a container (centre of the old bin)
const LID_ORIGIN = 0.255; // ShelfUnit places the lid instance this far above the body instance
const FRONT_Z = 0; // ShelfUnit already places each container at z = -0.03; the long axis runs along z so the short ends face the room (-z)

const slab = (w, h, d, r, x, y, z) => { const g = new RoundedBoxGeometry(w, h, d, 2, r); g.translate(x, y, z); return g; };

/** Replacement parts for ShelfUnit's box instances, drawn in the theme's colours. Returns { parts, spec, dispose }. */
export function makeCardBoxParts(theme) {
  const C = theme.colors;
  const bodies = []; const lids = [];
  for (let iy = 0; iy < HIGH; iy++) for (let ix = 0; ix < ACROSS; ix++) {
    const x = (ix - (ACROSS - 1) / 2) * GAP; const bottom = BASE_Y + iy * PITCH_Y;
    bodies.push(slab(BOX.W - 0.004, BOX.bodyH, BOX.L - 0.004, 0.012, x, bottom + BOX.bodyH / 2, FRONT_Z));
    lids.push(slab(BOX.W, BOX.lidH, BOX.L, 0.012, x, bottom + BOX.bodyH - BOX.overlap + BOX.lidH / 2 - LID_ORIGIN, FRONT_Z));
  }
  const parts = {
    boxBody: { geometry: mergeGeometries(bodies, false), material: new RoomMaterial({ color: C.cream, roughness: 0.62 }) },
    boxLid: { geometry: mergeGeometries(lids, false), material: new RoomMaterial({ color: '#ffffff', roughness: 0.55 }) },
    boxPlate: { geometry: slab(0.54, 0.135, 0.012, 0.004, 0, 0, -0.018), material: new RoomMaterial({ color: '#F6EEDB', roughness: 0.6 }) },
    boxHandle: { geometry: slab(0.2, 0.014, 0.014, 0.005, 0, 0, 0), material: new RoomMaterial({ color: C.amber, metalness: 0.6, roughness: 0.35 }) },
  };
  bodies.forEach((g) => g.dispose()); lids.forEach((g) => g.dispose());
  const spec = { labelZ: -0.357, labelW: 0.5, labelH: 0.115, labelDy: BASE_Y + 0.09, handleDy: BASE_Y + 0.02 }; // plate on the body front, just above the shelf
  return { parts, spec, dispose: () => Object.values(parts).forEach((p) => { p.geometry.dispose(); p.material.dispose(); }) };
}

// ── display case ──────────────────────────────────────────────────────────
/** Shelf heights inside the vitrine, bottom to top, for placing the cards that stand on them. */
export const VITRINE = Object.freeze({ width: 1.3, height: 3.3, depth: 0.4, tiers: [0.84, 1.66, 2.48] });

export function buildVitrine(theme) {
  const S = makeStyle(theme, { lights: false });
  const { C, oak, lac, brass } = S; const wood = oak(); const dark = oak(C.oakDark); const brassM = brass();
  const { width: W, height: H, depth: D } = VITRINE;
  const g = new THREE.Group(); const base = 0.62; // closed cupboard below the glass
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => { const leg = cyl(0.026, 0.014, 0.2, dark, 12); leg.position.set(sx * (W / 2 - 0.1), 0.1, sz * (D / 2 - 0.08)); g.add(leg); }));
  g.add(at(rbox(W, base, D, 0.02, wood), 0, 0.2 + base / 2, 0));
  [-1, 1].forEach((s) => { g.add(at(rbox(W / 2 - 0.05, base - 0.1, 0.02, 0.01, lac(C.cream)), s * (W / 4), 0.2 + base / 2, D / 2 + 0.003)); g.add(at(ball(0.022, brassM, 10), s * 0.07, 0.2 + base / 2, D / 2 + 0.025)); });
  const top = 0.2 + base; const ch = H - top - 0.06;
  [-1, 1].forEach((s) => [-1, 1].forEach((z) => g.add(at(rbox(0.035, ch, 0.035, 0.01, wood), s * (W / 2 - 0.02), top + ch / 2, z * (D / 2 - 0.02)))));
  g.add(at(rbox(W + 0.04, 0.06, D + 0.04, 0.025, wood), 0, H - 0.03, 0));
  g.add(at(rbox(W - 0.04, 0.02, D - 0.04, 0.01, wood), 0, top + 0.01, 0));
  g.add(at(rbox(W - 0.06, ch - 0.02, 0.015, 0.006, lac(C.tealDeep)), 0, top + ch / 2, -D / 2 + 0.02)); // a deep back, so card art is the brightest thing
  [-1, 1].forEach((s) => { const side = M(new THREE.PlaneGeometry(D - 0.04, ch - 0.02), glass('#e9fffb', 0.06), { cast: false }); side.rotation.y = Math.PI / 2; side.position.set(s * (W / 2 - 0.02), top + ch / 2, 0); g.add(side); });
  const front = M(new THREE.PlaneGeometry(W - 0.07, ch - 0.02), glass('#e9fffb', 0.06), { cast: false }); front.position.set(0, top + ch / 2, D / 2 - 0.01); g.add(front);
  g.add(at(rbox(0.014, 0.5, 0.02, 0.006, brassM), W / 2 - 0.09, top + ch / 2, D / 2 + 0.002));
  VITRINE.tiers.forEach((y, i) => {
    if (i > 0) { const gl = M(new THREE.BoxGeometry(W - 0.08, 0.012, D - 0.06), glass('#dff5ef', 0.18), { cast: false }); gl.position.set(0, y, 0); g.add(gl); }
    g.add(at(rbox(W - 0.14, 0.01, 0.014, 0.004, glow(C.amber, 1.3)), 0, Math.min(y + 0.78, H - 0.1), D / 2 - 0.05)); // an amber light strip under the shelf above each tier
  });
  mergeStatic(g, new MaterialPool());
  // The cards stand behind the glass: it stays visible but must not take the pointer ray before the card under it
  // does (the same rule as the original cabinet's museum glass in Room.jsx).
  g.traverse((o) => { if (o.isMesh && o.material?.transparent) o.raycast = () => {}; });
  const faceBackWall = new THREE.Group(); g.rotation.y = Math.PI; faceBackWall.add(g); // the cabinet GLB faced local -z: do the same
  return Object.assign(faceBackWall, { dispose: () => disposeTree(faceBackWall) });
}
