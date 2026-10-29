/**
 * config.js — switches and settings for the Clubhouse room, chosen once per page load from the URL.
 *
 *   ?theme=forest-lodge        a preset from theme.js (teal-oak, forest-lodge, sunset-den)
 *   ?time=night                the evening version of the same room
 *
 * Also holds the Clubhouse's camera positions and renderer budget. The original nook's own settings live in look/looks.js.
 */
import * as THREE from 'three';
import { pickQuality } from '../look/quality.js';
import { makeTheme } from './theme.js';

const params = new URLSearchParams(window.location.search);

/** The Clubhouse is the room CardStacks ships; the original nook's look switches in Room.jsx / looks.js read this. */
export const CLUBHOUSE = true;
export const THEME = makeTheme({ preset: params.get('theme') ?? 'teal-oak', mode: params.get('time') === 'night' ? 'night' : 'day' });

const device = {
  coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  shortSide: Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 768),
};
export const QUALITY = pickQuality(device);

/**
 * The most pixels the room draws per frame (about 1920×1250). A big monitor or a zoomed-out page would otherwise ask
 * for 5 million or more, several times the work for no visible gain; the pixel ratio is lowered to stay under it.
 */
const MAX_PIXELS = 2_400_000;
const pixelCap = Math.sqrt(MAX_PIXELS / Math.max(1, window.innerWidth * window.innerHeight));
const cappedDpr = [Math.min(QUALITY.dpr[0], pixelCap), Math.max(0.5, Math.min(QUALITY.dpr[1], pixelCap))];

/** Renderer settings: the room is lit like a bright, warm afternoon, so a neutral tone map keeps the saturated colours from washing out. */
export const CANVAS = {
  background: THEME.mode === 'night' ? '#10303a' : '#A89E90',
  dpr: cappedDpr,
  toneMapping: THREE.NeutralToneMapping,
  exposure: 0.88,
  shadowType: THREE.PCFSoftShadowMap,
  shadowMapSize: QUALITY.shadowMapSize,
};

export const DEFAULT_CAM = { pos: [8.3, 5.8, 8.9], target: [-1.1, 1.2, -0.2] };

/** Camera positions when a zone of the collection wall is opened. Labels match the original nook so the UI copy is unchanged. */
export const HOTSPOTS = {
  storage: { label: 'Bulk Storage', camPos: [-1.2, 2.5, 4.4], camTarget: [-3.1, 1.3, -3.1] },
  binders: { label: 'Binder Library', camPos: [1.6, 2.6, 5.0], camTarget: [0.0, 1.4, -3.1] },
  display: { label: 'Display Cabinet', camPos: [5.6, 2.5, 3.6], camTarget: [2.62, 1.3, -3.1] },
  explore: { label: 'Explore', camPos: [0.6, 2.0, 0.2], camTarget: [-4.5, 2.0, 0.1] }, // the window: stand in the room and look out at the garden
};
