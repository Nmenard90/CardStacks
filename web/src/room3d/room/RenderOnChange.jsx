/**
 * RenderOnChange.jsx — draws the room only while something in it is changing, always sharp when it is still.
 *
 * PURPOSE
 *   The room is still most of the time. Drawing it 60 times a second anyway keeps a laptop's fan going and a phone
 *   warm, and in a browser that draws 3D on the CPU (no graphics acceleration) it ties the computer up until the whole
 *   page freezes. The Canvas runs with frameloop="demand"; this decides when a frame is needed:
 *     - while anything moved or changed in the last few frames (the camera easing, a card lifting, a page turning),
 *     - when the visitor points, scrolls, taps or types anywhere on the page (hover and drag animations start there),
 *     - when something changes between frames (data arriving, a card picture finishing loading), found by comparing
 *       a cheap signature of the scene every animation frame (sceneSignature.js).
 *   Frames in which nothing changed aren't drawn at all. The shadow map is drawn once each time the room comes to rest
 *   after something in it moved, instead of every few frames.
 *
 * SHARP WHEN STILL
 *   A device too slow to draw the room at full size 30 times a second (moving frames averaging over SLOW_FRAME_MS) draws
 *   the frames in which the camera or furniture is moving smaller, into an off-screen picture stretched to fill the
 *   canvas. As soon as nothing moves, the room is drawn once more at full resolution. So the room is never blurry when
 *   you look at it, only for the moment it is in motion; a fast device always draws at full size.
 *
 * USED BY: RoomScene.jsx (inside the Canvas; it takes over drawing from react-three-fiber)
 * DEPENDS ON: @react-three/fiber, three, room/sceneSignature.js
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sceneSignature, viewSignature } from './sceneSignature.js';

const SETTLE_FRAMES = 6; // frames with nothing changing before the room stops checking
const TARGET_FRAME_MS = 33; // frame time aimed for while moving (30 frames a second)
const SLOW_FRAME_MS = 40; // average moving-frame time above which moving frames are drawn smaller
const SLOW_SAMPLE = 8; // moving frames averaged for that
const MIN_SCALE = 0.5; // never smaller than half size, even while moving
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'touchmove', 'resize'];

/** The off-screen picture moving frames are drawn into, and a full-screen rectangle that shows it. */
function useLowResPass(gl) {
  return useMemo(() => {
    // Half floats keep the light's full range (the tone mapping happens when it is stretched onto the screen); a
    // browser that can't draw into them gets ordinary 8-bit colour.
    const type = gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const target = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: true });
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // Transparent where the room's background is (cleared to nothing below), so the screen's own background colour
    // shows there exactly as in a full-size frame.
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthTest: false, depthWrite: false }));
    const scene = new THREE.Scene(); scene.add(quad);
    const size = new THREE.Vector2();
    return {
      target, scene, camera,
      draw(room, roomCamera, scale) {
        gl.getDrawingBufferSize(size);
        const w = Math.max(1, Math.round(size.x * scale)); const h = Math.max(1, Math.round(size.y * scale));
        if (target.width !== w || target.height !== h) target.setSize(w, h);
        const background = room.background;
        room.background = null;
        gl.setClearAlpha(0);
        gl.setRenderTarget(target); gl.clear(); gl.render(room, roomCamera);
        gl.setRenderTarget(null);
        room.background = background;
        scene.background = background; // the screen is cleared to the room's colour, then the picture laid over it
        gl.render(scene, camera);
      },
      dispose() { target.dispose(); quad.geometry.dispose(); quad.material.dispose(); },
    };
  }, [gl]);
}

export default function RenderOnChange() {
  const get = useThree((state) => state.get);
  const gl = useThree((state) => state.gl);
  const lowRes = useLowResPass(gl);
  const run = useRef({ awake: true, look: 0, camera: 0, drawn: 0, sharp: false, still: 0, shape: 0, shadowsDirty: true, lastMove: 0, slow: [], scale: 1 });

  useEffect(() => () => lowRes.dispose(), [lowRes]);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false; // drawn when the room comes to rest (below)
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl]);

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
      if (viewSignature(sceneSignature(scene).look, camera, [size.width, size.height, viewport.dpr]) !== r.drawn) wake();
    };
    raf = requestAnimationFrame(poll);
    for (const type of INPUT_EVENTS) window.addEventListener(type, wake, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, wake);
    };
  }, [get]);

  // Priority 1: react-three-fiber leaves the drawing to this, after every other per-frame update has run.
  useFrame((state) => {
    const r = run.current;
    const now = performance.now();
    const { shape, look } = sceneSignature(state.scene);
    const cameraSig = viewSignature(0, state.camera, [state.size.width, state.size.height, state.viewport.dpr]);
    const view = viewSignature(look, state.camera, [state.size.width, state.size.height, state.viewport.dpr]);
    const moving = shape !== r.shape || cameraSig !== r.camera; // something is in motion (not just a colour change)
    if (shape !== r.shape) r.shadowsDirty = true;
    r.shape = shape; r.camera = cameraSig;
    const changed = view !== r.drawn;
    r.still = changed ? 0 : r.still + 1;

    if (moving) {
      // Moving frames drawn back to back: if they keep taking too long, draw them smaller, in one step sized from how
      // slow they are. Never steps back up, so a struggling device doesn't flicker between sharpness levels.
      if (now - r.lastMove < 250) {
        r.slow.push(now - r.lastMove);
        if (r.slow.length > SLOW_SAMPLE) r.slow.shift();
        const average = r.slow.reduce((sum, ms) => sum + ms, 0) / r.slow.length;
        if (r.slow.length === SLOW_SAMPLE && average > SLOW_FRAME_MS && r.scale > MIN_SCALE) {
          r.scale = Math.max(MIN_SCALE, r.scale * Math.min(0.85, Math.sqrt(TARGET_FRAME_MS / average))); // time follows pixel count
          r.slow = [];
        }
      }
      r.lastMove = now;
    }

    if (moving && r.scale < 1) {
      lowRes.draw(state.scene, state.camera, r.scale);
      r.sharp = false;
    } else if (changed || !r.sharp || r.shadowsDirty) {
      // Full size: anything that changed without moving, and the first frame once motion stops (with fresh shadows).
      if (r.shadowsDirty && !moving) { state.gl.shadowMap.needsUpdate = true; r.shadowsDirty = false; }
      state.gl.render(state.scene, state.camera);
      r.sharp = true;
    }
    r.drawn = view;

    if (r.still < SETTLE_FRAMES || !r.sharp || r.shadowsDirty) state.invalidate();
    else r.awake = false;
  }, 1);
  return null;
}
