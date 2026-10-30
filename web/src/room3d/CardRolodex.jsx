/**
 * CardRolodex.jsx — a ring of cards floating in front of the camera that you flick through.
 *
 * Used for boxes (the cards in the open drawer) and for the card picker (catalog
 * search results). Only the cards within WINDOW of the centre are mounted, so a
 * drawer of hundreds is as cheap as a handful; textures come from the shared
 * capped cache in room/cardTextures.js. Scroll position is measured in cards.
 *
 * Input: drag, wheel, ← / →. Tap a card to pick it, tap again to put it back.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import DomAnchor from './room/DomAnchor.jsx';
import * as THREE from 'three';
import CardSlab from './room/CardSlab.jsx';
import { getCardTexture } from './room/cardTextures.js';
import { freeRect } from './room/freeRect.js';

const TAP_AGAIN = window.matchMedia?.('(pointer: coarse)').matches ? 'tap again to put it back' : 'click again to put it back'; // the picked card's label
const DISTANCE = 3.1; // how far in front of the camera the ring floats
const FILL = 0.92; // share of the free screen area the front card may fill
const SELECTED_GROW = 1.1; // the picked / hovered card is drawn a little larger
const RADIUS = 2.4;
const CARD_W = 0.58;
const CARD_H = 0.8;
const ANGLE_PER = 0.29;
const SELECTED_SLOT = { x: 0, y: 0.32, z: 0 };
const WINDOW = 8; // cards mounted on each side of the centre
const FADE_FROM = 5.5; // cards beyond this many places out shrink away, hiding the window edge
const PIXELS_PER_CARD = 150;
const WHEEL_PER_CARD = 100;
const SETTLE_MS = 160; // how long a card must stay in the centre before it is upgraded to full-size art

function RolodexCard({ index, scrollRef, card, selected, front, hasSelection, onSelect }) {
  const ref = useRef();
  const { gl } = useThree();
  const [isHovered, setIsHovered] = useState(false);
  const texture = useMemo(() => getCardTexture(card, selected || front ? 'large' : 'small'), [card, selected, front]); // the card at the front, or being read, gets full detail

  useFrame((_, delta) => {
    if (!ref.current) return;
    const offset = index - scrollRef.current; // places from the centre, fractional while scrolling
    const angle = offset * ANGLE_PER;
    const x = selected ? SELECTED_SLOT.x : Math.sin(angle) * RADIUS;
    const y = selected ? SELECTED_SLOT.y : isHovered ? 0.06 : 0;
    const z = selected ? SELECTED_SLOT.z : -Math.cos(angle) * RADIUS + RADIUS;
    const rotY = selected ? 0 : angle;
    const edge = THREE.MathUtils.clamp(1 - (Math.abs(offset) - FADE_FROM) / (WINDOW - FADE_FROM), 0, 1);
    const targetScale = Math.max(0.001, edge * (selected || isHovered ? SELECTED_GROW : 1));
    const g = ref.current;
    g.position.x = THREE.MathUtils.damp(g.position.x, x, 9, delta);
    g.position.y = THREE.MathUtils.damp(g.position.y, y, 9, delta);
    g.position.z = THREE.MathUtils.damp(g.position.z, z, 9, delta);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, rotY, 9, delta);
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, targetScale, 10, delta));
  });

  return (
    <group
      ref={ref}
      name={`RolodexCard_${card.id}`}
      scale={0.001}
      renderOrder={selected ? 20 : 0}
      onPointerOver={(event) => { event.stopPropagation(); setIsHovered(true); gl.domElement.style.cursor = 'pointer'; }}
      onPointerOut={() => { setIsHovered(false); gl.domElement.style.cursor = ''; }}
      onClick={(event) => { event.stopPropagation(); if (event.delta < 6) onSelect(card); }}
    >
      <CardSlab width={CARD_W} height={CARD_H} depth={0.018} radius={0.022} smoothness={3} castShadow>
        <roomMaterial
          map={texture}
          roughness={0.28}
          metalness={0.08}
          transparent={hasSelection}
          opacity={!hasSelection || selected ? 1 : 0.3}
          depthTest={!selected}
        />
      </CardSlab>
    </group>
  );
}

/** `resetKey` changes (new box, drawer or search) → the ring returns to the first card. */
export default function CardRolodex({ active, cards = [], selectedCardId = null, onSelectCard, resetKey = '' }) {
  const last = Math.max(0, cards.length - 1);
  const scrollRef = useRef(0); // continuous position, in cards
  const velocityRef = useRef(0);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const groupRef = useRef();
  const forwardDir = useRef(new THREE.Vector3());
  const { camera, size } = useThree();
  const framing = useRef({ scale: 1, centre: { x: size.width / 2, y: size.height / 2 } });
  const tick = useRef(0);
  const [center, setCenter] = useState(0); // whole-card centre; changes re-mount the window
  const [front, setFront] = useState(0); // the centre card once it has stayed put: only it gets the full-size art, so a fast scroll doesn't load every card it passes
  useEffect(() => { const timer = window.setTimeout(() => setFront(center), SETTLE_MS); return () => window.clearTimeout(timer); }, [center]);

  const moveBy = (delta) => { scrollRef.current = THREE.MathUtils.clamp(scrollRef.current + delta, 0, last); };

  useEffect(() => { scrollRef.current = 0; velocityRef.current = 0; setCenter(0); }, [resetKey, active]);
  useEffect(() => { scrollRef.current = Math.min(scrollRef.current, last); setCenter(Math.round(scrollRef.current)); }, [last]);

  useFrame(() => {
    if (!active || !groupRef.current) return;
    // Fit the front card to the free screen area (what the panels leave), measured from the page so it is right at any size.
    // The camera rig may also be sliding the whole frame (view offset), so the ring makes up whatever is left over.
    const metresPerPx = (2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / size.height;
    if (tick.current++ % 6 === 0) {
      const free = freeRect(size.width, size.height, CARD_W / CARD_H);
      framing.current.scale = Math.min(FILL * free.w * metresPerPx / (CARD_W * SELECTED_GROW), FILL * free.h * metresPerPx / (CARD_H * SELECTED_GROW));
      framing.current.centre = { x: free.x + free.w / 2, y: free.y + free.h / 2 };
    }
    const view = camera.view?.enabled ? camera.view : null;
    const subjectY = selectedCardId ? SELECTED_SLOT.y : 0; // where the card being looked at sits within the ring, in ring metres
    camera.getWorldDirection(forwardDir.current);
    groupRef.current.position.copy(camera.position).addScaledVector(forwardDir.current, DISTANCE);
    groupRef.current.quaternion.copy(camera.quaternion);
    groupRef.current.scale.setScalar(framing.current.scale);
    groupRef.current.translateX((framing.current.centre.x - size.width / 2 + (view?.offsetX ?? 0)) * metresPerPx);
    groupRef.current.translateY(-(framing.current.centre.y - size.height / 2 + (view?.offsetY ?? 0)) * metresPerPx - subjectY * framing.current.scale);
    if (!draggingRef.current && velocityRef.current !== 0) { // inertia after a flick
      moveBy(velocityRef.current);
      velocityRef.current *= 0.92;
      if (Math.abs(velocityRef.current) < 0.0005) velocityRef.current = 0;
    }
    const nearest = Math.round(scrollRef.current);
    if (nearest !== center) setCenter(nearest);
    if (import.meta.env.DEV) window.__rolodexScroll = scrollRef.current;
  });

  useEffect(() => {
    if (!active) return undefined;
    const onDown = (event) => {
      if (event.target?.closest?.('button, aside, nav, input, select')) return;
      draggingRef.current = true;
      lastXRef.current = event.clientX;
      velocityRef.current = 0;
    };
    const onMove = (event) => {
      if (!draggingRef.current) return;
      const delta = -(event.clientX - lastXRef.current) / PIXELS_PER_CARD;
      lastXRef.current = event.clientX;
      moveBy(delta);
      velocityRef.current = delta;
    };
    const onUp = () => { draggingRef.current = false; };
    const onWheel = (event) => {
      if (event.target?.closest?.('aside, nav, [role=dialog]')) return;
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = raw / WHEEL_PER_CARD;
      moveBy(delta);
      velocityRef.current = delta * 0.25;
    };
    const onKey = (event) => {
      if (event.target?.closest?.('input, select, textarea')) return;
      if (event.key === 'ArrowRight') scrollRef.current = Math.min(last, Math.round(scrollRef.current) + 1);
      else if (event.key === 'ArrowLeft') scrollRef.current = Math.max(0, Math.round(scrollRef.current) - 1);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, last]);

  if (!active || cards.length === 0) return null;
  const selectedCard = cards.find((card) => card.id === selectedCardId);
  const from = Math.max(0, center - WINDOW);
  const to = Math.min(last, center + WINDOW);

  return (
    <group ref={groupRef}>
      {cards.slice(from, to + 1).map((card, i) => (
        <RolodexCard
          key={card.id}
          card={card}
          index={from + i}
          scrollRef={scrollRef}
          selected={selectedCardId === card.id}
          front={from + i === front}
          hasSelection={selectedCardId !== null}
          onSelect={(picked) => onSelectCard?.(selectedCardId === picked.id ? null : picked)}
        />
      ))}
      {selectedCard && (
        <DomAnchor position={[0, -0.22, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="rolodex-label">{selectedCard.name} · {TAP_AGAIN}</div>
        </DomAnchor>
      )}
    </group>
  );
}
