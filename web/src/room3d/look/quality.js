/**
 * quality.js — render-budget tier for the Lamplight look. Pure, so it is unit-tested.
 *
 * "mobile" is a touch-first device or a small screen: lower pixel ratio, a smaller shadow map and no
 * extra point lights. Everything else is "desktop". The classic look ignores tiers and keeps its original settings.
 */
export const QUALITY = Object.freeze({
  desktop: Object.freeze({ tier: 'desktop', dpr: [1, 1.75], shadowMapSize: 1536, pointLights: 2, envResolution: 128 }),
  mobile: Object.freeze({ tier: 'mobile', dpr: [1, 1.5], shadowMapSize: 1024, pointLights: 0, envResolution: 64 }),
});

/** @param {{ coarse: boolean, shortSide: number }} device `coarse` = primary pointer is a finger; `shortSide` = the screen's shorter edge in CSS px */
export function pickQuality({ coarse, shortSide }) {
  return coarse || shortSide < 700 ? QUALITY.mobile : QUALITY.desktop;
}
