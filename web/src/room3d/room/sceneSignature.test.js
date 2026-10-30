/** Scene and view signatures: what makes the room draw again (RenderOnChange.jsx). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sceneSignature, viewSignature } from './sceneSignature.js';

function room() {
  const scene = new THREE.Scene();
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
  scene.add(card);
  return { scene, card };
}

test('nothing changed, same signatures', () => {
  const { scene } = room();
  assert.deepEqual(sceneSignature(scene), sceneSignature(scene));
});

test('a move changes the shape (shadows redraw) and the look', () => {
  const { scene, card } = room();
  const before = sceneSignature(scene);
  card.position.y += 0.05;
  const after = sceneSignature(scene);
  assert.notEqual(after.shape, before.shape);
  assert.notEqual(after.look, before.look);
});

test('a colour or picture change redraws the view but not the shadows', () => {
  const { scene, card } = room();
  const before = sceneSignature(scene);
  card.material.color.set('#ff0000');
  let after = sceneSignature(scene);
  assert.equal(after.shape, before.shape);
  assert.notEqual(after.look, before.look);
  const map = new THREE.Texture(); card.material.map = map;
  const withMap = sceneSignature(scene);
  map.needsUpdate = true; // a card picture finishing loading
  after = sceneSignature(scene);
  assert.notEqual(after.look, withMap.look);
});

test('hiding or adding an object changes the shape', () => {
  const { scene, card } = room();
  const before = sceneSignature(scene).shape;
  card.visible = false;
  assert.notEqual(sceneSignature(scene).shape, before);
  card.visible = true;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  assert.notEqual(sceneSignature(scene).shape, before);
});

test('moves too small to see do not count, so an easing camera comes to rest', () => {
  const { scene, card } = room();
  const before = sceneSignature(scene);
  card.position.x += 1e-6;
  assert.deepEqual(sceneSignature(scene), before);
});

test('the view changes with the camera and the canvas size', () => {
  const { scene } = room();
  const camera = new THREE.PerspectiveCamera(37, 1.5, 0.1, 50);
  const look = sceneSignature(scene).look;
  const before = viewSignature(look, camera, [800, 600, 1]);
  camera.position.z += 0.1;
  assert.notEqual(viewSignature(look, camera, [800, 600, 1]), before);
  camera.position.z -= 0.1;
  assert.equal(viewSignature(look, camera, [800, 600, 1]), before);
  assert.notEqual(viewSignature(look, camera, [800, 600, 0.8]), before);
});
