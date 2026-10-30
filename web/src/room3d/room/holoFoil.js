/**
 * holoFoil.js — a rainbow foil shimmer for holographic cards.
 *
 * `isHoloRarity` decides which cards get it (by the card's own rarity text, so plain "Rare" cards stay matte).
 * `applyHoloFoil` patches a card's material (look/simpleMaterial.js) in place: a rainbow that shifts with the viewing angle, plus a slow diagonal
 * glint, both limited to the artwork window. It adds no textures, no draw calls and no extra meshes.
 */

import { useEffect, useRef } from 'react';

const HOLO_WORDS = /holo|reverse|ultra|secret|illustration|special|hyper|rainbow|\b(?:ex|gx|v|vmax|vstar|vunion|break|prime|lv\.?x)\b/i;

/** @param {string|null|undefined} rarity the card's rarity text, e.g. "Rare Holo" */
export const isHoloRarity = (rarity) => typeof rarity === 'string' && HOLO_WORDS.test(rarity);

/**
 * @param {import('three').Material} material
 * @returns {{ uTime: { value: number }, uStrength: { value: number } }} uniforms the caller can drive each frame
 */
export function applyHoloFoil(material) {
  const uniforms = { uTime: { value: 0 }, uStrength: { value: 0.6 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uStrength = uniforms.uStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        // The artwork window of a card: inside the border, from just under the name bar to above the text box.
        vec2 q = vMapUv;
        float art = smoothstep(0.07, 0.10, q.x) * (1.0 - smoothstep(0.90, 0.93, q.x)) * smoothstep(0.50, 0.53, q.y) * (1.0 - smoothstep(0.87, 0.90, q.y));
        float angle = dot(normalize(vViewPosition), normal);
        float phase = q.x * 0.9 + q.y * 1.3 + angle * 1.8;
        vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.67)));
        float glint = smoothstep(0.10, 0.0, abs(fract(q.x * 0.7 - q.y * 0.7 + uTime * 0.12) - 0.5) - 0.38);
        // The rainbow is tinted by the artwork's own colour, so the picture still reads through the foil instead of washing out.
        totalEmissiveRadiance += (rainbow * (0.12 + 0.6 * diffuseColor.rgb) + glint * 0.25) * art * uStrength;
      }`);
  };
  material.customProgramCacheKey = () => 'holo-foil-v2';
  material.needsUpdate = true;
  return uniforms;
}

const REDUCED_MOTION = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;

/**
 * Foil for one card's material: attaches it when `enabled` and the card's rarity is holographic.
 * @param {string|null|undefined} rarity
 * @param {boolean} enabled false leaves the material untouched (the original nook)
 * @returns {{ materialRef: import('react').MutableRefObject<any>, drive: (elapsed: number, delta: number, strength: number) => void }}
 *   put `materialRef` on the card's roomMaterial and call `drive` every frame; the glint holds still under reduced motion
 */
export function useHoloFoil(rarity, enabled) {
  const materialRef = useRef(null);
  const foil = useRef(null);
  const holo = enabled && isHoloRarity(rarity);
  useEffect(() => { foil.current = holo && materialRef.current ? applyHoloFoil(materialRef.current) : null; }, [holo]);
  const drive = (elapsed, delta, strength) => {
    const u = foil.current;
    if (!u) return;
    if (!REDUCED_MOTION?.matches) u.uTime.value = elapsed;
    u.uStrength.value += (strength - u.uStrength.value) * (1 - Math.exp(-8 * delta));
  };
  return { materialRef, drive };
}
