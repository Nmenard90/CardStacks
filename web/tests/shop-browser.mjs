// Browser test for the shop: the public page (/shop/<slug>), buy and trade requests, the
// seller's My Shop page (Requests / Offers / Settings) and the old Trade/share links that
// now lead there. Every API and auth call is intercepted — nothing real is read or changed.
//
// Run: start Vite with VITE_SUPABASE_URL=https://qa.supabase.co VITE_SUPABASE_ANON_KEY=qa-public-test-key
// on port 5178 (or set SHOP_TEST_ORIGIN), then `node web/tests/shop-browser.mjs`.
// PLAYWRIGHT_MODULE may point at a Playwright (or playwright-core) install; PLAYWRIGHT_CHROMIUM_EXECUTABLE
// at a Chromium binary. Screenshots and results go to docs/agent-reports/cleanup-20261029/.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../../', import.meta.url))
const report = path.join(root, 'docs/agent-reports/cleanup-20261029')
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'web/tests/fixtures/shop.json'), 'utf8'))
const origin = process.env.SHOP_TEST_ORIGIN || 'http://127.0.0.1:5178'
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
const results = []
fs.mkdirSync(report, { recursive: true })

const user = { id: 'qa-owner', supabaseUserId: 'qa-owner', username: 'qa-owner', email: 'qa@example.test', role: 'Collector', reputation: 0, isAnonymous: false, createdAt: new Date().toISOString() }
const owned = [1, 5, 20].map((price, i) => ({ cardId: `owned-${i}`, conditions: [{ condition: 'NM', quantity: 1 }], selectedCond: 'NM', updatedAt: new Date().toISOString(), card: {
  id: `owned-${i}`, setId: 'dp4', name: `Owned ${['Low', 'Mid', 'High'][i]}`, number: String(i + 1), prices: { nm: price }, images: { small: 'https://images.pokemontcg.io/dp4/1.png', large: 'https://images.pokemontcg.io/dp4/1_hires.png' },
} }))
const unowned = Array.from({ length: 60 }, (_, i) => ({ ...owned[0].card, id: `unowned-${i}`, name: `Unowned ${i}`, prices: { nm: 10000 + i } }))
// A card a buyer offers in trade, found through the catalog search.
const tradeCard = { id: 'sv4-9', setId: 'sv4', name: 'Trade Bait', number: '9', rarity: 'Rare', prices: { nm: 3 }, images: { small: 'https://images.pokemontcg.io/sv4/9.png', large: 'https://images.pokemontcg.io/sv4/9_hires.png' } }
const offer = {
  id: 'o1', role: 'seller', otherUser: 'old-trader', status: 'Pending', unread: true, cashAmount: 4,
  wants: [{ cardId: 'me1-65', name: 'Greavard', imageSmall: 'https://images.pokemontcg.io/me1/65.png', condition: 'NM', quantity: 1, marketPrice: 0.05 }],
  gives: [], createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
  messages: [{ id: 'm1', senderId: 'u-old', sender: 'old-trader', body: 'Still have this one?', createdAt: '2026-10-20T10:00:00Z' }],
}

async function setup({ width = 1440, height = 900, authenticated = false, mode = 'normal', offers = [] } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', ...(width < 600 ? { hasTouch: true, isMobile: true } : {}) })
  if (authenticated) await context.addInitScript(({ user }) => {
    const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' })}.cWE`
    localStorage.setItem('sb-qa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }))
  }, { user })
  const state = {
    mode, sent: [], statusPuts: [], offers: structuredClone(offers), release: null,
    settings: { slug: 'nmenard90', enabled: true, messengerUrl: '', displayName: fixture.shop.displayName, bio: fixture.shop.bio },
    inbox: [{ id: 'r1', sellerUserId: user.id, buyerName: 'Ash', buyerContact: 'ash@example.test', kind: 'buy', status: 'new', createdAt: '2026-10-28T12:00:00Z', items: [{ cardId: 'me1-65', name: 'Greavard', number: '65', condition: 'NM', qty: 1 }],
      message: 'TRADE OFFER (cards about $3.00 for cards about $0.05, at today\'s prices):\n- 1× Trade Bait #9 (NM)' }],
  }
  await context.route('https://qa.supabase.co/**', route => route.fulfill({ json: user }))
  await context.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname
    if (p === '/api/auth/me') return route.fulfill({ json: user })
    if (p === '/api/games') return route.fulfill({ json: [{ id: 'pokemon', name: 'Pokémon', shortName: 'Pokémon', enabled: true }] })
    if (p === '/api/sets') return route.fulfill({ json: fixture.sets })
    if (p === '/api/search') return route.fulfill({ json: [tradeCard] })
    if (p === '/api/shop/from-share/oldlink123') return route.fulfill({ json: { slug: 'nmenard90' } })
    if (p.startsWith('/api/shop/from-share/')) return route.fulfill({ status: 404, body: 'This shop is not open.' })
    if (p === '/api/shop/nmenard90') {
      if (state.mode === 'loading') await new Promise(resolve => { state.release = resolve })
      if (state.mode === 'error') return route.fulfill({ status: 404, body: 'This shop is not open.' })
      const cards = state.mode === 'empty' ? [] : structuredClone(fixture.shop.cards)
      if (state.mode === 'partial' && cards[0]) cards[0].card.prices = undefined
      return route.fulfill({ json: { ...fixture.shop, displayName: state.settings.displayName, bio: state.settings.bio, cards, photos: [] } })
    }
    if (p === '/api/shop/nmenard90/requests' && req.method() === 'POST') {
      state.sent.push(req.postDataJSON())
      return route.fulfill({ json: { ok: true, id: 'qa-request' } })
    }
    if (p.endsWith('/shop-settings')) {
      if (req.method() === 'PUT') state.settings = req.postDataJSON()
      return route.fulfill({ json: state.settings })
    }
    if (p.endsWith('/shop-requests')) return route.fulfill({ json: state.inbox })
    if (/\/shop-requests\/[^/]+$/.test(p)) {
      const r = state.inbox.find(x => p.endsWith('/' + x.id)); if (r) r.status = req.postDataJSON().status
      return route.fulfill({ json: { ok: true } })
    }
    if (p === `/api/trading/${user.id}/offers`) return route.fulfill({ json: state.offers })
    if (p === `/api/trading/${user.id}/offers/o1`) return route.fulfill({ json: { ...state.offers[0], unread: false } })
    if (p === `/api/trading/${user.id}/offers/o1/status`) {
      state.statusPuts.push(req.postDataJSON().status); state.offers[0].status = req.postDataJSON().status
      return route.fulfill({ json: { ...state.offers[0], unread: false } })
    }
    if (p === `/api/trading/${user.id}/unread`) return route.fulfill({ json: { count: state.offers.filter(o => o.unread).length } })
    if (p === '/api/cards/browse') return route.fulfill({ json: { cards: unowned, total: 2000 } })
    if (p === '/api/collection/qa-owner/owned') return route.fulfill({ json: owned })
    if (p === '/api/collection/qa-owner/stats') return route.fulfill({ json: { totalCards: 3, uniqueCards: 3, totalValue: 26, setsEntered: 1 } })
    if (p === '/api/collection/qa-owner') return route.fulfill({ json: owned.map(o => ({ ...o, id: o.cardId, userId: user.id })) })
    return route.fulfill({ status: 404, body: 'QA route not defined: ' + p })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, state, errors }
}

async function openShop(page, query = '') {
  await page.goto(origin + '/shop/nmenard90' + query, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: fixture.shop.displayName, exact: true }).waitFor({ timeout: 15000 })
  await page.locator('.card-grid .pcard').first().waitFor()
}
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal page overflow')
}
async function run(name, body) {
  try { await body(); results.push({ name, status: 'pass' }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, status: 'fail', error: error.message }); console.log('FAIL ' + name + '\n  ' + error.message) }
}
const sets = [...new Set(fixture.shop.cards.map(c => c.card.setId))]

try {
  for (const width of [1440, 390]) await run(`public shop: layout, rules, set filter, search, buy request (${width}px)`, async () => {
    const { context, page, state, errors } = await setup({ width, height: width === 390 ? 844 : 900 })
    await openShop(page)
    await noOverflow(page)
    // CardStacks branding, the seller's profile, and the user's deal rules: trades welcome, no % offers.
    assert.equal(await page.locator('.shop-bio').innerText(), fixture.shop.bio.trimEnd())
    const policy = await page.locator('.shop-policy').innerText()
    assert.match(policy, /Trades welcome/)
    assert.match(policy, /No percentage offers/)
    assert.doesNotMatch(await page.locator('body').innerText(), /sales only|no trades/i)
    assert.equal(await page.getByRole('link', { name: /Edit shop/ }).count(), 0, 'visitors must not see the owner link')
    await page.screenshot({ path: path.join(report, `shop-${width}.png`) })

    // Set filter lives in the URL: choosing a set filters, Back returns to all sets.
    const all = await page.locator('.card-grid .pcard').count()
    await page.getByRole('combobox', { name: 'Filter by set' }).selectOption(sets[0])
    await page.waitForURL(`**?set=${sets[0]}`)
    const inSet = fixture.shop.cards.filter(c => c.card.setId === sets[0]).length
    await page.waitForFunction(n => document.querySelectorAll('.card-grid .pcard').length === Math.min(n, 48), inSet)
    await page.goBack()
    await page.waitForFunction(n => document.querySelectorAll('.card-grid .pcard').length === n, all)

    // Search, then pick a card and send a buy request.
    const first = fixture.shop.cards[0].card
    await page.getByPlaceholder('Search name, artist, set…').fill(first.name)
    await page.locator('.card-grid .pcard').filter({ hasText: first.name }).first().waitFor()
    await page.locator('.card-grid .pcard').filter({ hasText: first.name }).first().getByRole('button', { name: /^Add one/ }).click()
    await page.getByRole('button', { name: 'Send request' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Your name').fill('QA Buyer')
    await dialog.getByLabel(/How can I reach you/).fill('qa@example.test')
    await dialog.getByRole('checkbox', { name: /prices follow the market/ }).check()
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByRole('heading', { name: /Sent!/ }).waitFor()
    assert.equal(state.sent.length, 1)
    assert.equal(state.sent[0].items[0].cardId, first.id)
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  await run('trade request: catalog search, must cover the cards picked, cash top-up', async () => {
    const { context, page, state, errors } = await setup({ width: 390, height: 844 })
    await openShop(page)
    // Pick the priciest card so one Trade Bait ($3) is short and needs cash.
    const priciest = fixture.shop.cards.reduce((a, b) => ((b.card.prices?.nm ?? 0) > (a.card.prices?.nm ?? 0) ? b : a))
    await page.getByPlaceholder('Search name, artist, set…').fill(priciest.card.name)
    await page.locator('.card-grid .pcard').filter({ hasText: priciest.card.name }).first().getByRole('button', { name: /^Add one/ }).click()
    await page.getByRole('button', { name: 'Send request' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Your name').fill('QA Trader')
    await dialog.getByLabel(/How can I reach you/).fill('trader@example.test')
    await dialog.getByRole('checkbox', { name: /I'd like to trade/ }).check()
    await dialog.getByLabel('Search cards to trade').fill('Trade Bait')
    await dialog.getByRole('button', { name: 'Add Trade Bait to trade' }).click()
    await dialog.getByRole('checkbox', { name: /prices follow the market/ }).check()
    const want = priciest.card.prices.nm
    if (want > 3) {
      await dialog.getByRole('button', { name: 'Send', exact: true }).click()
      await dialog.getByRole('alert').filter({ hasText: /short of the cards you picked/ }).waitFor()
      assert.equal(state.sent.length, 0, 'an offer under the cards picked must not send')
      await dialog.getByLabel(/Add cash to even it out/).fill(String(Math.ceil(want - 3) + 1))
    }
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByRole('heading', { name: /Sent!/ }).waitFor()
    assert.match(state.sent[0].message, /^TRADE OFFER/)
    assert.match(state.sent[0].message, /Trade Bait #9/)
    await noOverflow(page)
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  await run('public shop: loading, closed, empty and unpriced states', async () => {
    const { context, page, state } = await setup({ mode: 'loading', width: 390, height: 844 })
    await page.goto(origin + '/shop/nmenard90', { waitUntil: 'domcontentloaded' })
    await page.getByText('Loading cards…').waitFor()
    while (!state.release) await new Promise(resolve => setTimeout(resolve, 20))
    state.mode = 'error'; state.release()
    await page.getByText("This shop isn't open right now.", { exact: false }).waitFor()
    state.mode = 'empty'
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('No cards for sale right now.').waitFor()
    state.mode = 'partial'
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Sorted by value, the unpriced card is last — search for it.
    await page.getByPlaceholder('Search name, artist, set…').fill(fixture.shop.cards[0].card.name)
    await page.getByText('Ask for price').first().waitFor()
    await noOverflow(page)
    await context.close()
  })

  await run('owner: shop page links to My Shop; Settings saves name and bio', async () => {
    const { context, page, state, errors } = await setup({ authenticated: true })
    await openShop(page)
    await page.getByRole('link', { name: /Edit shop/ }).click()
    await page.waitForURL('**/shop/requests')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForURL('**/shop/requests?tab=settings')
    await page.getByLabel('Shop name', { exact: true }).fill('QA Collector Shop')
    await page.getByLabel(/About you and your cards/).fill('My own bio.\n<script>plain text</script>')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Saved. Your shop is live.', { exact: true }).waitFor()
    assert.equal(state.settings.displayName, 'QA Collector Shop')
    await page.getByRole('link', { name: '👁 View my shop' }).first().click()
    await page.getByRole('heading', { name: 'QA Collector Shop', exact: true }).waitFor()
    assert.equal(await page.locator('.shop-bio').innerText(), 'My own bio.\n<script>plain text</script>')
    assert.equal(await page.locator('.shop-bio script').count(), 0)
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  for (const width of [1440, 390]) await run(`My Shop: requests inbox, nav badge, no Offers tab without offers (${width}px)`, async () => {
    const { context, page, state, errors } = await setup({ authenticated: true, width, height: width === 390 ? 844 : 900 })
    await page.goto(origin + '/shop/requests', { waitUntil: 'domcontentloaded' })
    await page.locator('.shop-req').first().waitFor()
    assert.equal(await page.getByRole('button', { name: /^Offers/ }).count(), 0)
    assert.match(await page.locator('.shop-req .shop-pill').first().innerText(), /Trade request/)
    // Shop nav link carries the new-request count (desktop row or phone tab bar).
    const nav = width === 390 ? page.locator('.bottom-nav a[href="/shop/requests"]') : page.locator('.app-nav a[href="/shop/requests"]')
    assert.equal(await nav.locator('.nav-badge').innerText(), '1')
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `my-shop-${width}.png`) })
    await page.getByRole('button', { name: 'Mark answered' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.shop-req').length === 0)
    assert.equal(state.inbox[0].status, 'answered')
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  for (const width of [1440, 390]) await run(`old trade links: /trade?offer= opens the offer in My Shop, accept works (${width}px)`, async () => {
    const { context, page, state, errors } = await setup({ authenticated: true, offers: [offer], width, height: width === 390 ? 844 : 900 })
    await page.goto(origin + '/trade?offer=o1', { waitUntil: 'domcontentloaded' })
    await page.waitForURL('**/shop/requests?offer=o1')
    await page.locator('.offer-detail').getByText('Still have this one?').waitFor()
    assert.equal(await page.getByRole('button', { name: /^Offers/ }).count(), 1)
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `offer-${width}.png`) })
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await page.getByText(/Accepted — arrange it in the thread/).waitFor()
    assert.deepEqual(state.statusPuts, ['Accepted'])
    await page.goto(origin + '/trade', { waitUntil: 'domcontentloaded' })
    await page.waitForURL('**/shop/requests?tab=offers')
    await page.locator('.offer-row').first().waitFor()
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  await run('old share links: /s/<slug> opens that collector\'s shop, or says the link moved', async () => {
    const { context, page, errors } = await setup()
    await page.goto(origin + '/s/oldlink123', { waitUntil: 'domcontentloaded' })
    await page.waitForURL('**/shop/nmenard90')
    await page.getByRole('heading', { name: fixture.shop.displayName, exact: true }).waitFor()
    await page.goto(origin + '/s/gone', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'This link has moved' }).waitFor()
    assert.equal(errors.length, 0, errors.join('\n'))
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
    await page.getByRole('button', { name: /Descending/ }).click()
    assert.deepEqual(await page.locator('.pcard .cname').allTextContents(), ['Owned Low', 'Owned Mid', 'Owned High'])
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })
} finally {
  fs.writeFileSync(path.join(report, 'shop-browser-results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  const failed = results.filter(r => r.status === 'fail').length
  console.log(`${results.length - failed}/${results.length} passed`)
  if (failed) process.exitCode = 1
}
