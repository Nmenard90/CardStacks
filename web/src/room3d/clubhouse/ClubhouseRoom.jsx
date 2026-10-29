/**
 * ClubhouseRoom.jsx — the Clubhouse room, built from a theme and a layout.
 *
 * Reads the layout list: every piece the app builds itself (sofa, desk, plants, dog bed…) is made by pieces.js and
 * placed where the layout says. The collection furniture (binder bookcase, card box shelves, display cabinet) is the app's
 * own data-driven furniture, standing where the layout puts it, so binders, boxes and cards stay functional.
 * Takes the same interaction props as the original nook, so App.jsx can swap one for the other.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { DisplayCabinet } from '../Room.jsx';
import DynamicShelving from '../room/DynamicShelving.jsx';
import { ThrottledShadows } from '../look/SceneLights.jsx';
import { THREE, canvasTexture, disposeTree, makeStyle } from './kit.js';
import { INTERACTIVE, buildPiece } from './pieces.js';
import { MaterialPool, mergeStatic } from './merge.js';
import { buildShell } from './shell.js';
import { DEFAULT_LAYOUT, PIECE_TYPES } from './layout.js';
import { CANVAS, QUALITY, THEME } from './config.js';

const anchorOf = (layout, type) => {
  const piece = layout.find((p) => p.type === type);
  return piece ? { position: [piece.x, 0, piece.z], rotation: [0, piece.rot ?? 0, 0] } : undefined;
};

/** Petting Graton: click the dog bed and a few hearts float up and fade. Hearts only drift for people who haven't asked for reduced motion. */
let HEART;
const heartTexture = () => HEART ??= canvasTexture(128, 128, (c) => {
  c.fillStyle = '#E8506E'; c.beginPath(); c.moveTo(64, 112); c.bezierCurveTo(4, 72, 14, 18, 64, 44); c.bezierCurveTo(114, 18, 124, 72, 64, 112); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.ellipse(40, 44, 10, 6, -0.6, 0, 7); c.fill();
});
const HEART_LIFE = 1.7;
const WINDOW = { position: [-4.44, 2.05, 0.1], size: [1.66, 1.76] }; // matches the window group in shell.js, just inside the glass

function Heart({ heart, reduced }) {
  const sprite = useRef();
  useFrame(({ clock }) => {
    const age = clock.elapsedTime - heart.born; const t = Math.min(1, age / HEART_LIFE);
    if (!sprite.current) return;
    sprite.current.position.set(heart.x + (reduced ? 0 : Math.sin(age * 3 + heart.phase) * 0.06), heart.y + (reduced ? 0.25 : t * 0.7), heart.z);
    sprite.current.material.opacity = Math.max(0, 1 - t * t);
    const size = heart.size * (reduced ? 1 : 0.6 + 0.5 * Math.min(1, age * 4)); sprite.current.scale.set(size, size, 1);
  });
  return <sprite ref={sprite} renderOrder={10}><spriteMaterial map={heartTexture()} transparent depthWrite={false} toneMapped={false} /></sprite>;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(query.matches);
    update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** The layout piece (if any) under a pointer event, found by walking up from the mesh that was hit. */
const pieceTypeOf = (event) => { let o = event.object; while (o && !o.userData?.pieceType) o = o.parent; return o?.userData?.pieceType ?? null; };

/** Afternoon light: a warm key from the front right, sun through the window on the left, and a soft sky and floor bounce. */
function ClubhouseLights({ night }) {
  const size = CANVAS.shadowMapSize;
  return (
    <>
      <ThrottledShadows />
      <hemisphereLight args={night ? ['#9fd3e6', '#ffd9a0', 0.5] : ['#fff4e2', '#d9b98a', 0.42]} />
      <directionalLight position={[5.5, 9, 6.5]} intensity={night ? 0.9 : 1.55} color={night ? '#ffd8a4' : '#ffd9a6'} castShadow
        shadow-mapSize-width={size} shadow-mapSize-height={size} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={8} shadow-camera-bottom={-6} shadow-camera-far={30} shadow-bias={-0.0006} shadow-normalBias={0.08} />
      <directionalLight position={[-6, 4, 4]} intensity={night ? 0.3 : 0.28} color={night ? '#7fc7cc' : '#a9c9cc'} />
      {!night && <directionalLight position={[-9, 4.2, 0.1]} intensity={2.6} color="#ffcf8a" castShadow shadow-mapSize-width={size} shadow-mapSize-height={size} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-camera-far={20} shadow-normalBias={0.05} />}
      <Environment resolution={QUALITY.envResolution} environmentIntensity={0.3}>
        <Lightformer intensity={1.2} color="#fff1d1" position={[0, 8, 5]} scale={[8, 8, 1]} />
        <Lightformer intensity={0.6} color="#ffc98c" position={[-5, 3, 3]} scale={[3, 4, 1]} rotation-y={Math.PI / 2} />
      </Environment>
    </>
  );
}

export default function ClubhouseRoom({
  theme = THEME, layout = DEFAULT_LAYOUT, zones,
  onSelect, hovered, setHovered,
  onSelectBinder, hoveredBinder, selectedBinder, setHoveredBinder,
  onSelectBin, hoveredBin, selectedBin, setHoveredBin,
  selectedCard, hoveredCard, setHoveredCard, onSelectCard,
  displayCards = [], activeZone, onRoute,
}) {
  const style = useMemo(() => makeStyle(theme, { lights: QUALITY.tier !== 'mobile' }), [theme]);
  const room = useMemo(() => {
    const root = new THREE.Group(); const statics = new THREE.Group(); const pool = new MaterialPool();
    root.name = 'ClubhouseRoom';
    root.userData.obstacles = []; // boxes around standing furniture, so the camera can find a clear view of a zone (RoomScene.jsx)
    statics.add(buildShell(style));
    for (const piece of layout) {
      const built = buildPiece(piece, style);
      if (!built) continue;
      if (PIECE_TYPES[piece.type]?.mount === 'floor') { // one box per part (a desk's top, its lamp, its chair), so a box hugs what it stands for
        built.updateMatrixWorld(true);
        for (const part of built.children) {
          const box = new THREE.Box3().setFromObject(part);
          if (!box.isEmpty() && box.max.y > 0.25) root.userData.obstacles.push(box); // rugs and slippers never block the view
        }
      }
      if (INTERACTIVE.has(piece.type)) { mergeStatic(built, pool); root.add(built); } else statics.add(built);
    }
    mergeStatic(statics, pool); // everything that never moves becomes a few meshes, one per material
    root.add(statics);
    return root;
  }, [style, layout]);
  useEffect(() => () => disposeTree(room), [room]);

  const anchors = useMemo(() => ({ binders: anchorOf(layout, 'binderLibrary'), boxes: anchorOf(layout, 'storageRack'), display: anchorOf(layout, 'displayCabinet') }), [layout]);
  const furnitureProps = { onSelect, hovered, setHovered };

  // Pet the dog: hearts rise from the dog bed.
  const gl = useThree((state) => state.gl);
  const reduced = useReducedMotion();
  const clock = useThree((state) => state.clock);
  const [hearts, setHearts] = useState([]);
  const bed = layout.find((p) => p.type === 'dogBed');
  const pet = useCallback((event) => {
    const type = pieceTypeOf(event);
    if (!type) return;
    if (type !== 'dogBed') { // furniture that leads somewhere on the site
      const target = PIECE_TYPES[type]?.route;
      if (target && onRoute) { event.stopPropagation(); onRoute(target, PIECE_TYPES[type].label); }
      return;
    }
    if (!bed) return;
    event.stopPropagation();
    const born = clock.elapsedTime;
    const fresh = Array.from({ length: 3 }, (_, i) => ({ id: `${born}-${i}`, born: born + i * 0.18, phase: Math.random() * 6, size: 0.2 + Math.random() * 0.08, x: bed.x - 0.12 + (Math.random() - 0.5) * 0.4, y: 0.5 + Math.random() * 0.1, z: bed.z - 0.02 + (Math.random() - 0.5) * 0.3 }));
    setHearts((current) => [...current.filter((h) => born - h.born < HEART_LIFE), ...fresh]);
    window.setTimeout(() => setHearts((current) => current.filter((h) => !fresh.includes(h))), (HEART_LIFE + 0.7) * 1000);
  }, [bed, clock, onRoute]);
  const hoverDog = useCallback((event) => { const type = pieceTypeOf(event); if (type === 'dogBed' || (onRoute && PIECE_TYPES[type]?.route)) gl.domElement.style.cursor = 'pointer'; }, [gl, onRoute]);
  const leaveDog = useCallback(() => { gl.domElement.style.cursor = ''; }, [gl]);

  return (
    <group>
      <ClubhouseLights night={theme.mode === 'night'} />
      <primitive object={room} onClick={pet} onPointerOver={hoverDog} onPointerOut={leaveDog} />
      {hearts.map((h) => <Heart key={h.id} heart={h} reduced={reduced} />)}
      <mesh // the window (see shell.js) is where you explore the catalog: invisible over the glass, a warm glow when pointed at
        position={WINDOW.position} rotation={[0, Math.PI / 2, 0]} renderOrder={5}
        onClick={(event) => { if (activeZone === 'explore') return; event.stopPropagation(); onSelect('explore'); }}
        onPointerOver={(event) => { if (activeZone === 'explore') return; event.stopPropagation(); setHovered('explore'); }}
        onPointerOut={() => setHovered(null)}
      >
        <planeGeometry args={WINDOW.size} />
        <meshBasicMaterial color="#fff1c8" transparent opacity={hovered === 'explore' && activeZone !== 'explore' ? 0.16 : 0} depthWrite={false} toneMapped={false} />
      </mesh>
      {zones && (
        <DynamicShelving
          zones={zones} anchors={anchors} activeZone={activeZone} onSelect={onSelect} setHovered={setHovered}
          hoveredBinder={hoveredBinder} selectedBinder={selectedBinder} setHoveredBinder={setHoveredBinder} onSelectBinder={onSelectBinder}
          hoveredBin={hoveredBin} selectedBin={selectedBin} setHoveredBin={setHoveredBin} onSelectBin={onSelectBin}
        />
      )}
      <DisplayCabinet {...furnitureProps} anchor={anchors.display} displayCards={displayCards} itemHitsActive={activeZone === 'display'}
        selectedCard={selectedCard} hoveredCard={hoveredCard} setHoveredCard={setHoveredCard} onSelectCard={onSelectCard} />
    </group>
  );
}
