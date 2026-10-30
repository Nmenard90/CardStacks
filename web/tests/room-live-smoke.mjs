/**
 * room-live-smoke.mjs — the 3D room against the REAL backend, on a brand-new anonymous demo account.
 *
 * PURPOSE
 *   The mocked browser test (room-browser.mjs) proves the room's behaviour; this proves the real API answers in the
 *   shapes the room reads. It signs in with "Try the demo" (an isolated anonymous account the backend deletes after
 *   24 hours), adds a few cards and a binder through the same endpoints the site uses, then checks the room shows
 *   them with real prices and that placing a card in a binder pocket from the room is saved on the server.
 *   Nothing outside that throwaway demo account is read or changed.
 *
 * RUN
 *   A dev server with the real Supabase values (web/.env.local) and the default /api proxy, e.g. on port 5180, then
 *     ROOM_LIVE_ORIGIN=http://127.0.0.1:5180 node tests/room-live-smoke.mjs
 *   Env: PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM_EXECUTABLE, ROOM_TEST_SHOTS (as in room-browser.mjs).
 *
 * USED BY: developers / agents before shipping room changes (see docs/agent-reports/room3d-landing)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../../', import.meta.url))
const shots = process.env.ROOM_TEST_SHOTS || path.join(root, 'docs/agent-reports/room3d-landing')
fs.mkdirSync(shots, { recursive: true })
const origin = process.env.ROOM_LIVE_ORIGIN || 'http://127.0.0.1:5180'

const browser = await chromium.launch({
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()) })
const steps = []
const step = async (name, fn) => {
  try { await fn(); steps.push({ name, ok: true }); console.log(`  ✓ ${name}`) }
  catch (e) { steps.push({ name, ok: false, error: String(e?.message ?? e) }); console.log(`  ✗ ${name}\n      ${String(e?.message ?? e).split('\n')[0]}`); await page.screenshot({ path: path.join(shots, `LIVE-FAIL-${steps.length}.png`) }).catch(() => {}); throw e }
}

/** Calls the real API from inside the page with the demo session's own token (same as the app's axios client). */
const api = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))
  const token = JSON.parse(localStorage.getItem(key)).access_token
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}game=pokemon`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}, { method, url, body })

/** Waits until the camera has stopped moving. */
const settle = () => page.evaluate(() => new Promise((resolve) => {
  const { camera } = window.__nook3d
  let last = '', still = 0, frames = 0
  const tick = () => { const now = camera.position.toArray().map(n => n.toFixed(3)).join(); still = now === last ? still + 1 : 0; last = now; if (still >= 3 || ++frames > 600) resolve(); else requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
}))
const centre = (name) => page.evaluate((name) => {
  const { scene, camera, gl } = window.__nook3d
  const o = scene.getObjectByName(name); if (!o) return null
  let best = null; o.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingSphere(); if (!best || m.geometry.boundingSphere.radius > best.geometry.boundingSphere.radius) best = m } })
  const v = best.localToWorld(best.geometry.boundingSphere.center.clone()).project(camera), r = gl.domElement.getBoundingClientRect()
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }
}, name)

let userId, binderId
console.log(`Live smoke against ${origin} (real backend, throwaway demo account)`)
try {
  await step('sign in with "Try the demo" lands on the room with the guide', async () => {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Try the demo/ }).click({ timeout: 30000 })
    await page.getByRole('dialog', { name: 'This is your collection room' }).waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: 'Skip' }).click()
    await page.locator('.room3d .sync-chip', { hasText: 'cards' }).waitFor({ timeout: 60000 })
    assert.match(await page.locator('.room3d .sync-chip').innerText(), /0 cards · 0 binders · 0 boxes/)
    await page.getByRole('button', { name: /Add your first cards/ }).waitFor()
    await page.screenshot({ path: path.join(shots, 'live-empty-room.png') })
  })

  await step('add cards and a binder through the real API', async () => {
    userId = (await api('GET', '/api/auth/me')).id
    for (const [cardId, quantity] of [['base1-4', 2], ['base1-2', 1], ['base1-15', 1]]) {
      await api('POST', `/api/collection/${userId}/${cardId}`, { conditions: [{ condition: 'NM', quantity }], selectedCond: 'NM' })
    }
    const binder = await api('POST', `/api/binders/${userId}`, { name: 'Smoke Binder', pocketSize: 'Nine' })
    binderId = binder.id
    await api('PUT', `/api/binders/${userId}/${binderId}/slot/0`, { cardId: 'base1-4', cardName: 'Charizard', imageUrl: 'https://images.pokemontcg.io/base1/4.png' })
  })

  await step('the room shows them after a reload, with real prices', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.room3d .sync-chip', { hasText: /4 cards · 1 binders · \d+ boxes/ }).waitFor({ timeout: 60000 })
    await page.goto(`${origin}/#/binders/${binderId}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Smoke Binder' }).waitFor({ timeout: 30000 })
    await page.waitForFunction((id) => Boolean(window.__nook3d?.scene.getObjectByName(`BinderCard_pocket:${id}:0`)), binderId)
    await settle()
    const at = await centre(`BinderCard_pocket:${binderId}:0`)
    await page.mouse.click(at.x, at.y); await settle()
    const facts = await page.locator('.room3d .item-panel').innerText()
    assert.match(facts, /Charizard/); assert.match(facts, /\$[\d,]+\.\d\d/)
    await page.screenshot({ path: path.join(shots, 'live-binder-card.png') })
  })

  await step('auto-filed box opens in the room with the owned copies', async () => {
    const boxes = await api('GET', `/api/storage/${userId}/boxes`)
    assert(boxes.length >= 1, 'no box was auto-filed')
    await page.goto(`${origin}/#/storage/${boxes[0].id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.room3d .drawer-card').first().waitFor({ timeout: 30000 })
    const list = await page.locator('.room3d .drawer-cards').innerText()
    assert.match(list, /Charizard|Blastoise|Venusaur/)
    // The box's cards also stand in the 3D rolodex in front of the camera.
    await page.waitForFunction(() => { let n = 0; window.__nook3d.scene.traverse(o => { if (o.name.startsWith('RolodexCard_') && o.visible) n++ }); return n >= 3 }, null, { timeout: 30000 })
    await settle(); await page.waitForTimeout(1500) // let the card art download before the picture
    await page.screenshot({ path: path.join(shots, 'live-box.png') })
  })

  await step('placing a card in a binder pocket from the room is saved on the server', async () => {
    await page.goto(`${origin}/#/binders/${binderId}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '+ Add card' }).click({ timeout: 30000 })
    await page.waitForFunction(() => { let found = false; window.__nook3d.scene.traverse(o => { if (o.name.startsWith('RolodexCard_')) found = true }); return found })
    await settle()
    const names = await page.evaluate(() => { const out = []; window.__nook3d.scene.traverse(o => { if (o.name.startsWith('RolodexCard_')) out.push(o.name) }); return out })
    const at = await centre(names[0])
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction(() => !document.querySelector('.room3d .view-bar__add')?.disabled)
    await page.locator('.room3d .view-bar__add').click()
    await page.locator('.room3d .view-bar--picker').waitFor({ state: 'detached', timeout: 30000 })
    const saved = await api('GET', `/api/binders/${userId}/${binderId}`)
    const filled = saved.slots.filter(s => s.cardId)
    assert.equal(filled.length, 2, `server has ${filled.length} filled pockets`)
    assert.equal(filled.find(s => s.slotIndex === 1)?.cardId, names[0].replace('RolodexCard_', ''))
  })

  await step('no page errors', async () => assert.deepEqual(errors, []))
} catch { /* reported above */ }

await browser.close()
fs.writeFileSync(path.join(shots, 'live-results.json'), JSON.stringify({ at: new Date().toISOString(), origin, steps }, null, 2))
const failed = steps.filter(s => !s.ok).length
console.log(`\n${steps.length - failed}/${steps.length} live steps passed`)
process.exit(failed ? 1 : 0)
