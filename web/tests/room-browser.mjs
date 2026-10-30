/**
 * room-browser.mjs — drives the 3D room landing page in a real Chromium (WebGL) at desktop, tablet and phone sizes.
 *
 * PURPOSE
 *   Proves the room works end to end against a realistic collection: the first-visit guide, the room drawing,
 *   every zone, opening a binder / box / display card from the furniture AND from the lists, reading a card's
 *   price, filling a binder pocket (the PUT the binder page makes), furniture that opens other pages, the back
 *   button, old Spaces links, card art through the /card-art relay, and that nothing overlaps or overflows.
 *   All API and auth traffic is intercepted, so nothing live is read or changed (card images load from their CDNs).
 *
 * RUN
 *   1. Start the dev server with QA Supabase values, e.g.
 *        VITE_SUPABASE_URL=https://qa.supabase.co VITE_SUPABASE_ANON_KEY=qa npx vite --port 5179 --strictPort
 *   2. node tests/room-browser.mjs
 *   Env: ROOM_TEST_ORIGIN (default http://127.0.0.1:5179), PLAYWRIGHT_MODULE (path to playwright or playwright-core),
 *        PLAYWRIGHT_CHROMIUM_EXECUTABLE (e.g. an installed Chrome), ROOM_TEST_SHOTS (screenshot folder).
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
const origin = process.env.ROOM_TEST_ORIGIN || 'http://127.0.0.1:5179'

// ─── Fixture: one collector's room ─────────────────────────────────────────
const now = new Date().toISOString()
const U = 'qa-owner'
const user = { id: U, supabaseUserId: U, username: 'Graton\'s human', email: 'qa@example.test', role: 'Collector', reputation: 0, isAnonymous: false, createdAt: now }
const img = (set, n) => ({ small: `https://images.pokemontcg.io/${set}/${n}.png`, large: `https://images.pokemontcg.io/${set}/${n}_hires.png` })
const NAMES = ['Alakazam', 'Blastoise', 'Chansey', 'Charizard', 'Clefairy', 'Gyarados', 'Hitmonchan', 'Machamp', 'Magneton', 'Mewtwo', 'Nidoking', 'Ninetales', 'Poliwrath', 'Raichu', 'Venusaur', 'Zapdos']
const card = (i) => ({
  id: `base1-${i + 1}`, setId: 'base1', name: NAMES[i % NAMES.length], number: String(i + 1), rarity: i < 16 ? 'Rare Holo' : 'Common',
  artist: 'Ken Sugimori', images: img('base1', i + 1), prices: { nm: 10 + i * 7.5, lp: 8 + i * 6 },
})
const cards = Array.from({ length: 40 }, (_, i) => card(i))
// One TCGTracking-style card whose art lives on TCGplayer's CDN (no CORS) — must load through /card-art.
const ttCard = { id: 'tt3-24380-512345', setId: 'tt3-24380', name: 'Mega Lucario ex', number: '079', rarity: 'Double Rare', images: { small: 'https://tcgplayer-cdn.tcgplayer.com/product/42382_200w.jpg', large: 'https://tcgplayer-cdn.tcgplayer.com/product/42382_in_1000x1000.jpg' }, prices: { nm: 18.5 } }
cards.push(ttCard)
const owned = cards.map((c, i) => ({ cardId: c.id, conditions: [{ condition: 'NM', quantity: 1 + (i % 3) }], selectedCond: 'NM', updatedAt: now, card: c }))
const lots = cards.map((c, i) => ({ id: `lot-${i}`, userId: U, cardId: c.id, variantKey: 'normal', edition: '', language: 'en', condition: 'NM', quantity: 1 + (i % 3), allocated: 0, createdAt: now, updatedAt: now }))

const rack = { id: 'unit-rack', spaceId: 'space-1', name: 'Heavy-Duty Rack', unitType: 'rack', preset: 'heavy_duty_rack', color: '#4b4f52', shelfCount: 5, positionsPerShelf: 6, maxStackHeight: 4, position: 0, config: '{}', createdAt: now, updatedAt: now }
const shelf = { id: 'unit-shelf', spaceId: 'space-1', name: 'Wood Collection Shelf', unitType: 'shelf', preset: 'wood_shelf', color: '#8a5a34', shelfCount: 4, positionsPerShelf: 5, maxStackHeight: 3, position: 1, config: '{}', createdAt: now, updatedAt: now }
const caseSlots = Array.from({ length: 6 }, (_, i) => ({ id: `dslot-${i}`, displayCaseId: 'case-1', shelfIndex: Math.floor(i / 3), slotIndex: i % 3 }))
const displayCase = { id: 'case-1', spaceId: 'space-1', name: 'Grail Cabinet', caseType: 'lit_cabinet', preset: 'lit_cabinet', frameColor: '#2b2b2b', lightColor: '#fff4d6', lightEnabled: true, shelfCount: 2, slotsPerShelf: 3, position: 0, config: '{}', slots: caseSlots, createdAt: now, updatedAt: now }
const spaces = [{ id: 'space-1', userId: U, name: 'My Collection Room', spaceType: 'collection_room', isDefault: true, position: 0, storageUnits: [rack, shelf], displayCases: [displayCase], createdAt: now, updatedAt: now }]
const BOX_COLORS = ['#d8d0c0', '#315c73', '#98483e', '#50684c', '#68527a']
const boxes = Array.from({ length: 8 }, (_, b) => ({
  id: `box-${b}`, userId: U, name: b === 0 ? 'Base Set Box' : `Bulk Box ${b}`, kind: 'box', boxType: b % 2 ? 'row-1600' : 'long-800', capacity: b % 2 ? 1600 : 800, color: BOX_COLORS[b % 5],
  position: b, spaceId: 'space-1', storageUnitId: 'unit-rack', shelfIndex: Math.floor(b / 3), stackIndex: b % 3, stackLevel: 0,
  drawers: Array.from({ length: b === 0 ? 2 : 1 }, (_, d) => ({ id: `drawer-${b}-${d}`, boxId: `box-${b}`, name: d ? 'Holos' : 'Main', position: d, cardCount: 0, createdAt: now, updatedAt: now })),
  createdAt: now, updatedAt: now,
}))
// Drawer contents: box 0 gets cards 0-11 (split across its two compartments) plus the TCGplayer card; others a few each.
const drawerAllocs = {}
const alloc = (drawerId, lotIndex, quantity = 1) => (drawerAllocs[drawerId] ??= []).push({ id: `alloc-${drawerId}-${lotIndex}`, lotId: `lot-${lotIndex}`, drawerId, quantity, protection: 'sleeved', createdAt: now, updatedAt: now })
for (let i = 0; i < 12; i++) alloc(i < 6 ? 'drawer-0-0' : 'drawer-0-1', i, 1)
alloc('drawer-0-0', 40, 1)
for (let b = 1; b < 8; b++) for (let k = 0; k < 3; k++) alloc(`drawer-${b}-0`, 12 + ((b * 3 + k) % 28), 1)
const caseAllocs = [0, 3, 9, 15].map((lotIndex, i) => ({ id: `calloc-${i}`, lotId: `lot-${lotIndex}`, displaySlotId: `dslot-${i}`, quantity: 1, protection: 'toploader', createdAt: now, updatedAt: now }))

const BINDER_NAMES = ['Base Set Binder', 'Holo Grails', 'Trade Binder', 'Japanese Promos', 'Starter Binder']
const binders = BINDER_NAMES.map((name, b) => ({
  id: `binder-${b}`, userId: U, name, pocketSize: b === 2 ? 'Four' : 'Nine', spaceId: 'space-1', storageUnitId: 'unit-shelf', shelfIndex: Math.floor(b / 3), shelfPosition: b % 3,
  slots: [], createdAt: now, updatedAt: now,
}))
binders.push({ id: 'binder-loose', userId: U, name: 'Loose Binder', pocketSize: 'Nine', slots: [], createdAt: now, updatedAt: now }) // unplaced
const binderSlots = {
  'binder-0': cards.slice(0, 14).map((c, i) => ({ slotIndex: i, cardId: c.id, cardName: c.name, imageUrl: c.images.small })),
  'binder-1': [{ slotIndex: 0, cardId: 'base2-1', cardName: 'Clefable', imageUrl: img('base2', 1).small }], // a card the user doesn't own
}
const sets = [{ id: 'base1', name: 'Base', series: 'Base', printedTotal: 102, total: 102, releaseDate: '1999/01/09', images: { symbol: '', logo: '' } },
  { id: 'base2', name: 'Jungle', series: 'Base', printedTotal: 64, total: 64, releaseDate: '1999/06/16', images: { symbol: '', logo: '' } }]

// ─── Harness ───────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
})
const results = []
const check = async (name, fn) => {
  const started = Date.now()
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - started }); console.log(`  ✓ ${name}`) }
  catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error) })
    console.log(`  ✗ ${name}\n      ${String(error?.message ?? error).split('\n')[0]}`)
    await check.page?.screenshot({ path: path.join(shots, `FAIL-${check.label}-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`) }).catch(() => {})
    const trail = await check.page?.evaluate(() => window.__trail?.slice(-12)).catch(() => null)
    if (trail) console.log(`      trail:\n        ${trail.join('\n        ')}`)
  }
}

async function setup({ width, height, touch = false, guideSeen = true, reducedMotion = 'reduce' }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, reducedMotion })
  await context.addInitScript(({ user, guideSeen }) => {
    if (location.protocol === 'about:') return // the blank first document has no storage
    const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' })}.cWE`
    localStorage.setItem('sb-qa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }))
    if (guideSeen) localStorage.setItem('cardstacks.roomGuide.v1', '1')
    // A short trail of navigation and pointer events, printed when a check fails.
    window.__trail = []
    const note = (text) => { window.__trail.push(`${Math.round(performance.now())} ${text}`); if (window.__trail.length > 40) window.__trail.shift() }
    for (const k of ['pushState', 'replaceState']) { const f = history[k].bind(history); history[k] = (st, t, u) => { note(`${k} ${u}`); return f(st, t, u) } }
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'click']) window.addEventListener(t, (e) => note(`${t} ${e.pointerType ?? ''} ${Math.round(e.clientX)},${Math.round(e.clientY)} on ${e.target?.tagName}`), true)
  }, { user, guideSeen })
  const state = { writes: [], requests: [], slots: structuredClone(binderSlots) }
  await context.route('https://qa.supabase.co/**', route => route.fulfill({ json: user }))
  await context.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method()
    state.requests.push(`${m} ${p}`)
    const json = (body) => route.fulfill({ json: body })
    if (m === 'PUT' && /^\/api\/binders\/qa-owner\/[^/]+\/slot\/\d+$/.test(p)) {
      const [, , , , binderId, , slot] = p.split('/')
      const body = req.postDataJSON()
      state.writes.push({ binderId, slot: Number(slot), body })
      state.slots[binderId] = [...(state.slots[binderId] ?? []).filter(s => s.slotIndex !== Number(slot)), { slotIndex: Number(slot), ...body }]
      return json({ ok: true })
    }
    if (m !== 'GET') return route.fulfill({ status: 405, body: `QA: unexpected ${m} ${p}` })
    if (p === '/api/auth/me') return json(user)
    if (p === '/api/games') return json([{ id: 'pokemon', name: 'Pokémon', shortName: 'Pokémon', enabled: true }])
    if (p === '/api/sets') return json(sets)
    if (p === `/api/spaces/${U}`) return json(spaces)
    if (p === `/api/spaces/${U}/inventory`) return json(lots)
    if (p === `/api/storage/${U}/boxes`) return json(boxes)
    if (p === `/api/binders/${U}`) return json(binders.map(b => ({ ...b, slots: [] })))
    const binder = p.match(/^\/api\/binders\/qa-owner\/([^/]+)$/)
    if (binder) { const b = binders.find(x => x.id === binder[1]); return b ? json({ ...b, slots: state.slots[b.id] ?? [] }) : route.fulfill({ status: 404, body: 'no binder' }) }
    const drawer = p.match(/^\/api\/spaces\/qa-owner\/drawers\/([^/]+)\/allocations$/)
    if (drawer) return json(drawerAllocs[drawer[1]] ?? [])
    if (p === `/api/spaces/${U}/display-cases/case-1/allocations`) return json(caseAllocs)
    if (p === `/api/collection/${U}/owned`) return json(owned)
    if (p === `/api/collection/${U}`) return json(owned.map(o => ({ ...o, id: o.cardId, userId: U })))
    if (p === `/api/collection/${U}/stats`) return json({ totalCards: 80, uniqueCards: 41, totalValue: 1234, setsEntered: 2 })
    if (p === '/api/cards/base2') return json([{ id: 'base2-1', setId: 'base2', name: 'Clefable', number: '1', rarity: 'Rare Holo', images: img('base2', 1), prices: { nm: 42 } }])
    if (p.startsWith('/api/cards/')) return json([])
    if (p === '/api/search') { const q = (url.searchParams.get('q') ?? '').toLowerCase(); return json(cards.filter(c => c.name.toLowerCase().includes(q)).slice(0, 60)) }
    if (p.includes('unread')) return json({ count: 0 })
    return route.fulfill({ status: 404, body: `QA route not defined: ${p}` })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (msg.type() === 'error' && !/Failed to load resource|favicon/.test(msg.text())) errors.push(msg.text()) })
  return { context, page, state, errors }
}

/** Waits until the room has loaded the collection and drawn at least one frame. */
async function roomReady(page) {
  await page.locator('.room3d .sync-chip', { hasText: 'cards' }).waitFor({ timeout: 45000 })
  await page.waitForFunction(() => Boolean(window.__nook3d?.scene?.getObjectByName('DisplayHit_0')), null, { timeout: 45000 })
  await settle(page)
}

/** Waits until the camera has stopped moving (software WebGL draws slowly, so a fixed pause isn't enough). */
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    const { camera } = window.__nook3d
    let last = '', still = 0, frames = 0
    const tick = () => {
      const now = camera.position.toArray().map(n => n.toFixed(3)).join() + camera.view?.offsetX?.toFixed?.(1)
      still = now === last ? still + 1 : 0; last = now
      if (still >= 3 || ++frames > 600) resolve(); else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

/**
 * Screen position (page px) of the centre of a named object or furniture piece, or of one binder/box on a shelf unit
 * ({ name: 'ShelfUnit_binders', instance: 0 }: the unit's first item). Null if it isn't on screen.
 */
async function screenPoint(page, { name, pieceType, instance }) {
  return page.evaluate(({ name, pieceType, instance }) => {
    const { scene, camera, gl, THREE } = window.__nook3d
    let target = null
    if (name) target = scene.getObjectByName(name)
    else scene.traverse(o => { if (!target && o.userData?.pieceType === pieceType) target = o })
    if (!target) return null // hit targets may be invisible on purpose; the raycaster still finds them
    // Shelf units are instanced meshes: aim at their overall box, or at one instance. Anything else: the centre of its biggest mesh.
    let v
    if (instance != null) {
      let mesh = null
      target.traverse(o => { if (!mesh && o.isInstancedMesh && o.count > instance) mesh = o })
      if (!mesh) return null
      const m = new THREE.Matrix4(); mesh.getMatrixAt(instance, m)
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      v = mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(m).applyMatrix4(mesh.matrixWorld) // the model's middle, not its origin
    } else if (name?.startsWith('ShelfUnit_')) v = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3())
    else {
      let best = null
      target.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingSphere(); if (!best || o.geometry.boundingSphere.radius > best.geometry.boundingSphere.radius) best = o } })
      if (!best) return null
      v = best.localToWorld(best.geometry.boundingSphere.center.clone())
    }
    v.project(camera)
    const r = gl.domElement.getBoundingClientRect()
    const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && v.z < 1 ? { x, y } : { miss: { x: Math.round(x), y: Math.round(y), z: v.z, canvas: [r.left, r.top, r.width, r.height], hash: location.hash, same: (() => { const all = []; scene.traverse(o => { if (o.name === name) { const p = o.getWorldPosition(new THREE.Vector3()).project(camera); let vis = true; o.traverseAncestors(a => { if (!a.visible) vis = false }); all.push([Math.round(r.left + (p.x + 1) / 2 * r.width), Math.round(r.top + (1 - p.y) / 2 * r.height), vis]) } }); return all })() } }
  }, { name, pieceType, instance })
}

/** On-screen height in px of one binder/box on a shelf unit — how big its name label is drawn. */
async function itemHeightPx(page, name) {
  return page.evaluate((name) => {
    const { scene, camera, gl, THREE } = window.__nook3d
    let mesh = null
    scene.getObjectByName(name).traverse(o => { if (!mesh && o.isInstancedMesh && o.count) mesh = o })
    mesh.geometry.computeBoundingBox()
    const m = new THREE.Matrix4(); mesh.getMatrixAt(0, m); m.premultiply(mesh.matrixWorld)
    const b = mesh.geometry.boundingBox, h = gl.domElement.getBoundingClientRect().height
    const y = (v) => (1 - v.applyMatrix4(m).project(camera).y) / 2 * h
    return Math.abs(y(new THREE.Vector3(0, b.min.y, 0)) - y(new THREE.Vector3(0, b.max.y, 0)))
  }, name)
}
async function clickObject(page, target, touch) {
  await settle(page)
  // The target itself may still be moving (a binder sliding beside an opening panel, a card lifting). Software WebGL
  // draws only a few frames a second, so wait for rendered FRAMES, not time: eight in a row with no movement (the
  // layouts re-measure the free screen area every 6 frames, so fewer could fall between two re-measures).
  await page.evaluate(({ name, pieceType }) => new Promise((resolve) => {
    const { scene, camera, THREE } = window.__nook3d
    let target = null
    if (name) target = scene.getObjectByName(name)
    else scene.traverse(o => { if (!target && o.userData?.pieceType === pieceType) target = o })
    if (!target) return resolve()
    let last = null, still = 0, frames = 0
    const tick = () => {
      const p = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3()).project(camera)
      still = last && Math.hypot(p.x - last.x, p.y - last.y) < 0.001 ? still + 1 : 0; last = p
      if (still >= 8 || ++frames > 600) resolve(); else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), target)
  const point = await screenPoint(page, target)
  assert(point && !point.miss, `${JSON.stringify(target)} is not on screen ${JSON.stringify(point?.miss ?? null)}`)
  if (process.env.ROOM_TEST_DEBUG) console.log('      hits at', target, await page.evaluate(({ x, y }) => {
    const { scene, camera, gl, THREE } = window.__nook3d, r = gl.domElement.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera)
    const top = document.elementFromPoint(x, y)
    return { dom: top?.className?.toString().slice(0, 60), hits: ray.intersectObjects(scene.children, true).slice(0, 3).map(h => { const c = [h.point.toArray().map(n => n.toFixed(2)).join(','), h.object.getWorldPosition(new THREE.Vector3()).toArray().map(n => n.toFixed(2)).join(','), h.object.material?.name || '', h.object.material?.transparent ? 'transparent' : '', h.object.geometry?.type]; let o = h.object; while (o && c.length < 7) { c.push(o.name || o.userData?.pieceType || o.type); o = o.parent } return c.join('<') }) }
  }, point))
  if (touch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(150)
  await settle(page)
}

/** Distinct colours in a grid of canvas pixels — a blank or single-colour canvas means nothing rendered. */
async function renderedColours(page) {
  return page.evaluate(() => {
    const { scene, camera, gl } = window.__nook3d
    gl.render(scene, camera)
    const ctx = gl.getContext(), w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight, px = new Uint8Array(4), seen = new Set()
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { ctx.readPixels(Math.floor(w * i / 12), Math.floor(h * j / 12), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px); seen.add(px.join(',')) }
    return seen.size
  })
}

/** Fails if any two visible controls overlap, or the page scrolls sideways. */
async function layoutSound(page, selectors) {
  const problems = await page.evaluate((selectors) => {
    const boxes = selectors.flatMap(sel => [...document.querySelectorAll(sel)].map(el => ({ sel, r: el.getBoundingClientRect(), shown: getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' })))
      .filter(b => b.shown && b.r.width > 0 && b.r.height > 0)
    const out = []
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r
      if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) out.push(`${boxes[i].sel} overlaps ${boxes[j].sel}`)
    }
    const stage = document.querySelector('.room3d')?.getBoundingClientRect()
    for (const b of boxes) if (stage && (b.r.left < stage.left - 1 || b.r.right > stage.right + 1 || b.r.top < stage.top - 1 || b.r.bottom > stage.bottom + 1)) out.push(`${b.sel} spills outside the room`)
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('horizontal page overflow')
    const nav = document.querySelector('.bottom-nav'), room = document.querySelector('.room3d')
    if (nav && getComputedStyle(nav).display !== 'none' && room && room.getBoundingClientRect().bottom > nav.getBoundingClientRect().top + 1) out.push('room runs under the bottom tab bar')
    return out
  }, selectors)
  assert.deepEqual(problems, [])
}
const HUD = ['.room3d .back-btn', '.room3d .sync-chip', '.room3d .zone-nav', '.room3d .add-fab', '.room3d .item-panel', '.room3d .view-bar', '.room3d .focus-label', '.room3d .zone-picker']
const hash = (page) => page.evaluate(() => decodeURIComponent(location.hash))
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) })

// ─── Scenarios ─────────────────────────────────────────────────────────────
const SIZES = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'phone', width: 390, height: 844, touch: true },
  { label: 'tablet', width: 820, height: 1180, touch: true },
  { label: 'phone-landscape', width: 844, height: 390, touch: true },
]
const only = process.env.ROOM_TEST_ONLY // e.g. "desktop" to run one size while iterating

if (!only) {
  console.log('First visit')
  {
    const { context, page, errors } = await setup({ width: 1440, height: 900, guideSeen: false, reducedMotion: 'no-preference' })
    await check('guide opens on the first visit, steps through, and stays closed', async () => {
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
      const dialog = page.getByRole('dialog', { name: 'This is your collection room' })
      await dialog.waitFor({ timeout: 20000 })
      await page.waitForTimeout(900); await shot(page, 'guide-desktop-step1')
      for (const title of ['Open anything', 'Swipe through your cards', 'The rest of CardStacks is in here too']) {
        await page.getByRole('button', { name: 'Next ›' }).click()
        await page.getByRole('heading', { name: title }).waitFor()
      }
      await page.waitForTimeout(700); await shot(page, 'guide-desktop-step4')
      await page.getByRole('button', { name: "Let's go!" }).click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => localStorage.getItem('cardstacks.roomGuide.v1')), '1')
      await page.reload({ waitUntil: 'domcontentloaded' }); await roomReady(page)
      assert.equal(await page.getByRole('dialog').count(), 0, 'guide came back after being finished')
      await page.getByRole('button', { name: 'How to use the room' }).click() // the ? on the status chip
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await hash(page), '', 'Esc on the guide must not also move the room')
    })
    await check('no page errors on first visit', async () => assert.deepEqual(errors, []))
    await context.close()
  }
  {
    // This headless Chromium draws 3D on the processor (SwiftShader), like a browser with graphics acceleration off: the
    // room must open there, and draw nothing while nothing moves (RenderOnChange) so the computer isn't tied up.
    const { context, page, errors } = await setup({ width: 1440, height: 900 })
    await check('without graphics acceleration: the room opens, and draws nothing while it is still', async () => {
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
      await roomReady(page)
      await page.waitForTimeout(3000) // pictures finish loading and the shadows are drawn once
      const frames = await page.evaluate(() => new Promise((resolve) => {
        const { gl } = window.__nook3d; const before = gl.info.render.frame
        setTimeout(() => resolve(gl.info.render.frame - before), 2000)
      }))
      assert.equal(frames, 0, `the room drew ${frames} frames in 2 s with nothing moving`)
      await page.getByRole('button', { name: /Card boxes/ }).click()
      await page.waitForFunction(() => window.__nook3d.gl.info.render.frame > 0)
      await settle(page)
      assert.match(await hash(page), /#\/storage$/, 'the camera still moves on request')
    })
    await check('no page errors without graphics acceleration', async () => assert.deepEqual(errors, []))
    await context.close()
  }
  {
    const { context, page } = await setup({ width: 390, height: 844, touch: true, guideSeen: false, reducedMotion: 'no-preference' })
    await check('guide fits a phone screen', async () => {
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
      await page.getByRole('dialog').waitFor({ timeout: 20000 })
      await page.waitForTimeout(900); await shot(page, 'guide-phone-step1')
      const fits = await page.evaluate(() => { const r = document.querySelector('.room-guide__card').getBoundingClientRect(); const nav = document.querySelector('.bottom-nav').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= nav.top })
      assert(fits, 'guide card is cut off')
      await page.getByRole('button', { name: 'Skip' }).tap()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    })
    await context.close()
  }
}

for (const size of SIZES.filter(s => !only || s.label === only)) {
  console.log(`\n${size.label} ${size.width}×${size.height}`)
  const { context, page, state, errors } = await setup(size)
  check.page = page; check.label = size.label
  const touch = Boolean(size.touch)
  const press = (locator) => (touch ? locator.tap() : locator.click())
  const tapButton = (name) => press(page.getByRole('button', { name }).first())

  await check('room loads the collection and draws', async () => {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
    await roomReady(page)
    const colours = await renderedColours(page)
    assert(colours > 20, `canvas looks blank (${colours} colours)`)
    const chip = await page.locator('.room3d .sync-chip').innerText()
    const copies = owned.reduce((n, o) => n + o.conditions[0].quantity, 0)
    assert.match(chip, new RegExp(`${copies} cards · 6 binders · 8 boxes`))
    await shot(page, `${size.label}-home`)
  })
  await check('home layout: nothing overlaps or spills', async () => layoutSound(page, HUD))

  // From across the room the shelves are too small to read or hit (above all on a phone), so the first tap on any
  // piece of collection furniture — even right on a binder, box or card — only walks over to it; the second picks.
  const home = async () => { await page.goto(origin + '/', { waitUntil: 'domcontentloaded' }); await roomReady(page) }
  // Readable: a binder's spine label is most of its height; a long box is wide and low, so its name plate reads at a smaller height.
  for (const [unit, zone, label, labels, readable] of [['ShelfUnit_binders', 'binders', 'binder', 'binders', 40], ['ShelfUnit_boxes', 'storage', 'box', 'boxes', 24]]) {
    await check(`${labels}: tapping a ${label} from across the room zooms to its shelf first, then picks it`, async () => {
      try {
        const far = await itemHeightPx(page, unit)
        await clickObject(page, { name: unit, instance: 0 }, touch)
        assert.equal(await hash(page), `#/${zone}`, `the first tap must only zoom in, not open the ${label}`)
        assert.equal(await page.locator('.room3d .item-panel').count(), 0)
        const near = await itemHeightPx(page, unit)
        await shot(page, `${size.label}-${zone}-zone`)
        assert(near > far * 1.6, `zooming in barely helped: a ${label} went from ${far.toFixed(0)} to ${near.toFixed(0)} px tall`)
        assert(near >= readable, `a ${label} is only ${near.toFixed(0)} px tall up close — too small to read its name`)
        await clickObject(page, { name: unit, instance: 0 }, touch)
        const opened = await hash(page)
        assert.match(opened, new RegExp(`^#/${zone}/[^/]+$`), `the second tap must open the ${label} (went to "${opened}" on ${page.url()})`)
      } finally { await home() }
    })
  }
  await check('display cabinet: tapping a card from across the room zooms to the cabinet first, then picks it', async () => {
    try {
      await clickObject(page, { name: 'DisplayHit_1' }, touch)
      assert.equal(await hash(page), '#/display', 'the first tap must only zoom in, not open the card')
      await shot(page, `${size.label}-display-zone`)
      const cardPx = await page.evaluate(() => {
        const { scene, camera, gl, THREE } = window.__nook3d
        const b = new THREE.Box3().setFromObject(scene.getObjectByName('DisplayHit_1')), h = gl.domElement.getBoundingClientRect().height
        const y = (v) => (1 - v.project(camera).y) / 2 * h
        return { px: Math.abs(y(new THREE.Vector3(b.min.x, b.min.y, b.max.z)) - y(new THREE.Vector3(b.min.x, b.max.y, b.max.z))), stage: h }
      })
      // The cabinet's three shelves must all fit, so on a short screen (a phone on its side) a card can only be so tall.
      const enough = Math.min(80, cardPx.stage * 0.15)
      assert(cardPx.px >= enough, `a display card is only ${cardPx.px.toFixed(0)} px tall up close (want ${enough.toFixed(0)})`)
      await clickObject(page, { name: 'DisplayHit_1' }, touch)
      assert.equal(await hash(page), '#/display/dslot-1')
    } finally { await home() }
  })

  await check('binders: tap the bookcase, pick a binder, read a card with its price', async () => {
    await clickObject(page, { name: 'ShelfUnit_binders' }, touch)
    assert.equal(await hash(page), '#/binders')
    await page.locator('.room3d .zone-picker').waitFor()
    await shot(page, `${size.label}-binders`)
    await layoutSound(page, HUD)
    await press(page.locator('.room3d .zone-picker button', { hasText: 'Base Set Binder' }).first())
    assert.equal(await hash(page), '#/binders/binder-0')
    await page.getByRole('heading', { name: 'Base Set Binder' }).waitFor()
    await page.waitForTimeout(500)
    await clickObject(page, { name: 'BinderCard_pocket:binder-0:0' }, touch)
    assert.equal(await hash(page), '#/binders/binder-0/card/pocket:binder-0:0')
    const facts = await page.locator('.room3d .item-panel').innerText()
    assert.match(facts, /Alakazam/); assert.match(facts, /\$10\.00/); assert.doesNotMatch(facts, /Condition/)
    await shot(page, `${size.label}-binder-card`)
    await layoutSound(page, HUD)
  })

  await check('binder pocket: pick one of my cards and place it (same PUT as the binder page)', async () => {
    await page.goBack(); await page.waitForTimeout(300)
    assert.equal(await hash(page), '#/binders/binder-0')
    await tapButton('+ Add card')
    await page.locator('.room3d .view-bar--picker').waitFor()
    await page.waitForFunction(() => Boolean(window.__nook3d.scene.getObjectByName('RolodexCard_base1-1')))
    await page.waitForTimeout(600)
    await shot(page, `${size.label}-picker`)
    await layoutSound(page, HUD)
    let picked = null
    for (const id of ['base1-1', 'base1-2', 'base1-3', 'base1-4', 'base1-5']) {
      const at = await screenPoint(page, { name: `RolodexCard_${id}` })
      if (at && !at.miss) { await clickObject(page, { name: `RolodexCard_${id}` }, touch); picked = id; break }
    }
    assert(picked, 'no rolodex card on screen')
    const place = page.locator('.room3d .view-bar__add')
    await page.waitForFunction(() => !document.querySelector('.room3d .view-bar__add')?.disabled)
    assert.match(await place.innerText(), /^Place /)
    await press(place)
    await page.locator('.room3d .view-bar--picker').waitFor({ state: 'detached' })
    const write = state.writes.at(-1)
    assert.equal(write.binderId, 'binder-0'); assert.equal(write.slot, 14); assert.equal(write.body.cardId, picked)
    await page.waitForFunction(() => Boolean(window.__nook3d.scene.getObjectByName('BinderCard_pocket:binder-0:14')))
  })

  await check('binder pocket: search the catalog from the picker', async () => {
    await tapButton('+ Add card')
    await page.getByRole('searchbox', { name: 'Search cards' }).fill('char')
    await page.waitForFunction(() => /\b3 cards\b/.test(document.querySelector('.room3d .view-bar--picker')?.innerText ?? ''))
    await tapButton('Cancel')
    await page.locator('.room3d .view-bar--picker').waitFor({ state: 'detached' })
  })

  await check('"Open binder page" goes to the real binder page, and back returns', async () => {
    await press(page.locator('.room3d .item-panel__site-link'))
    await page.waitForURL(/\/binder\/binder-0$/)
    await page.goBack(); await roomReady(page)
    assert.equal(await hash(page), '#/binders/binder-0')
  })

  await check('Esc / Back steps out one level at a time', async () => {
    if (!touch) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(200); assert.equal(await hash(page), '#/binders')
      await page.keyboard.press('Escape'); await page.waitForTimeout(200); assert.equal(await hash(page), '')
    }
    else { await tapButton('← Back to Binder Library'); assert.equal(await hash(page), '#/binders'); await tapButton('← Back to room'); assert.equal(await hash(page), '') }
  })

  let relayed = null
  await check('boxes: open a box, switch compartment, read a card', async () => {
    relayed = page.waitForResponse(r => r.url().includes('/card-art?u='), { timeout: 30000 })
    relayed.catch(() => {}) // checked in the next step
    await tapButton('01 Card boxes')
    assert.equal(await hash(page), '#/storage')
    await page.locator('.room3d .zone-picker').waitFor()
    await press(page.locator('.room3d .zone-picker button', { hasText: 'Base Set Box' }).first())
    assert.equal(await hash(page), '#/storage/box-0')
    await press(page.getByRole('tab', { name: /Holos/ }))
    await press(page.locator('.room3d .drawer-card').first())
    const facts = await page.locator('.room3d .item-panel').innerText()
    assert.match(facts, /Ninetales|Poliwrath|Mewtwo|Nidoking|Raichu|Venusaur|Hitmonchan|Machamp|Magneton/); assert.match(facts, /\$\d/); assert.match(facts, /NM/)
    await page.waitForTimeout(500)
    await shot(page, `${size.label}-box`)
    await layoutSound(page, HUD)
  })

  await check('boxes: TCGplayer art is requested through the /card-art relay', async () => {
    assert(relayed, 'box never opened')
    const response = await relayed
    assert.equal(response.status(), 200, `relay answered ${response.status()}`)
    assert.equal(response.headers()['access-control-allow-origin'], '*')
  })

  await check('display cabinet: tap a card in the case to read it', async () => {
    await page.goto(origin + '/#/display', { waitUntil: 'domcontentloaded' }); await roomReady(page)
    await clickObject(page, { name: 'DisplayHit_1' }, touch)
    assert.equal(await hash(page), '#/display/dslot-1')
    await page.waitForTimeout(500)
    const facts = await page.locator('.room3d .item-panel').innerText()
    assert.match(facts, /Charizard/)
    assert.match(facts, /Manage display case/)
    await shot(page, `${size.label}-display`)
    await layoutSound(page, HUD)
  })

  await check('furniture leads to the rest of the site (desk → Add Cards, Explore button → Explore)', async () => {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' }); await roomReady(page)
    await clickObject(page, { pieceType: 'desk' }, touch)
    await page.waitForURL(/\/add$/)
    await page.goBack(); await roomReady(page)
    await tapButton('04 Explore')
    await page.waitForURL(/\/explore$/)
  })

  await check('old Spaces links open Spaces at /spaces', async () => {
    await page.goto(origin + '/?area=storage&box=box-0', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/spaces\?area=storage&box=box-0$/)
    await page.locator('.spaces-home-button').waitFor()
  })

  await check('no page errors', async () => assert.deepEqual(errors, []))
  await context.close()
}

await browser.close()
fs.writeFileSync(path.join(shots, `browser-results${only ? `-${only}` : ''}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
