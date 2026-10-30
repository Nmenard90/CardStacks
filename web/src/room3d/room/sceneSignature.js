/**
 * sceneSignature.js — a number that changes whenever anything visible in the room changes. Pure, so it is unit-tested.
 *
 * PURPOSE
 *   The room draws only when something changed (room/RenderOnChange.jsx). Comparing these numbers from one moment to
 *   the next answers "did anything change?" for the whole scene in well under a millisecond: `shape` covers every
 *   visible object's position, rotation and scale (what the shadows depend on), `look` adds materials (colour,
 *   opacity, picture), and viewSignature adds the camera.
 *
 * HOW IT WORKS
 *   Each value is rounded to 1/10000 and folded into a 32-bit hash. Moves smaller than that are invisible on screen, and
 *   rounding lets an easing camera count as "still" once it is close enough.
 */

/** Folds `value` into the running hash `h`. */
const mix = (h, value) => (Math.imul(h, 31) + Math.round(value * 1e4)) | 0;

function mixMaterial(h, m) {
  h = mix(mix(h, m.version), m.opacity);
  if (m.color) h = mix(mix(mix(h, m.color.r), m.color.g), m.color.b);
  if (m.emissive) h = mix(mix(mix(mix(h, m.emissive.r), m.emissive.g), m.emissive.b), m.emissiveIntensity);
  return mix(mix(h, m.map?.id ?? -1), m.map?.version ?? -1);
}

/**
 * PURPOSE: Signatures of what the scene contains: `shape` changes when anything visible moves, appears or disappears;
 *          `look` also changes when anything's colour, opacity or picture does.
 * @param {import('three').Object3D} root  the scene
 * @return {{ shape: number, look: number }}
 */
export function sceneSignature(root) {
  let h = 17; let looks = 17; let count = 0;
  root.traverseVisible((o) => {
    count += 1;
    const { position: p, quaternion: q, scale: s } = o;
    h = mix(mix(mix(h, p.x), p.y), p.z);
    h = mix(mix(mix(mix(h, q.x), q.y), q.z), q.w);
    h = mix(mix(mix(h, s.x), s.y), s.z);
    if (o.geometry) h = mix(h, o.geometry.id);
    if (o.isInstancedMesh) { h = mix(mix(h, o.count), o.instanceMatrix.version); looks = mix(looks, o.instanceColor?.version ?? -1); }
    const m = o.material;
    if (Array.isArray(m)) for (const one of m) looks = mixMaterial(looks, one);
    else if (m) looks = mixMaterial(looks, m);
  });
  const shape = mix(h, count);
  return { shape, look: mix(shape, looks) };
}

/**
 * PURPOSE: Signature of the view: the scene's signature plus where the camera is, where it looks, and the canvas.
 * @param {number} sceneSig  `look` from sceneSignature
 * @param {import('three').PerspectiveCamera} camera
 * @param {number[]} [extra]  anything else that changes the picture (canvas width, height, pixel ratio)
 * @return {number}
 */
export function viewSignature(sceneSig, camera, extra = []) {
  const { position: p, quaternion: q } = camera;
  let h = mix(mix(mix(sceneSig, p.x), p.y), p.z);
  h = mix(mix(mix(mix(h, q.x), q.y), q.z), q.w);
  h = mix(mix(h, camera.fov), camera.zoom);
  if (camera.view?.enabled) h = mix(mix(h, camera.view.offsetX), camera.view.offsetY);
  for (const value of extra) h = mix(h, value);
  return h;
}
