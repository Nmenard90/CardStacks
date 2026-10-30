/**
 * quality.js — render-budget tier for the Lamplight look. Pure, so it is unit-tested.
 *
 * "mobile" is a touch-first device or a small screen: lower pixel ratio and a smaller shadow map. Everything else is
 * "desktop". Neither has point lights: each one adds to the cost of every lit pixel, and the room has to run on any
 * computer or phone, including a browser drawing 3D on the CPU. The classic look ignores tiers.
 */
export const QUALITY = Object.freeze({
  desktop: Object.freeze({ tier: 'desktop', dpr: [1, 1.75], shadowMapSize: 1536, pointLights: 0, envResolution: 128 }),
  mobile: Object.freeze({ tier: 'mobile', dpr: [1, 1.5], shadowMapSize: 1024, pointLights: 0, envResolution: 64 }),
});

/** @param {{ coarse: boolean, shortSide: number }} device `coarse` = primary pointer is a finger; `shortSide` = the screen's shorter edge in CSS px */
export function pickQuality({ coarse, shortSide }) {
  return coarse || shortSide < 700 ? QUALITY.mobile : QUALITY.desktop;
}
