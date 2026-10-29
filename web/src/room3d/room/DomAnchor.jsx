/**
 * DomAnchor.jsx — HTML pinned to a point in the 3D scene (a label over a card, a focusable button over a display slot).
 *
 * PURPOSE
 *   Does the job of drei's <Html> for the few places the room needs it. drei's version unmounts its React root
 *   synchronously while React is still committing, which React 19 reports as an error every time one disappears
 *   (opening/closing the display cabinet, leaving the page). This one renders into its own root the same way, but
 *   hands the root back after the current commit finishes, so nothing is reported and nothing leaks.
 *
 * HOW IT WORKS
 *   An empty <group> marks the point. Each frame its world position is projected with the scene camera (including
 *   the camera rig's view offset) and the HTML layer is moved there with a transform; behind the camera it hides.
 *
 * USED BY: Room.jsx (display-slot buttons), CardRolodex.jsx (picked-card label)
 * DEPENDS ON: @react-three/fiber, react-dom/client
 */
import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const point = new THREE.Vector3();

/**
 * @param {{ position?: [number, number, number], center?: boolean, zIndex?: number, style?: React.CSSProperties, children: React.ReactNode }} props
 *   center  put the HTML's middle (not its top-left corner) on the point
 *   zIndex  stacking order among the room's other HTML
 */
export default function DomAnchor({ position = [0, 0, 0], center = false, zIndex = 4, style, children }) {
  const marker = useRef(null);
  const gl = useThree((state) => state.gl);
  const layer = useRef(null);
  const root = useRef(null);

  // Each mount gets its own layer and root (StrictMode mounts twice; a shared layer would be removed by the first cleanup).
  useLayoutEffect(() => {
    const el = document.createElement('div');
    // The layer itself never takes pointer events: R3F aims its ray from the event's offset inside the element hit,
    // so a layer over the canvas would send taps to the wrong place. Content opts back in through `style`.
    el.style.cssText = `position:absolute;top:0;left:0;z-index:${zIndex};will-change:transform;pointer-events:none;`;
    gl.domElement.parentNode?.appendChild(el);
    const current = createRoot(el);
    layer.current = el; root.current = current;
    return () => {
      if (root.current === current) { root.current = null; layer.current = null; }
      // Unmount after React finishes the commit that removed this anchor (a synchronous unmount here is the drei bug).
      queueMicrotask(() => { current.unmount(); el.remove(); });
    };
  }, [gl, zIndex]);

  useLayoutEffect(() => {
    root.current?.render(<div style={{ ...(center ? { transform: 'translate(-50%, -50%)' } : null), ...style }}>{children}</div>);
  });

  useFrame(({ camera, size }) => {
    const el = layer.current;
    if (!marker.current || !el) return;
    point.setFromMatrixPosition(marker.current.matrixWorld).project(camera);
    const hidden = point.z > 1 || !marker.current.visible;
    el.style.display = hidden ? 'none' : '';
    if (!hidden) el.style.transform = `translate3d(${((point.x + 1) / 2) * size.width}px, ${((1 - point.y) / 2) * size.height}px, 0)`;
  });

  return <group ref={marker} position={position} />;
}
