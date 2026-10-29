/**
 * ShelfUnit.jsx — one shelf unit at full detail, generated from CardStacks
 * numbers instead of baked into a GLB.
 *
 *  - Frame: planks, side panels, back panel and brass edges at the unit's
 *    window size, in the same materials as the original furniture.
 *  - Contents: binders / boxes as THREE.InstancedMesh built from the existing
 *    GLB geometry — a handful of draw calls however many items are visible.
 *  - Names: one merged label mesh over one atlas texture (labelAtlas.js).
 *  - Picking: instanced raycasting (`event.instanceId`), so there is no
 *    per-object hitbox mesh and no per-object HTML overlay.
 *  - No useFrame: nothing here renders or animates continuously. Matrices are
 *    written once per layout change; hover/selection only rewrites colours.
 */
import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { drawLabelAtlas } from './labelAtlas.js';
import { labelStyle } from '../look/looks.js';
import { binderPlacement, boxPlacement } from './unitLayout.js';

const WHITE = new THREE.Color('#ffffff');
const translation = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

/** The four corners (viewer's bottom-left, bottom-right, top-right, top-left) of a label facing the front (-Z). Viewer's left is +X. */
function frontQuad(cx, cy, z, w, h) {
  return [[cx + w / 2, cy - h / 2, z], [cx - w / 2, cy - h / 2, z], [cx - w / 2, cy + h / 2, z], [cx + w / 2, cy + h / 2, z]];
}

function buildBinders(plan, items, parts) {
  const bodies = parts.binderGeometries.map(() => []);
  const marks = [];
  const labels = [];
  for (const item of items) {
    const p = binderPlacement(plan, item.row, item.col, item.variant);
    bodies[item.variant].push({ id: item.id, matrix: translation(p.x, p.y, p.z), color: new THREE.Color(item.color) });
    marks.push({ id: item.id, matrix: translation(p.x, p.y - 0.31 * p.height, -0.242) });
    labels.push({ name: item.name, color: item.color, quad: frontQuad(p.x, p.y + p.height * 0.08, -0.213, p.width * 0.84, p.height * 0.62) });
  }
  const groups = bodies.map((entries, v) => ({ key: `body${v}`, geometry: parts.binderGeometries[v], material: parts.binderMaterial, entries, tinted: true }));
  groups.push({ key: 'mark', geometry: parts.binderMark.geometry, material: parts.binderMark.material, entries: marks });
  return { groups, labels };
}

function buildBoxes(plan, items, parts) {
  const body = []; const lid = []; const plate = []; const handle = []; const labels = [];
  for (const item of items) {
    const p = boxPlacement(plan, item.row, item.col, item.level);
    body.push({ id: item.id, matrix: translation(p.x, p.y, p.z) });
    lid.push({ id: item.id, matrix: translation(p.x, p.y + 0.255, p.z), color: new THREE.Color(item.color) });
    const spec = parts.boxSpec;
    const labelY = p.y + (spec.labelDy ?? 0.01); // where the name plate sits on the box front
    plate.push({ id: item.id, matrix: translation(p.x, labelY, -0.327) });
    handle.push({ id: item.id, matrix: translation(p.x, p.y + (spec.handleDy ?? -0.1), -0.347) });
    labels.push({ name: item.name, color: item.color, quad: frontQuad(p.x, labelY, spec.labelZ, spec.labelW, spec.labelH) });
  }
  return {
    groups: [
      { key: 'body', geometry: parts.boxBody.geometry, material: parts.boxBody.material, entries: body },
      { key: 'lid', geometry: parts.boxLid.geometry, material: parts.boxLid.material, entries: lid, tinted: true },
      { key: 'plate', geometry: parts.boxPlate.geometry, material: parts.boxPlate.material, entries: plate },
      { key: 'handle', geometry: parts.boxHandle.geometry, material: parts.boxHandle.material, entries: handle },
    ],
    labels,
  };
}

/**
 * drei's RoundedBox writes UVs in metres, which tiles the GLBs' grain texture (repeat 5) five times per
 * metre — much finer than the original furniture, whose UVs span each face once. Dividing by the longest
 * side restores the original density (about five grain tiles across the longest edge).
 */
function fitUV(mesh) {
  const geometry = mesh?.geometry;
  const uv = geometry?.attributes.uv;
  if (!uv || geometry.userData.uvFitted) return;
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = 1 / Math.max(size.x, size.y, size.z);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * scale, uv.getY(i) * scale);
  uv.needsUpdate = true;
  geometry.userData.uvFitted = true;
}

/** Planks, sides, back panel and brass edges for one window. */
const Frame = memo(function Frame({ kind, frame, parts }) {
  const { width: W, height: H, depth: D, levels } = frame;
  const sideX = W / 2 - 0.055;
  const common = { castShadow: true, receiveShadow: true, ref: fitUV };
  return (
    <group>
      <RoundedBox args={[W, H, 0.07]} radius={0.018} smoothness={3} position={[0, H / 2, D / 2 - 0.035]} material={parts.woodDark} {...common} />
      {[-1, 1].map((s) => <RoundedBox key={s} args={[0.11, H, D]} radius={0.03} smoothness={3} position={[s * sideX, H / 2, 0]} material={parts.wood} {...common} />)}
      {levels.map((y, i) => (
        <group key={i}>
          <RoundedBox args={[W, 0.1, D]} radius={0.025} smoothness={3} position={[0, y, 0]} material={parts.wood} {...common} />
          {kind === 'binders'
            ? <RoundedBox args={[W - 0.05, 0.07, 0.04]} radius={0.012} smoothness={2} position={[0, y + 0.025, -(D / 2 + 0.015)]} material={parts.brass} {...common} />
            : i > 0 && i < levels.length - 1 && <RoundedBox args={[W - 0.08, 0.08, 0.045]} radius={0.012} smoothness={2} position={[0, y + 0.04, -(D / 2 - 0.015)]} material={parts.brass} {...common} />}
        </group>
      ))}
    </group>
  );
});

/** One InstancedMesh for one part. Matrices are written once per layout; hover/selection only rewrites colours. */
function PartInstances({ group, hoveredId, selectedId, handlers }) {
  const ref = useRef();
  const { entries } = group;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    entries.forEach((entry, i) => mesh.setMatrixAt(i, entry.matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [entries]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || !group.tinted) return;
    const tint = new THREE.Color();
    entries.forEach((entry, i) => {
      tint.copy(entry.color);
      if (entry.id === selectedId) tint.lerp(WHITE, 0.4); else if (entry.id === hoveredId) tint.lerp(WHITE, 0.24);
      mesh.setColorAt(i, tint);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [entries, group.tinted, hoveredId, selectedId]);
  if (!entries.length) return null;
  const idOf = (event) => entries[event.instanceId]?.id;
  return (
    <instancedMesh
      key={entries.length}
      ref={ref}
      args={[group.geometry, group.material, entries.length]}
      castShadow
      receiveShadow
      frustumCulled={false}
      onClick={handlers.onItemClick && ((e) => { const id = idOf(e); if (id) handlers.onItemClick(e, id); })}
      onPointerMove={handlers.onItemMove && ((e) => { const id = idOf(e); if (id) handlers.onItemMove(e, id); })}
      onPointerOut={handlers.onItemOut}
    />
  );
}

/** All visible names as one atlas texture on one merged mesh. Disposes what it creates. */
function LabelMesh({ kind, labels }) {
  const { gl } = useThree();
  const key = labels.map((l) => `${l.name}\u0001${l.color}`).join('\u0002');
  const atlas = useMemo(() => (labels.length ? drawLabelAtlas(labels, kind, labelStyle) : null), [key, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const texture = useMemo(() => {
    if (!atlas) return null;
    const t = new THREE.CanvasTexture(atlas.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return t;
  }, [atlas, gl]);
  const geometry = useMemo(() => {
    if (!atlas) return null;
    const n = labels.length;
    const position = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const index = new Uint32Array(n * 6);
    labels.forEach((label, i) => {
      const cell = atlas.layout.cells[i];
      label.quad.forEach((corner, c) => position.set(corner, i * 12 + c * 3));
      uv.set([cell.u0, cell.vBottom, cell.u1, cell.vBottom, cell.u1, cell.vTop, cell.u0, cell.vTop], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }, [atlas, labels]);
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry || !texture) return null;
  // Labels must never swallow a click meant for the binder or box behind them.
  return (
    <mesh geometry={geometry} renderOrder={5} raycast={() => null}>
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

/**
 * @param {{ kind: 'binders'|'boxes', zoneType: string, zone: { plan: object, items: object[] }, parts: object, position: number[], rotation: number[],
 *   hoveredId: string|null, selectedId: string|null, onSelectItem: Function, onHoverItem: Function, onSelectZone: Function, onHoverZone: Function }} props
 */
export default function ShelfUnit({ kind, zoneType, zone, parts, position, rotation, hoveredId, selectedId, onSelectItem, onHoverItem, onSelectZone, onHoverZone }) {
  const { plan, items } = zone;
  const built = useMemo(() => (kind === 'binders' ? buildBinders(plan, items, parts) : buildBoxes(plan, items, parts)), [kind, plan, items, parts]);
  // While one item of this zone is open, the shelf ignores clicks so nothing behind it is selected by accident.
  const interactive = !selectedId;
  const handlers = interactive ? {
    onItemClick: (e, id) => { e.stopPropagation(); onSelectItem(id); },
    onItemMove: (e, id) => { e.stopPropagation(); if (id !== hoveredId) onHoverItem(id); },
    onItemOut: () => onHoverItem(null),
  } : {};
  return (
    <group
      name={`ShelfUnit_${kind}`}
      position={position}
      rotation={rotation}
      onClick={interactive ? (e) => { e.stopPropagation(); onSelectZone(); } : undefined}
      onPointerOver={(e) => { e.stopPropagation(); onHoverZone(zoneType); }}
      onPointerOut={() => onHoverZone(null)}
    >
      <Frame kind={kind} frame={plan.frame} parts={parts} />
      {built.groups.map((group) => <PartInstances key={group.key} group={group} hoveredId={hoveredId} selectedId={selectedId} handlers={handlers} />)}
      <LabelMesh kind={kind} labels={built.labels} />
    </group>
  );
}
