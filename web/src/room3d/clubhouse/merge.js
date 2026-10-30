/**
 * merge.js — turns a pile of small furniture meshes into a handful of big ones.
 *
 * Every builder makes many small meshes, each with its own material: that is hundreds of draw calls for a room.
 * `mergeStatic` bakes all the plain meshes under a root into one mesh per distinct material, and `MaterialPool`
 * makes identical materials one object. Pieces that must stay individually pickable (the dog bed) are merged inside
 * themselves only. Lights, sprites, instanced and see-through meshes are left alone. The room is rebuilt whenever the
 * layout or theme changes, so merged geometry never goes stale.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const hex = (color) => (color ? color.getHexString() : '');

/** Everything that changes how a room material looks, as a string. Equal keys mean interchangeable materials. */
export const materialKey = (m) => [m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.map?.uuid, m.bumpMap?.uuid, m.bumpScale, m.side, m.vertexColors, m.envMapIntensity].join('|');

/** Hands out one shared material per distinct look. */
export class MaterialPool {
  constructor() { this.byKey = new Map(); }
  get(material) {
    const key = materialKey(material);
    const shared = this.byKey.get(key);
    if (!shared) { this.byKey.set(key, material); return material; }
    if (shared !== material) material.dispose();
    return shared;
  }
}

const mergeable = (o) => {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
  const m = o.material;
  if (Array.isArray(m) || !m.isRoomMaterial || m.transparent) return false;
  const a = o.geometry.attributes;
  return Boolean(a.position && a.normal && a.uv);
};

/** Bake every plain mesh under `root` into one mesh per material, in `root`'s own space. Returns the number of draw calls saved. */
export function mergeStatic(root, pool) {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = []; root.traverse((o) => { if (mergeable(o)) meshes.push(o); });
  const buckets = new Map();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    const key = `${materialKey(mesh.material)}|${mesh.castShadow}|${mesh.receiveShadow}|${Object.keys(geometry.attributes).sort().join(',')}`;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, geometries: [], spare: [] }; buckets.set(key, bucket); }
    bucket.geometries.push(geometry);
    if (mesh.material !== bucket.material) bucket.spare.push(mesh.material);
    mesh.parent.remove(mesh); mesh.geometry.dispose();
  }
  for (const bucket of buckets.values()) {
    bucket.spare.forEach((m) => m.dispose());
    const mixed = bucket.geometries.some((g) => g.index) && !bucket.geometries.every((g) => g.index);
    const parts = mixed ? bucket.geometries.map((g) => (g.index ? g.toNonIndexed() : g)) : bucket.geometries;
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, pool.get(bucket.material));
    merged.castShadow = bucket.cast; merged.receiveShadow = bucket.receive;
    root.add(merged);
  }
  return meshes.length - buckets.size;
}
