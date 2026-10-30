/**
 * furnitureParts.js — the reusable binder / box / shelf parts, taken straight
 * from the EXISTING GLBs (public/assets/*.glb, untouched and still the rollback
 * path). No new models are generated: the dynamic furniture instances the very
 * same beveled meshes and grained materials Blender produced.
 *
 * Every part is centred on its own origin in the GLB (verified from the node
 * bounding boxes), so a part can be placed anywhere with just a translation.
 * Geometry is shared with the glTF cache (never mutated or disposed here);
 * materials are cloned so tuning cannot leak back into the cached scene.
 */
import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { toRoomMaterial } from '../look/simpleMaterial.js';
import { tuneForLook } from '../look/looks.js';
import { CLUBHOUSE, THEME } from '../clubhouse/config.js';
import { makeCardBoxParts } from '../clubhouse/collection.js';

/** Same material tuning as Room.jsx's usePreparedModel, so the new furniture lights identically. */
function tuned(material) {
  const m = material.isMeshStandardMaterial ? toRoomMaterial(material) : material.clone(); // see look/simpleMaterial.js
  m.envMapIntensity = m.name === 'Satin brass' ? 1.6 : 1.05;
  if (m.name === 'Warm walnut') m.roughness = 0.4;
  if (m.name === 'Satin brass') { m.metalness = 0.72; m.roughness = 0.28; }
  tuneForLook(m); // the active look's wood/brass tint; a no-op for classic
  m.needsUpdate = true;
  return m;
}

/** A named mesh from a GLB scene; node rotation (cylinders) is baked into a geometry copy. */
function part(scene, name, { bakeRotation = false } = {}) {
  const mesh = scene.getObjectByName(name);
  if (!mesh || !mesh.isMesh) throw new Error(`Furniture part "${name}" is missing from the GLB.`);
  return { geometry: bakeRotation ? mesh.geometry.clone().applyQuaternion(mesh.quaternion) : mesh.geometry, material: tuned(mesh.material) };
}

/** Parts for the dynamic binder shelves, storage racks and their frames. Suspends until the GLBs are loaded. */
export default function useFurnitureParts() {
  const binderScene = useGLTF('/room3d/binder-library.glb').scene;
  const storageScene = useGLTF('/room3d/storage-unit.glb').scene;
  // The Clubhouse room swaps the chunky bins for blocks of end-out card boxes (same cells, same picking, same labels).
  const cardBoxes = useMemo(() => (CLUBHOUSE ? makeCardBoxParts(THEME) : null), []);
  useEffect(() => () => cardBoxes?.dispose(), [cardBoxes]);
  return useMemo(() => {
    const cream = part(binderScene, 'Binder_0_1'); // cream grain texture: tinted per instance with the binder's colour
    const bin = part(storageScene, 'Bin_0_0');
    return {
      // Binder: three heights, one grained material, a brass mark.
      binderGeometries: ['Binder_0_0', 'Binder_0_1', 'Binder_0_2'].map((name) => part(binderScene, name).geometry),
      binderMaterial: cream.material,
      binderMark: part(binderScene, 'Binder_Mark_0_1', { bakeRotation: true }),
      // Box: cream body, lid tinted with the box colour, ivory label plate, brass handle.
      boxBody: cardBoxes?.parts.boxBody ?? bin,
      boxLid: cardBoxes?.parts.boxLid ?? { geometry: part(storageScene, 'Bin_Lid_0_0').geometry, material: tuned(bin.material) },
      boxPlate: cardBoxes?.parts.boxPlate ?? part(storageScene, 'Bin_Label_0_0'),
      boxHandle: cardBoxes?.parts.boxHandle ?? part(storageScene, 'Bin_Handle_0_0', { bakeRotation: true }),
      boxSpec: cardBoxes?.spec ?? { labelZ: -0.342, labelW: 0.44, labelH: 0.105 },
      // Frame materials: the library's own wood, shadowed back panel and brass edge.
      wood: part(binderScene, 'Library_Shelf').material,
      woodDark: part(binderScene, 'Library_Back').material,
      brass: part(binderScene, 'Library_Shelf_Edge').material,
    };
  }, [binderScene, storageScene, cardBoxes]);
}
