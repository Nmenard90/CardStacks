/**
 * LightPools.jsx — baked amber light pools on the back wall, left wall and floor in front of each furniture zone.
 *
 * They are flat textured planes merged into ONE mesh (one 128² texture, additive, no depth writes, no raycasting): the look of
 * lamplight pooling on surfaces without the per-fragment cost of more real lights. They are light, not props —
 * there is no geometry here beyond the planes. Rendered by the Lamplight look only.
 */
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeLightPoolTexture } from './lamplightTextures.js';

// Matches the room's constants in Room.jsx (8 × 6 × 4, wall 0.18) and the zone hotspots in HOTSPOTS.
const BACK_Z = -3 + 0.09 + 0.01;
const LEFT_X = -4 + 0.09 + 0.01;
const POOLS = [
  { name: 'binders-wall', plane: 'back', x: -0.45, y: 2.35, size: [3.6, 2.7], opacity: 0.34 },
  { name: 'display-wall', plane: 'back', x: 2.65, y: 2.2, size: [3.2, 2.6], opacity: 0.3 },
  { name: 'storage-wall', plane: 'left', z: 1.25, y: 2.0, size: [3.4, 2.6], opacity: 0.26 },
  { name: 'binders-floor', plane: 'floor', x: -0.45, z: -1.45, size: [3.4, 2.6], opacity: 0.12 },
  { name: 'display-floor', plane: 'floor', x: 2.65, z: -1.45, size: [3.0, 2.4], opacity: 0.11 },
  { name: 'storage-floor', plane: 'floor', x: -2.6, z: 1.25, size: [2.8, 2.8], opacity: 0.1 },
];

/** One merged geometry for every pool: a single draw call. Each pool's strength rides in its vertex colour. */
function buildPoolGeometry() {
  const parts = POOLS.map((p) => {
    const position = p.plane === 'back' ? [p.x, p.y, BACK_Z] : p.plane === 'left' ? [LEFT_X, p.y, p.z] : [p.x, 0.016, p.z];
    const rotation = p.plane === 'floor' ? [-Math.PI / 2, 0, 0] : p.plane === 'left' ? [0, Math.PI / 2, 0] : [0, 0, 0];
    const geometry = new THREE.PlaneGeometry(p.size[0], p.size[1]);
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    const colors = new Float32Array(geometry.attributes.position.count * 3).fill(p.opacity);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  });
  const merged = mergeGeometries(parts);
  parts.forEach((geometry) => geometry.dispose());
  return merged;
}

export default function LightPools() {
  const texture = useMemo(() => makeLightPoolTexture(), []);
  const geometry = useMemo(buildPoolGeometry, []);
  useEffect(() => () => { texture.dispose(); geometry.dispose(); }, [texture, geometry]);
  return (
    <mesh geometry={geometry} renderOrder={1} raycast={() => null}>
      <meshBasicMaterial map={texture} color="#ffa550" vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}
