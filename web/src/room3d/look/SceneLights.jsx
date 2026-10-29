/**
 * SceneLights.jsx — the scene's lighting rig, per look.
 *
 * classic: the original rig, unchanged (PCSS soft shadows, 3072 shadow map, bright sky/ground bounce).
 * lamplight: a warm amber key with the one shadow-casting light, a cool moss bounce, dim hemisphere, and up to two
 * shadowless amber point lights standing in for lamps out of frame (none on mobile). The room's own display-case
 * lights are separate and unchanged.
 */
import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, SoftShadows } from '@react-three/drei';
import { look } from './looks.js';

function ClassicRig() {
  return (
    <>
      <SoftShadows size={18} samples={16} focus={0.65} />
      <hemisphereLight args={['#c9e9ff', '#8f6746', 0.46]} />
      <ambientLight intensity={0.34} color="#fff2db" />
      <directionalLight position={[5, 9, 6]} intensity={1.28} color="#fff0ce" castShadow shadow-mapSize-width={look.shadowMapSize} shadow-mapSize-height={look.shadowMapSize} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-3} shadow-bias={-0.00012} shadow-normalBias={0.025} />
      <Environment resolution={look.envResolution}>
        <Lightformer intensity={2.4} color="#fff1d1" position={[0, 8, 5]} scale={[8, 8, 1]} />
        <Lightformer intensity={1.2} color="#bce6ff" position={[6, 4, 2]} scale={[3, 4, 1]} rotation-y={-Math.PI / 2} />
        <Lightformer intensity={0.8} color="#ffc98c" position={[-4, 2, 4]} scale={[2, 3, 1]} rotation-y={Math.PI / 2} />
      </Environment>
    </>
  );
}

/**
 * The room is static, so the shadow map does not need re-rendering every frame (that re-draws every caster each time).
 * Turn automatic updates off and refresh a few times a second, which also catches furniture and cards as they load or move.
 */
const SHADOW_REFRESH_FRAMES = 20;
export function ThrottledShadows() {
  const gl = useThree((state) => state.gl);
  const frame = useRef(0);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.autoUpdate = true; };
  }, [gl]);
  useFrame(() => { if (++frame.current % SHADOW_REFRESH_FRAMES === 0) gl.shadowMap.needsUpdate = true; });
  return null;
}

function LamplightRig() {
  return (
    <>
      <ThrottledShadows />
      <hemisphereLight args={['#93a48b', '#3a2a1e', 0.62]} />
      <ambientLight intensity={0.3} color="#ffd9b0" />
      <directionalLight position={[4.5, 7.5, 5]} intensity={1.5} color="#ffc88a" castShadow shadow-mapSize-width={look.shadowMapSize} shadow-mapSize-height={look.shadowMapSize} shadow-camera-left={-5.5} shadow-camera-right={5.5} shadow-camera-top={5.5} shadow-camera-bottom={-3} shadow-camera-far={20} shadow-bias={-0.00015} shadow-normalBias={0.03} />
      {look.points.map((p, i) => <pointLight key={i} position={p.position} color={p.color} intensity={p.intensity} distance={p.distance} decay={2} />)}
      <Environment resolution={look.envResolution}>
        <Lightformer intensity={0.7} color="#ffcf94" position={[0, 7, 5]} scale={[7, 6, 1]} />
        <Lightformer intensity={0.35} color="#7fa08c" position={[-5, 3, 3]} scale={[3, 4, 1]} rotation-y={Math.PI / 2} />
      </Environment>
    </>
  );
}

export default function SceneLights() {
  return look.name === 'classic' ? <ClassicRig /> : <LamplightRig />;
}
