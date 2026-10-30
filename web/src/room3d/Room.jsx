import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBox, useGLTF } from '@react-three/drei';
import DomAnchor from './room/DomAnchor.jsx';
import CardSlab from './room/CardSlab.jsx';
import { useFrame, useThree } from '@react-three/fiber';
import { makeFloorInlayTexture, makeFloorTexture, makeHoloCardTexture, makeWallTexture } from './textures.js';
import DynamicShelving from './room/DynamicShelving.jsx';
import { look, tuneForLook } from './look/looks.js';
import { makeLamplightFloor, makeLamplightWall } from './look/lamplightTextures.js';
import LightPools from './look/LightPools.jsx';
import { toRoomMaterial } from './look/simpleMaterial.js';
import { CLUBHOUSE, QUALITY, THEME } from './clubhouse/config.js';
import { VITRINE, buildVitrine } from './clubhouse/collection.js';
import { useHoloFoil } from './room/holoFoil.js';

const ROOM = { width: 8, depth: 6, height: 4, wall: 0.18, floor: 0.18 };
const LEFT_X = -ROOM.width / 2;
const BACK_Z = -ROOM.depth / 2;
const INNER_LEFT_X = LEFT_X + ROOM.wall / 2;
const INNER_BACK_Z = BACK_Z + ROOM.wall / 2;

export const HOTSPOTS = {
  storage: { label: 'Bulk Storage', camPos: [2.5, 2.55, 5.2], camTarget: [-3.45, 1.45, 1.25] },
  binders: { label: 'Binder Library', camPos: [4.2, 2.8, 3.6], camTarget: [-0.45, 1.7, -2.62] },
  display: { label: 'Display Cabinet', camPos: [5.4, 2.45, 2.8], camTarget: [2.65, 1.45, -2.62] },
};

/** The shell's surface textures for the active look. Every texture is owned by RoomShell and disposed with it. */
function makeShellTextures() {
  if (look.name === 'lamplight') {
    const floor = makeLamplightFloor();
    return { floor: floor.map, floorBump: floor.bump, back: makeLamplightWall('back'), left: makeLamplightWall('left'), inlay: null };
  }
  const floor = makeFloorTexture();
  return { floor, floorBump: floor, back: makeWallTexture('back'), left: makeWallTexture('left'), inlay: makeFloorInlayTexture() };
}

function RoomShell() {
  const { gl } = useThree();
  const shell = look.shell;
  const textures = useMemo(makeShellTextures, []);
  const maxAnisotropy = gl.capabilities.getMaxAnisotropy();

  useEffect(() => {
    const unique = new Set(Object.values(textures).filter(Boolean));
    unique.forEach((texture) => { texture.anisotropy = Math.min(look.name === 'classic' ? 12 : texture.anisotropy, maxAnisotropy); });
    return () => unique.forEach((texture) => texture.dispose());
  }, [textures, maxAnisotropy]);

  return (
    <group>
      <RoundedBox args={[ROOM.width, ROOM.floor, ROOM.depth]} radius={0.045} smoothness={3} position={[0, -ROOM.floor / 2, 0]} receiveShadow>
        <roomMaterial map={textures.floor} bumpMap={textures.floorBump} bumpScale={shell.floor.bumpScale} roughness={shell.floor.roughness} />
      </RoundedBox>

      <mesh position={[0, ROOM.height / 2, BACK_Z]} receiveShadow castShadow>
        <boxGeometry args={[ROOM.width, ROOM.height, ROOM.wall]} />
        <roomMaterial map={textures.back} bumpMap={textures.back} bumpScale={shell.wall.back.bumpScale} roughness={shell.wall.back.roughness} />
      </mesh>
      <mesh position={[LEFT_X, ROOM.height / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[ROOM.wall, ROOM.height, ROOM.depth]} />
        <roomMaterial map={textures.left} bumpMap={textures.left} bumpScale={shell.wall.left.bumpScale} roughness={shell.wall.left.roughness} />
      </mesh>

      {shell.inlay && textures.inlay && (
        <mesh position={[0.1, 0.012, 0.35]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[3.8, 2.8]} />
          <meshBasicMaterial map={textures.inlay} transparent opacity={0.26} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {look.name === 'lamplight' && <LightPools />}

      <RoundedBox args={[ROOM.width - ROOM.wall, 0.25, 0.13]} radius={0.025} smoothness={3} position={[0, 0.125, INNER_BACK_Z + 0.065]} receiveShadow castShadow>
        <roomMaterial color={shell.baseboard} roughness={0.48} />
      </RoundedBox>
      <RoundedBox args={[0.13, 0.25, ROOM.depth - ROOM.wall]} radius={0.025} smoothness={3} position={[INNER_LEFT_X + 0.065, 0.125, 0.065]} receiveShadow castShadow>
        <roomMaterial color={shell.baseboard} roughness={0.48} />
      </RoundedBox>
      <RoundedBox args={[0.16, ROOM.height - 0.26, 0.16]} radius={0.025} smoothness={3} position={[INNER_LEFT_X + 0.08, ROOM.height / 2, INNER_BACK_Z + 0.08]} receiveShadow castShadow>
        <roomMaterial color={shell.column} roughness={0.74} />
      </RoundedBox>

      <RoundedBox args={[ROOM.width - ROOM.wall, 0.22, 0.12]} radius={0.025} smoothness={3} position={[0, ROOM.height - 0.11, INNER_BACK_Z + 0.06]} receiveShadow>
        <roomMaterial color={shell.crown[0]} roughness={0.75} />
      </RoundedBox>
      <RoundedBox args={[0.12, 0.22, ROOM.depth - ROOM.wall]} radius={0.025} smoothness={3} position={[INNER_LEFT_X + 0.06, ROOM.height - 0.11, 0.06]} receiveShadow>
        <roomMaterial color={shell.crown[1]} roughness={0.75} />
      </RoundedBox>

      {/* A small room marker gives the space a designed identity without competing with the collection. */}
      <group position={[-3.895, 3.42, -1.35]} rotation={[0, Math.PI / 2, 0]}>
        <RoundedBox args={[0.92, 0.34, 0.055]} radius={0.055} smoothness={4} castShadow>
          <roomMaterial color={shell.sign.body} roughness={0.42} metalness={0.08} />
        </RoundedBox>
        {[[-0.27, shell.sign.dots[0]], [0, shell.sign.dots[1]], [0.27, shell.sign.dots[2]]].map(([x, color]) => (
          <mesh key={x} position={[x, 0, 0.035]}>
            <circleGeometry args={[0.055, 24]} />
            <roomMaterial color={color} roughness={0.45} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function usePreparedModel(url) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        if (object.material) {
          object.material = object.material.clone();
          const name = object.material.name;
          // Color now comes entirely from the grained Image Texture baked
          // into the GLB in build_nook_furniture.py — no hardcoded hex
          // override here. (This dict used to silently re-tint every
          // material back to the old dark palette on load, which is why an
          // earlier Blender-side color/texture fix never visibly changed
          // anything — .color multiplies against .map in three.js.)
          object.material.envMapIntensity = name === 'Satin brass' ? 1.6 : 1.05;
          if (name === 'Warm walnut') object.material.roughness = 0.4;
          if (name === 'Satin brass') {
            object.material.metalness = 0.72;
            object.material.roughness = 0.28;
          }
          if (name === 'Museum glass') {
            object.material.color.set('#dff9f4');
            object.material.transparent = true;
            object.material.opacity = 0.08;
            object.material.roughness = 0.06;
            object.material.transmission = 0.72;
            object.material.thickness = 0.04;
            object.material.depthWrite = false;
            // The cards sit behind the cabinet door. Glass should remain
            // visible, but it must not consume the pointer ray before the
            // actual card receives the click.
            object.raycast = () => null;
          }
          object.material = toRoomMaterial(object.material); // the room's one cheap material: see look/simpleMaterial.js
          tuneForLook(object.material);
          object.material.needsUpdate = true;
        }
      }
    });
    return clone;
  }, [scene]);
}

function makeObjectLabelTexture(text, accent = '#2f7065') {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff8e8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 28, canvas.height);
  ctx.strokeStyle = '#c9b994'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.fillStyle = '#203b34'; ctx.font = '800 42px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  let value = text || 'Untitled';
  while (ctx.measureText(value).width > 430 && value.length > 5) value = `${value.slice(0, -2)}…`;
  ctx.fillText(value, 54, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

function ObjectLabel({ text, accent, position, size }) {
  const texture = useMemo(() => makeObjectLabelTexture(text, accent), [accent, text]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position} renderOrder={5}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} transparent polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

function ItemHitbox({ id, kind, label, position, size, onSelect, onHover, active }) {
  // Previously the invisible mesh below had no `active` gate at all — only
  // the decorative Html button was conditional. That left every binder/bin
  // hitbox raycast-clickable all the time, so a click meant for a card
  // inside an already-open binder's rolodex could fall through and select
  // an unrelated binder instead (confirmed via DOM inspection + hash change).
  // Returning null removes the mesh from the scene graph entirely when
  // inactive, not just its visible affordance.
  if (!active) return null;
  return (
    <>
      <mesh
        name={`${kind}Hit_${id}`}
        position={position}
        onClick={(event) => { event.stopPropagation(); onSelect(id); }}
        onPointerOver={(event) => { event.stopPropagation(); onHover(id); }}
        onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
      >
        <boxGeometry args={size} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <DomAnchor position={position} center zIndex={4} style={{ pointerEvents: 'auto' }}>
        <button
          className={`object-hit object-hit--${kind.toLowerCase()}`}
          aria-label={`Open ${kind.toLowerCase()} ${label || id.replace('_', ' ')}`}
          onMouseEnter={() => onHover(id)}
          onMouseLeave={() => onHover(null)}
          onClick={(event) => { event.stopPropagation(); onSelect(id); }}
        />
      </DomAnchor>
    </>
  );
}

// R3F's pointer event carries `event.object` — the actual mesh the raycaster
// hit, even when it's a raw child deep inside a <primitive>-rendered GLTF
// scene, not something created via JSX. So individual binders/bins don't
// need per-mesh handlers registered one at a time: one handler on the
// wrapping group, read event.object.name, and match it against the known
// Blender-side naming pattern (Binder_{row}_{index}, Bin_{row}_{index}) to
// find out which specific item was actually hit. Anything that doesn't
// match (shelf wood, back panel, labels/marks) falls back to the old
// whole-piece zone click.
function itemIdFromName(name, itemPrefix) {
  const partNames = itemPrefix === 'Binder' ? 'Label|Mark' : 'Lid|Label|Handle';
  const match = name && name.match(new RegExp(`^${itemPrefix}(?:_(?:${partNames}))?_(\\d+)_(\\d+)(?:\\.\\d+)?$`));
  return match ? `${match[1]}_${match[2]}` : null;
}

function FurnitureAsset({ type, url, position, rotation, onSelect, hovered, setHovered, children, itemPrefix, onSelectItem, hoveredItem, selectedItem, setHoveredItem, visibleItemIds }) {
  const model = usePreparedModel(url);

  // The GLBs bake in every binder / bin. Only the ones that exist in the collection stay visible, so an
  // empty collection shows bare shelving. Runtime flags on this component's own clone — the GLB is untouched.
  useEffect(() => {
    if (!itemPrefix || !visibleItemIds) return;
    const visible = new Set(visibleItemIds);
    model.traverse((object) => {
      if (!object.isMesh) return;
      const itemId = itemIdFromName(object.name, itemPrefix);
      if (itemId) object.visible = visible.has(itemId);
    });
  }, [model, itemPrefix, visibleItemIds]);

  useEffect(() => {
    if (!itemPrefix) return;
    model.traverse((object) => {
      if (!object.isMesh || !object.material?.emissive) return;
      const itemId = itemIdFromName(object.name, itemPrefix);
      object.userData.collectionItemId = itemId;
      if (itemId && itemId === selectedItem) {
        object.material.emissive.set('#ffd45c');
        object.material.emissiveIntensity = 0.24;
      } else if (itemId && itemId === hoveredItem) {
        object.material.emissive.set('#75ddd1');
        object.material.emissiveIntensity = 0.16;
      } else {
        object.material.emissive.set('#000000');
        object.material.emissiveIntensity = 0;
      }
    });
  }, [hoveredItem, itemPrefix, model, selectedItem]);

  // three.js raycasts invisible meshes too, so a hidden (nonexistent) item must not count as hit.
  const getItemId = (object) => (object?.visible === false ? null : object?.userData?.collectionItemId ?? itemIdFromName(object?.name, itemPrefix));
  return (
    <group
      position={position}
      rotation={rotation}
      onClick={(event) => {
        event.stopPropagation();
        const itemId = itemPrefix ? getItemId(event.object) : null;
        if (itemId && onSelectItem) onSelectItem(itemId);
        else onSelect(type);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(type);
        const itemId = itemPrefix ? getItemId(event.object) : null;
        if (itemId && setHoveredItem) setHoveredItem(itemId);
      }}
      onPointerOut={() => { setHovered(null); if (setHoveredItem) setHoveredItem(null); }}
    >
      <primitive object={model} />
      {children}
    </group>
  );
}

function HoloCard({ position, rotation = [0, Math.PI, 0], seed = 0, card, active, selected, hovered, onClick, onPointerOver, onPointerOut }) {
  const { gl } = useThree();
  // Keyed on what the card LOOKS like, not on object identity: the room model rebuilds card objects whenever the
  // shelves page, and a new 768×1072 canvas texture per rebuild leaked GPU memory. Old textures are disposed.
  const texture = useMemo(() => makeHoloCardTexture(card ?? seed), [card?.id, card?.imageUrl, card?.name, card?.seed, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => texture.dispose(), [texture]);
  texture.anisotropy = Math.min(12, gl.capabilities.getMaxAnisotropy());
  const groupRef = React.useRef();

  // Holographic cards get a rainbow foil that shifts with the view and a slow glint (not in the original nook, whose look is unchanged).
  const { materialRef, drive: driveFoil } = useHoloFoil(card?.rarity, CLUBHOUSE);

  // Individually clickable (unlike the binders/bins, these are already
  // separate React components, not meshes baked into one GLB) — selecting
  // one lifts it toward the viewer and tilts it flat-on instead of angled.
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    driveFoil(state.clock.elapsedTime, delta, selected ? 0.95 : hovered ? 0.75 : 0.55);
    const targetScale = selected ? 1.35 : hovered ? 1.08 : 1;
    // Clubhouse: a selected card floats out in front of the glass, clear of the shelves above and below it; the original nook sinks it back.
    const targetZ = selected ? (CLUBHOUSE ? -0.4 : 0.22) : 0;
    const s = THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 10, delta);
    groupRef.current.scale.setScalar(s);
    groupRef.current.position.z = THREE.MathUtils.damp(groupRef.current.position.z, position[2] + targetZ, 10, delta);
  });

  return (
    <group
      ref={groupRef}
      name={`DisplayHit_${seed}`}
      position={position}
      rotation={selected ? [0, Math.PI, 0] : rotation}
      // Until the camera is on the cabinet (`active`), a tap on a card falls through to the cabinet, which zooms in first.
      onClick={active ? (e) => { e.stopPropagation(); onClick && onClick(); } : undefined}
      onPointerOver={active ? (e) => { e.stopPropagation(); onPointerOver && onPointerOver(); } : undefined}
      onPointerOut={() => onPointerOut && onPointerOut()}
    >
      <CardSlab width={0.48} height={0.68} depth={0.045} radius={0.028} smoothness={4} castShadow>
        <roomMaterial ref={materialRef} map={texture} emissiveMap={texture} emissive="#fff6df" emissiveIntensity={selected ? 0.22 : 0.08} roughness={0.22} metalness={0.24} />
      </CardSlab>
      {!(CLUBHOUSE && selected) && (
        <mesh position={[0, -0.37, -0.07]} rotation={[0.25, 0, 0]} castShadow>
          <boxGeometry args={[0.34, 0.035, 0.25]} />
          <roomMaterial color="#c9a560" roughness={0.34} metalness={0.5} />
        </mesh>
      )}
      {active && (
        // Keyboard access only: Tab reaches each card, Enter opens it. Pointers go through to the 3D card itself, so a
        // button bigger than a small on-screen card can never catch a tap meant for its neighbour.
        <DomAnchor center zIndex={4} style={{ pointerEvents: 'none' }}>
          <button
            className="object-hit object-hit--display"
            aria-label={`Inspect ${card?.name ?? `display card ${seed + 1}`}`}
            onMouseEnter={onPointerOver}
            onMouseLeave={onPointerOut}
            onClick={(event) => { event.stopPropagation(); onClick?.(); }}
          />
        </DomAnchor>
      )}
    </group>
  );
}

function StorageWall({ items, onSelectBin, hoveredBin, selectedBin, setHoveredBin, itemHitsActive, itemIds, ...props }) {
  const rows = [
    { level: 0.07, bins: [-0.57, 0.57] },
    { level: 0.81, bins: [-0.57, 0.57] },
    { level: 1.55, bins: [-0.57, 0.57] },
    { level: 2.29, bins: [0] },
  ];
  return (
    <FurnitureAsset
      {...props}
      type="storage"
      url="/room3d/storage-unit.glb"
      position={[-3.53, 0, 1.35]}
      rotation={[0, -Math.PI / 2, 0]}
      itemPrefix="Bin"
      visibleItemIds={itemIds}
      onSelectItem={onSelectBin}
      hoveredItem={hoveredBin}
      selectedItem={selectedBin}
      setHoveredItem={setHoveredBin}
    >
      {rows.flatMap((row, rowIndex) => row.bins.map((x, index) => {
        const id = `${rowIndex}_${index}`;
        const item = items.find((candidate) => candidate.meshId === id);
        return <React.Fragment key={id}>
          <ItemHitbox id={id} kind="Bin" label={item?.name} position={[x, row.level + 0.34, -0.34]} size={[row.bins.length > 1 ? 1.06 : 1.16, 0.62, 0.22]} onSelect={onSelectBin} onHover={setHoveredBin} active={itemHitsActive && itemIds.includes(id)} />
          {item && <ObjectLabel text={item.name} accent={item.color || '#d76555'} position={[x, row.level + 0.35, -0.475]} size={[row.bins.length > 1 ? 0.72 : 0.82, 0.2]} />}
        </React.Fragment>;
      }))}
    </FurnitureAsset>
  );
}

function BinderLibrary({ items, onSelectBinder, hoveredBinder, selectedBinder, setHoveredBinder, itemHitsActive, itemIds, ...props }) {
  const levels = [0.07, 0.85, 1.63, 2.41];
  return (
    <FurnitureAsset
      {...props}
      type="binders"
      url="/room3d/binder-library.glb"
      position={[-0.6, 0, -2.54]}
      rotation={[0, Math.PI, 0]}
      itemPrefix="Binder"
      visibleItemIds={itemIds}
      onSelectItem={onSelectBinder}
      hoveredItem={hoveredBinder}
      selectedItem={selectedBinder}
      setHoveredItem={setHoveredBinder}
    >
      {levels.flatMap((level, row) => Array.from({ length: 10 }, (_, index) => {
        const height = 0.52 + ((index + row) % 3) * 0.03;
        const id = `${row}_${index}`;
        const item = items.find((candidate) => candidate.meshId === id);
        return (
          <React.Fragment key={id}>
          <ItemHitbox
            id={id}
            kind="Binder"
            label={item?.name}
            position={[-1.48 + index * 0.31, level + 0.05 + height / 2, -0.31]}
            size={[0.285, height + 0.05, 0.2]}
            onSelect={onSelectBinder}
            onHover={setHoveredBinder}
            active={itemHitsActive && itemIds.includes(id)}
          />
          {item && <ObjectLabel text={item.name} accent={item.accent} position={[-1.48 + index * 0.31, level + 0.05 + height * 0.52, -0.425]} size={[0.235, 0.15]} />}
          </React.Fragment>
        );
      }))}
    </FurnitureAsset>
  );
}

/** The Clubhouse display case: a slim glass vitrine built in code, with the same click and hover behaviour as the cabinet GLB. */
function VitrineAsset({ position, rotation, onSelect, setHovered, children }) {
  const vitrine = useMemo(() => buildVitrine(THEME), []);
  useEffect(() => () => vitrine.dispose(), [vitrine]);
  return (
    <group
      name="DisplayCabinet" // the camera rig frames this when the cabinet is opened
      position={position} rotation={rotation}
      onClick={(event) => { event.stopPropagation(); onSelect('display'); }}
      onPointerOver={(event) => { event.stopPropagation(); setHovered('display'); }}
      onPointerOut={() => setHovered(null)}
    >
      <primitive object={vitrine} />
      {children}
    </group>
  );
}

export function DisplayCabinet({ displayCards, selectedCard, hoveredCard, setHoveredCard, onSelectCard, itemHitsActive, anchor, ...props }) {
  // Card centres sit 0.4 m above the shelf they stand on; the vitrine's shelves are lower and tighter than the old cabinet's.
  const [t0, t1, t2] = VITRINE.tiers; const z = CLUBHOUSE ? -0.1 : -0.25;
  const cards = CLUBHOUSE ? [
    { position: [-0.34, t0 + 0.4, z], rotation: [0, Math.PI - 0.07, 0], seed: 0 },
    { position: [0.34, t0 + 0.4, z], rotation: [0, Math.PI + 0.07, 0], seed: 1 },
    { position: [0, t1 + 0.4, z], rotation: [0, Math.PI, 0], seed: 2 },
    { position: [-0.34, t2 + 0.4, z], rotation: [0, Math.PI - 0.06, 0], seed: 3 },
    { position: [0.34, t2 + 0.4, z], rotation: [0, Math.PI + 0.06, 0], seed: 4 },
  ] : [
    { position: [-0.34, 0.5, -0.25], rotation: [0, Math.PI - 0.07, 0], seed: 0 },
    { position: [0.34, 0.5, -0.25], rotation: [0, Math.PI + 0.07, 0], seed: 1 },
    { position: [0, 1.39, -0.25], rotation: [0, Math.PI, 0], seed: 2 },
    { position: [-0.34, 2.3, -0.25], rotation: [0, Math.PI - 0.06, 0], seed: 3 },
    { position: [0.34, 2.3, -0.25], rotation: [0, Math.PI + 0.06, 0], seed: 4 },
  ];
  const Shell = CLUBHOUSE ? VitrineAsset : FurnitureAsset;
  const lightY = CLUBHOUSE ? [t2 + 0.5, t1 + 0.5, t0 + 0.5] : [2.58, 1.68, 0.78];
  return (
    <Shell
      {...props}
      type="display"
      url="/room3d/display-cabinet.glb"
      position={anchor?.position ?? [2.65, 0, -2.54]}
      rotation={anchor?.rotation ?? [0, Math.PI, 0]}
    >
      {/* Every point light adds to the cost of every lit pixel in the room, so no quality tier has them (look/quality.js). */}
      {QUALITY.pointLights > 0 && <>
        <pointLight position={[0, lightY[0], -0.15]} color="#ffe8b1" intensity={0.85} distance={1.5} decay={2} />
        <pointLight position={[0, lightY[1], -0.15]} color="#ffe8b1" intensity={0.62} distance={1.35} decay={2} />
        <pointLight position={[0, lightY[2], -0.15]} color="#ffe8b1" intensity={0.56} distance={1.25} decay={2} />
      </>}
      {cards.map((c) => {
        const card = displayCards.find((entry) => entry.displayIndex === c.seed);
        return card && (
        <HoloCard
          key={c.seed}
          position={c.position}
          rotation={c.rotation}
          seed={c.seed}
          card={card}
          active={itemHitsActive}
          selected={selectedCard === c.seed}
          hovered={hoveredCard === c.seed}
          onClick={() => onSelectCard(selectedCard === c.seed ? null : c.seed)}
          onPointerOver={() => setHoveredCard(c.seed)}
          onPointerOut={() => setHoveredCard(null)}
        />
        );
      })}
    </Shell>
  );
}

export default function Nook({
  onSelect, hovered, setHovered,
  onSelectBinder, hoveredBinder, selectedBinder, setHoveredBinder,
  onSelectBin, hoveredBin, selectedBin, setHoveredBin,
  selectedCard, hoveredCard, setHoveredCard, onSelectCard,
  displayCards = [], binders = [], storageBoxes = [], binderItemIds = [], binItemIds = [],
  activeZone,
  zones, // dynamic furniture: when given, binders/boxes are generated from CardStacks units instead of the baked GLBs
}) {
  const furnitureProps = { onSelect, hovered, setHovered };
  return (
    <group>
      <RoomShell />
      {zones ? (
        <DynamicShelving
          zones={zones} onSelect={onSelect} setHovered={setHovered}
          hoveredBinder={hoveredBinder} selectedBinder={selectedBinder} setHoveredBinder={setHoveredBinder} onSelectBinder={onSelectBinder}
          hoveredBin={hoveredBin} selectedBin={selectedBin} setHoveredBin={setHoveredBin} onSelectBin={onSelectBin}
        />
      ) : (
        <>
          <StorageWall {...furnitureProps} items={storageBoxes} itemIds={binItemIds} itemHitsActive={activeZone === 'storage' && !selectedBin} onSelectBin={onSelectBin} hoveredBin={hoveredBin} selectedBin={selectedBin} setHoveredBin={setHoveredBin} />
          <BinderLibrary {...furnitureProps} items={binders} itemIds={binderItemIds} itemHitsActive={activeZone === 'binders' && !selectedBinder} onSelectBinder={onSelectBinder} hoveredBinder={hoveredBinder} selectedBinder={selectedBinder} setHoveredBinder={setHoveredBinder} />
        </>
      )}
      <DisplayCabinet {...furnitureProps} displayCards={displayCards} itemHitsActive={activeZone === 'display'} selectedCard={selectedCard} hoveredCard={hoveredCard} setHoveredCard={setHoveredCard} onSelectCard={onSelectCard} />
    </group>
  );
}

useGLTF.preload('/room3d/storage-unit.glb');
useGLTF.preload('/room3d/binder-library.glb');
useGLTF.preload('/room3d/display-cabinet.glb');
