// Tests for graphics.ts: which WebGL renderers draw in software (the room freezes there). Node strips the types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isSoftwareRenderer } from './graphics.ts';

test('software rasterizers are recognised', () => {
  for (const name of [
    'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)', // the owner's Chrome, 2026-10-29
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Mesa OffScreen',
  ]) assert.equal(isSoftwareRenderer(name), true, name);
});

test('real graphics cards are not', () => {
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple GPU',
    'Adreno (TM) 740',
    'Mali-G78',
  ]) assert.equal(isSoftwareRenderer(name), false, name);
});
