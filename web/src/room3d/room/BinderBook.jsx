/**
 * BinderBook.jsx — an open binder: a cover and pages of card pockets you flip through.
 *
 * The book floats in front of the camera (like the rolodex) and fits itself to the
 * viewport: a two-page spread on wide screens, one page on narrow ones. Filled
 * pockets show the card; empty pockets are clickable and ask the app to open the
 * card picker for that exact pocket. Geometry lives in binderLayout.js.
 *
 * Paging: ← / → keys, mouse wheel, horizontal swipe/drag, or the BinderBar buttons.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import CardSlab from './CardSlab.jsx';
import { getCardTexture } from './cardTextures.js';
import { useHoloFoil } from './holoFoil.js';
import { CLUBHOUSE } from '../clubhouse/config.js';
import { POCKET_H, POCKET_W, pageCount, pageSize, pocketCenter, pocketsPerPage, visiblePages } from './binderLayout.js';

import { freeRect } from './freeRect.js';

const DISTANCE = 3.4;
const FILL = 0.92; // share of the free screen area the open book may fill
const COVER_MARGIN = 0.14; // the cover's overhang around the pages, in book metres (matches the cover RoundedBox)
const SWIPE_PX = 70;
const WHEEL_STEP = 90;

const setCursor = (gl, value) => { gl.domElement.style.cursor = value; };

function EmptyPocket({ position, slot, onPick }) {
  const { gl } = useThree();
  const [hover, setHover] = useState(false);
  return (
    <group
      name={`BinderPocket_${slot}`}
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); setCursor(gl, 'pointer'); }}
      onPointerOut={() => { setHover(false); setCursor(gl, ''); }}
      onClick={(e) => { e.stopPropagation(); if (e.delta < 6) onPick(slot); }}
    >
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[POCKET_W + 0.025, POCKET_H + 0.025]} />
        <meshBasicMaterial color="#cbbd98" />
      </mesh>
      <mesh position={[0, 0, 0.006]}>
        <planeGeometry args={[POCKET_W, POCKET_H]} />
        <meshBasicMaterial color={hover ? '#fffdf5' : '#f4ecd8'} />
      </mesh>
      {hover && (
        <group position={[0, 0, 0.01]}>
          <mesh><planeGeometry args={[0.16, 0.026]} /><meshBasicMaterial color="#bd5948" /></mesh>
          <mesh><planeGeometry args={[0.026, 0.16]} /><meshBasicMaterial color="#bd5948" /></mesh>
        </group>
      )}
    </group>
  );
}

function PocketCard({ card, position, hidden, onSelect }) {
  const { gl } = useThree();
  const ref = useRef();
  const [hover, setHover] = useState(false);
  const texture = useMemo(() => getCardTexture(card), [card]);
  const { materialRef, drive: driveFoil } = useHoloFoil(card.rarity, CLUBHOUSE);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, hover ? 0.06 : 0.012, 12, delta);
    if (!hidden) driveFoil(state.clock.elapsedTime, delta, hover ? 0.6 : 0.26);
  });
  return (
    <group
      ref={ref}
      name={`BinderCard_${card.id}`}
      position={position}
      visible={!hidden}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); setCursor(gl, 'pointer'); }}
      onPointerOut={() => { setHover(false); setCursor(gl, ''); }}
      onClick={(e) => { e.stopPropagation(); if (e.delta < 6) onSelect(card); }}
    >
      <CardSlab width={POCKET_W} height={POCKET_H} depth={0.012} radius={0.014} smoothness={2} castShadow>
        <roomMaterial ref={materialRef} map={texture} roughness={0.3} metalness={0.04} />
      </CardSlab>
    </group>
  );
}

/** The chosen card, brought forward at the centre of the view and larger so it can be read. */
function FocusedCard({ card, onClose, lift }) {
  const ref = useRef();
  const texture = useMemo(() => getCardTexture(card, 'large'), [card]); // hi-res art for reading
  const { materialRef, drive: driveFoil } = useHoloFoil(card.rarity, CLUBHOUSE);
  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.scale.setScalar(THREE.MathUtils.damp(ref.current.scale.x, 1, 9, delta));
    driveFoil(state.clock.elapsedTime, delta, 0.7);
  });
  return (
    <group ref={ref} scale={0.5} position={[0, lift, 0.9]} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <CardSlab width={POCKET_W * 2.1} height={POCKET_H * 2.1} depth={0.02} radius={0.03} smoothness={3} castShadow>
        <roomMaterial ref={materialRef} map={texture} roughness={0.28} metalness={0.06} />
      </CardSlab>
    </group>
  );
}

export default function BinderBook({ active, binder, page, onPage, selectedCardId, onSelectCard, onPickSlot }) {
  const { camera, size, gl } = useThree();
  const groupRef = useRef();
  const contentRef = useRef();
  const forward = useRef(new THREE.Vector3());
  const pointer = useRef({ down: false, x: 0, wheel: 0 });
  const lastPage = useRef(page);

  const pocketSize = binder?.pocketSize ?? 'Nine';
  const per = pocketsPerPage(pocketSize);
  const bySlot = useMemo(() => new Map((binder?.cards ?? []).map((card) => [card.slotIndex, card])), [binder?.cards]);
  const total = pageCount([...bySlot.keys()], pocketSize);
  const aspect = size.width / size.height;
  const spread = aspect > 0.95;
  const pages = visiblePages(Math.min(page, total - 1), total, spread);
  const step = spread ? 2 : 1;
  const { w: pw, h: ph } = pageSize(pocketSize);
  const bookW = (spread ? pw * 2 : pw) + 0.06;
  const selectedCard = selectedCardId ? (binder?.cards ?? []).find((c) => c.id === selectedCardId) : null;

  // Fit the book to the free screen area (what the panels leave), measured from the page so it is right at any size.
  // The camera rig also slides the whole frame, so the book's own shift is whatever is left over (see useFrame).
  const metresPerPx = (2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / size.height;
  const framing = useRef({ scale: 1, centre: { x: size.width / 2, y: size.height / 2 }, shiftX: 0, shiftY: 0 });
  const tick = useRef(0);

  const go = (delta) => onPage(Math.max(0, Math.min(total - 1, (spread ? page - (page % 2) : page) + delta)));

  useFrame(() => {
    if (!active || !groupRef.current) return;
    if (tick.current++ % 6 === 0) {
      const free = freeRect(size.width, size.height, (bookW + COVER_MARGIN) / (ph + COVER_MARGIN));
      framing.current.scale = Math.min(FILL * free.w * metresPerPx / (bookW + COVER_MARGIN), FILL * free.h * metresPerPx / (ph + COVER_MARGIN));
      framing.current.centre = { x: free.x + free.w / 2, y: free.y + free.h / 2 };
    }
    // The rig may be sliding the whole frame (camera view offset, px); the book makes up the rest so it lands in the middle of the free area.
    const view = camera.view?.enabled ? camera.view : null;
    framing.current.shiftX = (framing.current.centre.x - size.width / 2 + (view?.offsetX ?? 0)) * metresPerPx;
    framing.current.shiftY = -(framing.current.centre.y - size.height / 2 + (view?.offsetY ?? 0)) * metresPerPx;
    camera.getWorldDirection(forward.current);
    groupRef.current.position.copy(camera.position).addScaledVector(forward.current, DISTANCE);
    groupRef.current.quaternion.copy(camera.quaternion);
    groupRef.current.scale.setScalar(framing.current.scale);
    groupRef.current.translateX(framing.current.shiftX);
    groupRef.current.translateY(framing.current.shiftY);
  });
  useFrame((_, delta) => {
    if (contentRef.current) contentRef.current.position.x = THREE.MathUtils.damp(contentRef.current.position.x, 0, 11, delta);
  });
  useEffect(() => { // slide new pages in from the side they were turned toward
    if (page !== lastPage.current && contentRef.current) contentRef.current.position.x = Math.sign(page - lastPage.current) * pw * 0.45;
    lastPage.current = page;
  }, [page, pw]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.target?.closest?.('input, select, textarea')) return;
      if (event.key === 'ArrowRight') go(step);
      else if (event.key === 'ArrowLeft') go(-step);
    };
    const onDown = (event) => {
      if (event.target?.closest?.('button, aside, nav, input, select')) return;
      pointer.current.down = true; pointer.current.x = event.clientX;
    };
    const onUp = (event) => {
      if (!pointer.current.down) return;
      pointer.current.down = false;
      const dx = event.clientX - pointer.current.x;
      if (Math.abs(dx) > SWIPE_PX) go(dx < 0 ? step : -step);
    };
    const onWheel = (event) => {
      if (event.target?.closest?.('aside, nav')) return;
      pointer.current.wheel += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(pointer.current.wheel) >= WHEEL_STEP) { go(pointer.current.wheel > 0 ? step : -step); pointer.current.wheel = 0; }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('wheel', onWheel);
      setCursor(gl, '');
    };
  });

  if (!active || !binder) return null;
  return (
    <group ref={groupRef}>
      <RoundedBox args={[bookW + 0.14, ph + 0.14, 0.07]} radius={0.04} smoothness={3} position={[0, 0, -0.05]} castShadow receiveShadow>
        <roomMaterial color={binder.accent ?? '#8a5a34'} roughness={0.55} metalness={0.05} />
      </RoundedBox>
      <group ref={contentRef}>
        {pages.map((p, k) => {
          const x = spread ? (k === 0 ? -pw / 2 - 0.01 : pw / 2 + 0.01) : 0;
          return (
            <group key={p} position={[x, 0, 0]}>
              <mesh position={[0, 0, 0]} receiveShadow>
                <planeGeometry args={[pw, ph]} />
                <roomMaterial color="#f7f0de" roughness={0.9} />
              </mesh>
              {Array.from({ length: per }, (_, i) => {
                const slot = p * per + i;
                const c = pocketCenter(pocketSize, i);
                const card = bySlot.get(slot);
                return card
                  ? <PocketCard key={slot} card={card} position={[c.x, c.y, 0.012]} hidden={card.id === selectedCardId} onSelect={onSelectCard} />
                  : <EmptyPocket key={slot} position={[c.x, c.y, 0]} slot={slot} onPick={onPickSlot} />;
              })}
            </group>
          );
        })}
        {spread && pages.length === 2 && (
          <mesh position={[0, 0, 0.002]}>
            <planeGeometry args={[0.03, ph]} />
            <meshBasicMaterial color="#d9cba6" />
          </mesh>
        )}
      </group>
      {selectedCard && <FocusedCard card={selectedCard} lift={0.02} onClose={() => onSelectCard(null)} />}
    </group>
  );
}
