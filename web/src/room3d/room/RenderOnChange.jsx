/**
 * RenderOnChange.jsx — draws the room only while something in it is changing.
 *
 * PURPOSE
 *   The room is still most of the time. Drawing it 60 times a second anyway keeps a laptop's fan going and a phone
 *   warm, and in a browser that draws 3D on the CPU (no graphics acceleration) it ties the computer up until the whole
 *   page freezes. The Canvas runs with frameloop="demand"; this decides when a frame is needed:
 *     - while anything moved or changed in the last few frames (the camera easing, a card lifting, a page turning),
 *     - when the visitor points, scrolls, taps or types anywhere on the page (hover and drag animations start there),
 *     - when something changes between frames (data arriving, a card picture finishing loading), found by comparing
 *       a cheap signature of the scene every animation frame (sceneSignature.js).
 *   It also draws the shadow map once each time the room comes to rest after something in it moved (not when only a
 *   colour changed, nor when only the camera moved), instead of every few frames, and asks for a lower pixel ratio
 *   (onSlow) if frames keep taking too long while the room is moving.
 *
 * USED BY: RoomScene.jsx (inside the Canvas)
 * DEPENDS ON: @react-three/fiber, room/sceneSignature.js
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { sceneSignature, viewSignature } from './sceneSignature.js';

const SETTLE_FRAMES = 6; // frames with nothing changing before the room stops drawing
const TARGET_FRAME_MS = 33; // frame time aimed for while moving (30 frames a second)
const SLOW_FRAME_MS = 40; // average frame time while moving above which the pixel ratio steps down
const SLOW_SAMPLE = 8; // frames averaged for that
const MIN_DPR = 0.5;
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'touchmove', 'resize'];

/**
 * @param {{ onSlow: (dpr: number) => void }} props  called with a lower pixel ratio to draw at; the Canvas owner keeps
 *   it in its `dpr` prop (react-three-fiber puts the prop's value back on every re-render otherwise)
 */
export default function RenderOnChange({ onSlow }) {
  const get = useThree((state) => state.get);
  const run = useRef({ awake: true, view: 0, shape: 0, still: 0, shadowsDirty: true, lastFrame: 0, slow: [], lastStep: 0 });

  useEffect(() => {
    const { gl } = get();
    gl.shadowMap.autoUpdate = false; // drawn when the room comes to rest (below)
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [get]);

  useEffect(() => {
    const r = run.current;
    // Waking resets the clock, so the first frame eases on from where everything was instead of jumping by the
    // whole time spent asleep.
    const wake = () => {
      const { invalidate, clock } = get();
      if (!r.awake) { clock.getDelta(); r.awake = true; r.still = 0; }
      invalidate();
    };
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      if (r.awake) return;
      const { scene, camera, size, viewport } = get();
      if (viewSignature(sceneSignature(scene).look, camera, [size.width, size.height, viewport.dpr]) !== r.view) wake();
    };
    raf = requestAnimationFrame(poll);
    for (const type of INPUT_EVENTS) window.addEventListener(type, wake, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, wake);
    };
  }, [get]);

  useFrame((state) => {
    const r = run.current;
    const now = performance.now();
    const { shape, look } = sceneSignature(state.scene);
    const view = viewSignature(look, state.camera, [state.size.width, state.size.height, state.viewport.dpr]);
    if (shape !== r.shape) { r.shape = shape; r.shadowsDirty = true; }
    if (view !== r.view) { r.view = view; r.still = 0; } else r.still += 1;

    // Frames drawn back to back while moving: if they keep taking too long, draw fewer pixels, in one step sized from
    // how slow they are (each change of size costs a stall of its own). Never steps back up, so a struggling device
    // doesn't flicker between sharpness levels.
    if (r.still === 0 && now - r.lastFrame < 250) {
      r.slow.push(now - r.lastFrame);
      if (r.slow.length > SLOW_SAMPLE) r.slow.shift();
      const average = r.slow.reduce((sum, ms) => sum + ms, 0) / r.slow.length;
      if (r.slow.length === SLOW_SAMPLE && average > SLOW_FRAME_MS && state.viewport.dpr > MIN_DPR && now - r.lastStep > 1500) {
        const scale = Math.min(0.85, Math.sqrt(TARGET_FRAME_MS / average)); // drawing time roughly follows the pixel count
        onSlow(Math.max(MIN_DPR, state.viewport.dpr * scale));
        r.lastStep = now; r.slow = [];
      }
    }
    r.lastFrame = now;

    if (r.still < SETTLE_FRAMES) { state.invalidate(); return; }
    if (r.shadowsDirty) { state.gl.shadowMap.needsUpdate = true; r.shadowsDirty = false; state.invalidate(); return; }
    r.awake = false;
  });
  return null;
}
