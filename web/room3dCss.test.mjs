/** room3dCss.test.mjs — every room selector ends up under .room3d. Run: npm run test:server */
import test from 'node:test'
import assert from 'node:assert/strict'
import { scopeRoomSelector } from './room3dCss.mjs'

test('scopes room selectors under .room3d', () => {
  assert.equal(scopeRoomSelector('.hud'), '.room3d .hud')
  assert.equal(scopeRoomSelector('.back-btn:hover'), '.room3d .back-btn:hover')
  assert.equal(scopeRoomSelector('canvas'), '.room3d canvas')
  assert.equal(scopeRoomSelector('*'), '.room3d *')
  assert.equal(scopeRoomSelector('.ui-site .hud b'), '.room3d.ui-site .hud b')
  assert.equal(scopeRoomSelector('html'), '.room3d')
  assert.equal(scopeRoomSelector('#root'), '.room3d')
  assert.equal(scopeRoomSelector(':root'), 'html:has(.room3d)')
  assert.equal(scopeRoomSelector('.room3d-stage'), '.room3d-stage')
})
