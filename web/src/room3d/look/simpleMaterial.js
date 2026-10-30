/**
 * simpleMaterial.js — the one material the whole room is drawn with.
 *
 * PURPOSE
 *   The room has to run on any computer or phone, including a weak graphics chip or a browser drawing 3D on the
 *   processor. Realistic (physically based) materials work out light the expensive way for every pixel, and bump maps
 *   (the fine relief on wood, fabric and paint) add a third again: on the processor a full-size frame of the room took
 *   107 ms with both and 59 ms without, and the room's flat, cartoon look comes out the same at any distance the room
 *   is seen from (compared side by side; the wood keeps its grain colour). RoomMaterial is three's Lambert material
 *   (matte light, colour, pictures, glow, shadows) that also accepts the realistic material's settings (roughness,
 *   metalness, bumps, …) and ignores them, so furniture code can keep describing its finish.
 *
 * USED BY: every room builder (clubhouse/*, room/*, Room.jsx, CardRolodex.jsx); `<roomMaterial>` in JSX is registered
 *          with react-three-fiber in RoomScene.jsx. GLB furniture is converted with toRoomMaterial.
 */
import * as THREE from 'three';

/** Settings of the realistic material that don't apply here; accepted so they can still be passed and set. */
const IGNORED = { roughness: 1, metalness: 0, roughnessMap: null, metalnessMap: null, envMapIntensity: 1, clearcoat: 0, clearcoatRoughness: 0, transmission: 0, thickness: 0 };

export class RoomMaterial extends THREE.MeshLambertMaterial {
  constructor(parameters) {
    super();
    this.isRoomMaterial = true;
    Object.assign(this, IGNORED);
    if (parameters) this.setValues(parameters);
  }

  // Bump maps are accepted and dropped (see above). JSX props arrive one at a time through these too.
  get bumpMap() { return null; }
  set bumpMap(_ignored) { /* no bumps */ }
}

const KEEP = ['name', 'color', 'map', 'emissive', 'emissiveMap', 'emissiveIntensity', 'normalMap', 'normalScale', 'aoMap', 'aoMapIntensity',
  'alphaMap', 'transparent', 'opacity', 'alphaTest', 'side', 'depthWrite', 'depthTest', 'vertexColors', 'flatShading', 'toneMapped', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits'];

/**
 * PURPOSE: A RoomMaterial with the same colour, pictures and settings as a realistic material (the GLB furniture's);
 *          any other material is returned as it is.
 * @param {THREE.Material} material
 * @return {THREE.Material}
 */
export function toRoomMaterial(material) {
  if (!material?.isMeshStandardMaterial) return material;
  const out = new RoomMaterial();
  for (const key of KEEP) {
    const value = material[key];
    if (value?.isColor || value?.isVector2) out[key].copy(value);
    else if (value !== undefined) out[key] = value;
  }
  out.userData = { ...material.userData };
  return out;
}
