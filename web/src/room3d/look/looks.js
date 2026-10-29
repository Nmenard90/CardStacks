/**
 * looks.js — the room's visual themes, chosen once per page load from the URL.
 *
 *   ?look=classic     the original bright diorama, byte-for-byte the settings it always had
 *   ?look=lamplight   (default) the warm, dark collector's den — Milestone 1: surfaces, light and budget only
 *
 * A look only changes how the room is drawn: background and fog, renderer budget, lights, wall/floor surfaces,
 * trim colours, furniture material tints and label plates. Layout, furniture, data and interaction are shared.
 * To make classic the default again, flip the fallback in LOOK_NAME.
 */
import * as THREE from 'three';
import { pickQuality } from './quality.js';
import { CLUBHOUSE, THEME } from '../clubhouse/config.js';
import { grain } from '../clubhouse/kit.js';

const params = new URLSearchParams(window.location.search);
export const LOOK_NAME = params.get('look') === 'classic' ? 'classic' : 'lamplight';

const device = {
  coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  shortSide: Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768),
};
const quality = pickQuality(device);

const classic = {
  name: 'classic',
  background: '#d9eef3',
  fog: { color: '#d9eef3', near: 24, far: 50 },
  dpr: [1.35, 2],
  toneMapping: THREE.AgXToneMapping,
  exposure: 1.08,
  shadowType: THREE.PCFSoftShadowMap,
  shadowMapSize: 3072,
  softShadows: true, // drei PCSS: patches every material's shadow shader
  contactShadows: true, // an extra depth pass over a 10 m plane
  envResolution: 256,
  points: [],
  shell: {
    floor: { roughness: 0.68, bumpScale: 0.018 },
    wall: { back: { roughness: 0.92, bumpScale: 0.012 }, left: { roughness: 0.94, bumpScale: 0.012 } },
    baseboard: '#60402c', crown: ['#f1e2bd', '#ead7ad'], column: '#efe0bd',
    sign: { body: '#315e58', dots: ['#e3b23c', '#f3ead8', '#df6654'] },
    inlay: true,
  },
};

const lamplight = {
  name: 'lamplight',
  tier: quality.tier,
  background: '#100c09', // warm near-black; the room is lit from inside, not from a sky
  fog: { color: '#150f0b', near: 16, far: 36 },
  dpr: quality.dpr,
  toneMapping: THREE.ACESFilmicToneMapping, // richer shadows and warmer highlights than AgX for a dark room
  exposure: quality.tier === 'mobile' ? 1.55 : 1.18, // no point lights on mobile, so lift the whole image instead (free)
  shadowType: THREE.PCFSoftShadowMap,
  shadowMapSize: quality.shadowMapSize,
  softShadows: false,
  contactShadows: false, // the one shadow pass plus baked pools replace it
  envResolution: quality.envResolution,
  // Warm amber point lights standing in for lamps just out of frame. Capped by tier: every light costs every fragment.
  points: [
    { color: '#ffbb72', intensity: 3.6, position: [-0.4, 3.3, -1.2], distance: 6.5 },
    { color: '#ffa860', intensity: 3.2, position: [2.9, 3.2, -1.0], distance: 6 },
  ].slice(0, quality.pointLights),
  shell: {
    floor: { roughness: 0.64, bumpScale: 0.03 },
    wall: { back: { roughness: 0.88, bumpScale: 0.014 }, left: { roughness: 0.9, bumpScale: 0.014 } },
    baseboard: '#1c1410', crown: ['#2b2018', '#251b14'], column: '#3b2b1e',
    sign: { body: '#222c27', dots: ['#c58a3a', '#e9dcc0', '#b5603a'] },
    inlay: false,
  },
};

export const LOOKS = { classic, lamplight };
export const look = LOOKS[LOOK_NAME];

/**
 * Furniture tints for the GLB materials, applied to clones (the GLBs themselves are never touched).
 * Binder/box body colours are deliberately left alone so the collection's own colours stay true.
 */
const TINTS = {
  'Warm walnut': (m) => { m.color.set('#4d3b30'); m.roughness = 0.52; m.envMapIntensity = 0.6; },
  'Walnut shadow': (m) => { m.color.set('#332a23'); m.roughness = 0.62; m.envMapIntensity = 0.6; },
  'Display felt': (m) => { m.color.set('#5e7566'); m.roughness = 0.95; },
  'Satin brass': (m) => { m.color.set('#ffd7a0'); m.envMapIntensity = 1.25; },
};

/** In the Clubhouse room the app's furniture is dressed in the theme: oak frames, teal backs, amber brass. */
const CLUBHOUSE_TINTS = {
  'Warm walnut': (m) => { m.map = grain(); m.bumpMap = grain(); m.bumpScale = 0.9; m.color.set(THEME.colors.oak); m.roughness = 0.5; m.envMapIntensity = 0.5; },
  'Walnut shadow': (m) => { m.map = null; m.color.set(THEME.colors.tealDeep); m.roughness = 0.85; m.envMapIntensity = 0.4; },
  'Display felt': (m) => { m.map = null; m.color.set(THEME.colors.tealDeep); m.roughness = 0.9; },
  'Satin brass': (m) => { m.color.set(THEME.colors.amber); m.envMapIntensity = 1.0; },
};

/** Apply the active look's tint to a (cloned) GLB material. A no-op for classic. */
export function tuneForLook(material) {
  if (CLUBHOUSE) { CLUBHOUSE_TINTS[material.name]?.(material); return; }
  if (look.name === 'classic') return;
  TINTS[material.name]?.(material);
}

/** Label plate style for the binder spine / box label atlas. */
export const labelStyle = look.name === 'classic' ? 'classic' : 'catalog';
