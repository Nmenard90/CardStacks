/**
 * CardSlab.jsx — a rounded, thin box that shows a card texture across its whole face.
 *
 * drei's RoundedBox writes UVs in metres, so a 0.58 × 0.80 card samples only the
 * first ~0.6 × 0.8 of its texture: the art looks zoomed in and cropped. This
 * wrapper re-projects every vertex onto the face (u = x/width + ½, v = y/height + ½)
 * so the texture covers the card exactly once. Edge sides get a harmless stretch.
 */
import React, { useLayoutEffect, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import { normalizeFaceUVs } from './cardUV.js';

export default function CardSlab({ width, height, depth, radius, smoothness = 3, children, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (ref.current) normalizeFaceUVs(ref.current.geometry, width, height);
  }, [width, height, depth, radius, smoothness]);
  return <RoundedBox ref={ref} args={[width, height, depth]} radius={radius} smoothness={smoothness} {...props}>{children}</RoundedBox>;
}
