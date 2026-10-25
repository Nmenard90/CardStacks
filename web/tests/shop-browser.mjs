// Run against the local Vite server with QA Supabase env vars. All API/auth
// traffic is intercepted; no live inventory or buyer requests are changed.
// PLAYWRIGHT_MODULE may point to a temporary Playwright installation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../../', import.meta.url))
const report = path.join(root, 'docs/agent-reports/shop-inviting-20261025')
const fixture = JSON.parse(fs.readFileSync(path.join(report, 'fixture.json'), 'utf8'))
const origin = process.env.SHOP_TEST_ORIGIN || 'http://127.0.0.1:5178'
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
const results = []
const user = { id: 'qa-owner', supabaseUserId: 'qa-owner', username: 'qa-owner', email: 'qa@example.test', role: 'Collector', reputation: 0, isAnonymous: false, createdAt: new Date().toISOString() }
const owned = [1, 5, 20].map((price, i) => ({ cardId: `owned-${i}`, conditions: [{ condition: 'NM', quantity: 1 }], selectedCond: 'NM', updatedAt: new Date().toISOString(), card: {
  id: `owned-${i}`, setId: 'dp4', name: `Owned ${['Low', 'Mid', 'High'][i]}`, number: String(i + 1), prices: { nm: price }, images: { small: 'https://images.pokemontcg.io/dp4/1.png', large: 'https://images.pokemontcg.io/dp4/1_hires.png' },
} }))
const unowned = Array.from({ length: 60 }, (_, i) => ({ ...owned[0].card, id: `unowned-${i}`, name: `Unowned ${i}`, prices: { nm: 10000 + i } }))

async function setup({ width = 1440, height = 900, authenticated = false, mode = 'normal' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
  if (authenticated) await context.addInitScript(({ user }) => {
    const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' })}.cWE`
    localStorage.setItem('sb-qa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }))
  }, { user })
  const state = { mode, requests: [], settings: { slug: 'nmenard90', enabled: true, messengerUrl: '', displayName: fixture.shop.displayName, bio: fixture.shop.bio }, release: null }
  await context.route('https://qa.supabase.co/**', route => route.fulfill({ json: user }))
  await context.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname
    if (p === '/api/auth/me') return route.fulfill({ json: user })
    if (p === '/api/games') return route.fulfill({ json: [{ id: 'pokemon', name: 'Pokémon', enabled: true }] })
    if (p === '/api/sets') return route.fulfill({ json: fixture.sets })
    if (p === '/api/shop/nmenard90') {
      if (state.mode === 'loading') await new Promise(resolve => { state.release = resolve })
      if (state.mode === 'error') return route.fulfill({ status: 503, body: 'Unavailable' })
      const cards = state.mode === 'empty' ? [] : structuredClone(fixture.shop.cards)
      if (state.mode === 'partial' && cards[0]) cards[0].card.prices = undefined
      return route.fulfill({ json: { ...fixture.shop, displayName: state.settings.displayName, bio: state.settings.bio, cards } })
    }
    if (p.endsWith('/shop-settings')) {
      if (req.method() === 'PUT') state.settings = req.postDataJSON()
      return route.fulfill({ json: state.settings })
    }
    if (p === '/api/shop/nmenard90/requests' && req.method() === 'POST') {
      state.requests.push(req.postDataJSON())
      return route.fulfill({ json: { ok: true, id: 'qa-request' } })
    }
    if (p.endsWith('/shop-requests')) return route.fulfill({ json: [] })
    if (p === '/api/cards/browse') return route.fulfill({ json: { cards: unowned, total: 2000 } })
    if (p === '/api/collection/qa-owner/owned') return route.fulfill({ json: owned })
    if (p === '/api/collection/qa-owner/stats') return route.fulfill({ json: { totalCards: 3, uniqueCards: 3, totalValue: 26, setsEntered: 1 } })
    if (p === '/api/collection/qa-owner') return route.fulfill({ json: owned.map(o => ({ ...o, id: o.cardId, userId: user.id })) })
    if (p.includes('unread')) return route.fulfill({ json: { count: 0 } })
    return route.fulfill({ status: 404, body: 'QA route not defined' })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, state, errors }
}

async function openShop(page) {
  await page.goto(origin + '/shop/nmenard90', { waitUntil: 'domcontentloaded' })
  try { await page.getByRole('heading', { name: fixture.shop.displayName, exact: true }).waitFor({ timeout: 10000 }) }
  catch (error) {
    await page.screenshot({ path: path.join(report, 'debug.png') })
    console.log((await page.locator('body').innerText()).slice(0, 1800))
    throw error
  }
  await page.locator('.shop-set-section').first().waitFor()
}
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow')
}
function contrast(a, b) {
  const light = css => {
    const rgb = css.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 })
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  const values = [light(a), light(b)].sort((x, y) => y - x)
  return (values[0] + .05) / (values[1] + .05)
}
async function run(name, body) {
  try { await body(); results.push({ name, status: 'pass' }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, status: 'fail', error: error.message }); throw error }
}

try {
  for (const width of [1440, 390]) await run(`set browsing and layout ${width}px`, async () => {
    const { context, page, errors } = await setup({ width, height: width === 390 ? 844 : 900 })
    await openShop(page)
    assert.equal(await page.getByRole('link', { name: 'Edit shop profile →' }).count(), 0)
    await noOverflow(page)
    const colors = await page.evaluate(() => {
      const style = s => getComputedStyle(document.querySelector(s))
      const search = document.querySelector('[aria-label="Search cards"]')
      return {
        muted: style('.shop-profile-meta').color, background: style('.shop-storefront').backgroundColor,
        placeholder: getComputedStyle(search, '::placeholder').color, inputBackground: getComputedStyle(search).backgroundColor,
        button: style('.shop-bar button').color, buttonBackground: style('.shop-bar button').backgroundColor,
      }
    })
    assert(contrast(colors.muted, colors.background) >= 4.5)
    assert(contrast(colors.placeholder, colors.inputBackground) >= 4.5)
    assert(contrast(colors.button, colors.buttonBackground) >= 4.5)
    const targets = await page.getByRole('button').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })))
    assert(targets.every(t => t.width >= 24 && t.height >= 24), 'visible button target below 24px')
    assert.equal(await page.locator('.shop-set-section').count(), 4)
    assert((await page.locator('.shop-set-section').first().locator('.box-card-tile').count()) <= 12)
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.shop-set-section .box-card-tile img')).slice(0, 4).every(img => img.complete))
    await page.screenshot({ path: path.join(report, width === 390 ? 'mobile.png' : 'desktop.png') })
    if (width === 390) await page.getByRole('combobox', { name: 'Filter by set' }).selectOption('dp4')
    else {
      await page.locator('.shop-set-directory summary').click()
      await page.locator('.shop-set-directory').getByRole('button').filter({ hasText: 'Great Encounters' }).click()
    }
    await page.waitForURL('**?set=dp4')
    await page.waitForFunction(() => document.querySelectorAll('.shop-set-section').length === 1)
    assert.equal(await page.locator('.shop-set-section').count(), 1)
    assert.equal(await page.locator('.shop-set-section h3').innerText(), 'Great Encounters')
    assert.equal(await page.locator('.shop-set-directory').getAttribute('open'), null)
    await page.goBack()
    await page.waitForFunction(() => document.querySelectorAll('.shop-set-section').length === 4)
    await page.getByRole('textbox', { name: 'Search cards' }).fill('not-a-real-card-name')
    await page.getByText('No cards match your search.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.locator('.shop-set-section').first().waitFor()
    await page.getByRole('button', { name: '+ Add', exact: true }).first().click()
    await page.getByRole('button', { name: 'Review request →' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel')
    await dialog.getByLabel('Your name', { exact: true }).fill('QA Buyer')
    await dialog.getByLabel(/How can I reach you/).fill('qa@example.test')
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByRole('heading', { name: /Sent!/ }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  await run('loading, error recovery, empty and unpriced states', async () => {
    const { context, page, state } = await setup({ mode: 'loading', width: 390, height: 844 })
    await page.goto(origin + '/shop/nmenard90', { waitUntil: 'domcontentloaded' })
    await page.getByRole('status').filter({ hasText: 'Opening the collection' }).waitFor()
    while (!state.release) await new Promise(resolve => setTimeout(resolve, 20))
    state.mode = 'error'; state.release()
    await page.getByText("This collection isn't available right now.").waitFor()
    state.mode = 'empty'
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.getByText('The shelves are empty for now.').waitFor()
    state.mode = 'partial'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('Ask for price', { exact: false }).first().waitFor()
    await noOverflow(page)
    await context.close()
  })

  await run('owner can edit shop name and bio and see the saved profile', async () => {
    const { context, page, state, errors } = await setup({ authenticated: true })
    await openShop(page)
    await page.getByRole('link', { name: 'Edit shop profile →' }).click()
    await page.getByLabel('Shop name', { exact: true }).fill('QA Collector Shop')
    await page.getByLabel(/About you and your cards/).fill('My own bio.\n<script>plain text</script>')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Saved. Your shop is live.', { exact: true }).waitFor()
    assert.equal(state.settings.displayName, 'QA Collector Shop')
    await page.getByRole('link', { name: 'View my shop →' }).click()
    await page.getByRole('heading', { name: 'QA Collector Shop', exact: true }).waitFor()
    assert.equal(await page.locator('.shop-bio').innerText(), 'My own bio.\n<script>plain text</script>')
    assert.equal(await page.locator('.shop-bio script').count(), 0)
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  await run('long shop name and bio wrap on a narrow phone', async () => {
    const { context, page, state } = await setup({ width: 390, height: 844 })
    state.settings.displayName = 'A collector with a very long public shop name and a collection of favorite cards'
    state.settings.bio = ('A multiline seller bio about cards and arranging a sale.\n').repeat(18).slice(0, 1000)
    await page.goto(origin + '/shop/nmenard90', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: state.settings.displayName, exact: true }).waitFor()
    await noOverflow(page)
    assert.equal(await page.locator('.shop-bio').innerText(), state.settings.bio.trimEnd())
    await context.close()
  })

  await run('Explore owned price descending is independent of the first catalog page', async () => {
    const { context, page, errors } = await setup({ authenticated: true })
    await page.goto(origin + '/explore?set=all', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Owned only', exact: true }).click()
    await page.getByRole('button', { name: 'Price', exact: true }).click()
    await page.getByRole('button', { name: /Ascending/ }).click()
    await page.locator('.pcard .cname').filter({ hasText: 'Owned High' }).waitFor()
    assert.deepEqual(await page.locator('.pcard .cname').allTextContents(), ['Owned High', 'Owned Mid', 'Owned Low'])
    assert.equal(await page.getByText("You don't own any cards yet.", { exact: true }).count(), 0)
    await page.getByRole('button', { name: /Descending/ }).click()
    assert.deepEqual(await page.locator('.pcard .cname').allTextContents(), ['Owned Low', 'Owned Mid', 'Owned High'])
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })
} finally {
  fs.writeFileSync(path.join(report, 'browser-results.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
