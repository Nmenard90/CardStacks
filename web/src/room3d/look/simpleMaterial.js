/**
 * simpleMaterial.js — one material model for the whole room.
 *
 * MeshPhysicalMaterial (clearcoat, transmission) costs several times what MeshStandardMaterial does for every pixel it
 * covers, and transmission draws the whole scene a second time. On a phone, or a browser drawing 3D on the CPU, that
 * is the difference between smooth and frozen, and the room's look doesn't depend on either. So physical materials,
 * including the ones the GLB furniture brings, become standard ones with the same colour, maps and finish.
 */
import * as THREE from 'three';

const KEEP = ['name', 'color', 'map', 'roughness', 'roughnessMap', 'metalness', 'metalnessMap', 'normalMap', 'normalScale', 'bumpMap', 'bumpScale',
  'emissive', 'emissiveMap', 'emissiveIntensity', 'aoMap', 'aoMapIntensity', 'envMapIntensity', 'transparent', 'opacity', 'alphaMap', 'alphaTest',
  'side', 'depthWrite', 'depthTest', 'vertexColors', 'flatShading', 'toneMapped', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits'];

/**
 * PURPOSE: A MeshStandardMaterial copy of a physical material; any other material is returned as it is.
 * @param {THREE.Material} material
 * @return {THREE.Material}
 */
export function asStandard(material) {
  if (!material?.isMeshPhysicalMaterial) return material;
  const out = new THREE.MeshStandardMaterial();
  for (const key of KEEP) {
    const value = material[key];
    if (value?.isColor || value?.isVector2) out[key].copy(value);
    else if (value !== undefined) out[key] = value;
  }
  out.userData = { ...material.userData };
  return out;
}
