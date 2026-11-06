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
const report = process.env.SHOP_TEST_SHOTS || path.join(root, 'docs/agent-reports/cleanup-20261029')
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'web/tests/fixtures/shop.json'), 'utf8'))
const origin = process.env.SHOP_TEST_ORIGIN || 'http://127.0.0.1:5178'
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) })
const results = []
fs.mkdirSync(report, { recursive: true })

const user = { id: 'qa-owner', supabaseUserId: 'qa-owner', username: 'qa-owner', email: 'qa@example.test', role: 'Collector', reputation: 0, isAnonymous: false, createdAt: new Date().toISOString() }
const owned = [1, 5, 20].map((price, i) => ({ cardId: `owned-${i}`, conditions: [{ condition: 'NM', quantity: 1 }], selectedCond: 'NM', updatedAt: new Date().toISOString(), card: {
  id: `owned-${i}`, setId: 'dp4', name: `Owned ${['Low', 'Mid', 'High'][i]}`, number: String(i + 1), prices: { nm: price, lp: price * 0.8 }, images: { small: 'https://images.pokemontcg.io/dp4/1.png', large: 'https://images.pokemontcg.io/dp4/1_hires.png' },
} }))
// A 1x1 JPEG, standing in for a photo of a card.
const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64')
const unowned = Array.from({ length: 60 }, (_, i) => ({ ...owned[0].card, id: `unowned-${i}`, name: `Unowned ${i}`, prices: { nm: 10000 + i } }))
// A card a buyer offers in trade, found through the catalog search.
const tradeCard = { id: 'sv4-9', setId: 'sv4', name: 'Trade Bait', number: '9', rarity: 'Rare', prices: { nm: 3 }, images: { small: 'https://images.pokemontcg.io/sv4/9.png', large: 'https://images.pokemontcg.io/sv4/9_hires.png' } }
const offer = {
  id: 'o1', role: 'seller', otherUser: 'old-trader', status: 'Pending', unread: true, cashAmount: 4,
  wants: [{ cardId: 'me1-65', name: 'Greavard', imageSmall: 'https://images.pokemontcg.io/me1/65.png', condition: 'NM', quantity: 1, marketPrice: 0.05 }],
  gives: [], createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
  messages: [{ id: 'm1', senderId: 'u-old', sender: 'old-trader', body: 'Still have this one?', createdAt: '2026-10-20T10:00:00Z' }],
}

// Laptop and phone; SHOP_TEST_WIDE=1 adds the owner's screen (3200x1588 at 80% zoom = 4000x1985 CSS pixels).
const WIDTHS = process.env.SHOP_TEST_WIDE ? [4000, 1440, 390] : [1440, 390]
const heightFor = width => (width === 4000 ? 1985 : width === 390 ? 844 : 900)

// A signed-in shopper (not the shop's owner): sends requests, asks for photos, chats.
const buyer = { ...user, id: 'qa-buyer', supabaseUserId: 'qa-buyer', username: 'qa-buyer', email: 'buyer@example.test' }

/** A request as the buyer's API returns it (ShopRoutes.buyerView). */
const sentView = (id, kind, items, message) => ({
  id, shopSlug: 'nmenard90', shopName: fixture.shop.displayName, kind, status: 'new', createdAt: '2026-11-04T12:00:00Z',
  message, items, photos: [], messages: [], unread: false,
})

async function setup({ width = 1440, height = 900, authenticated = false, as = 'owner', mode = 'normal', offers = [] } = {}) {
  const me = as === 'buyer' ? buyer : user
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', ...(width < 600 ? { hasTouch: true, isMobile: true } : {}) })
  if (authenticated || as === 'buyer') await context.addInitScript(({ user }) => {
    const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expires, aud: 'authenticated', role: 'authenticated' })}.cWE`
    localStorage.setItem('sb-qa-auth-token', JSON.stringify({ access_token: token, refresh_token: 'qa-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }))
  }, { user: me })
  const state = {
    mode, sent: [], statusPuts: [], itemPosts: [], salePosts: [], offers: structuredClone(offers), release: null, buyerPhotos: [],
    photoAsks: [], sentList: [], buyerChat: [],
    // The seller's chat with qa-buyer on request r2 (the buyer wrote first).
    sellerChat: [{ id: 'c1', fromSeller: false, body: 'Is the Owned Low centered?', createdAt: '2026-11-03T09:00:00Z' }],
    settings: { slug: 'nmenard90', enabled: true, messengerUrl: '', displayName: fixture.shop.displayName, bio: fixture.shop.bio },
    inbox: [{ id: 'r1', sellerUserId: user.id, buyerName: 'Ash', buyerContact: 'ash@example.test', kind: 'buy', status: 'new', createdAt: '2026-10-28T12:00:00Z', items: [{ cardId: 'me1-65', name: 'Greavard', number: '65', condition: 'NM', qty: 1 }, { cardId: 'owned-2', name: 'Owned High', number: '3', condition: 'NM', qty: 1, photos: true }, { cardId: 'owned-1', name: 'Owned Mid', number: '2', condition: 'NM', qty: 2 }, { cardId: 'owned-0', name: 'Owned Low', number: '1', condition: 'NM', qty: 1 }],
      message: 'TRADE OFFER (cards about $3.00 for cards about $0.05, at today\'s prices):\n- 1× Trade Bait #9 (NM)' },
    // From a signed-in buyer: it has a chat instead of a typed contact.
    { id: 'r2', sellerUserId: user.id, buyerUserId: 'qa-buyer', buyerName: 'qa-buyer', buyerContact: '', kind: 'buy', status: 'answered', unread: false, createdAt: '2026-11-03T08:00:00Z',
      items: [{ cardId: 'owned-0', name: 'Owned Low', number: '1', condition: 'NM', qty: 1 }], message: '' }],
  }
  await context.route('https://qa.supabase.co/**', route => route.fulfill({ json: me }))
  await context.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname
    if (p === '/api/auth/me') return route.fulfill({ json: me })
    // The buyer's side (ShopRoutes protected buyer routes): send, ask for photos, their sent requests and chat.
    if (p === '/api/collection/qa-buyer/shop-orders/nmenard90' && req.method() === 'POST') {
      const body = req.postDataJSON()
      state.sent.push(body)
      state.sentList.unshift(sentView('qa-request', 'buy', body.items.map(i => ({ ...i, photos: false })), body.message))
      return route.fulfill({ json: { ok: true, id: 'qa-request' } })
    }
    if (p === '/api/collection/qa-buyer/shop-orders/nmenard90/photo-ask' && req.method() === 'POST') {
      const ask = req.postDataJSON()
      state.photoAsks.push(ask)
      let r = state.sentList.find(x => x.kind === 'photos')
      if (!r) { r = sentView('qa-photos', 'photos', [], ''); state.sentList.push(r) }
      if (!r.items.some(i => i.cardId === ask.cardId && i.condition === ask.condition)) r.items.push({ ...ask, qty: 1, photos: true })
      return route.fulfill({ json: { ok: true, id: r.id } })
    }
    if (p === '/api/collection/qa-buyer/shop-sent' || p === '/api/collection/qa-owner/shop-sent') return route.fulfill({ json: me === buyer ? state.sentList : [] })
    const sentOne = p.match(/^\/api\/collection\/qa-buyer\/shop-sent\/([^/]+)(\/messages)?$/)
    if (sentOne) {
      const r = state.sentList.find(x => x.id === sentOne[1])
      if (!r) return route.fulfill({ status: 404, body: "That request can't be found." })
      if (sentOne[2]) {
        state.buyerChat.push({ id: 'b' + state.buyerChat.length, fromSeller: false, body: req.postDataJSON().body, createdAt: '2026-11-04T12:05:00Z' })
        return route.fulfill({ json: state.buyerChat })
      }
      return route.fulfill({ json: { ...r, photos: state.buyerPhotos, messages: state.buyerChat, unread: false } })
    }
    // The seller's side of a request's chat.
    const chat = p.match(/^\/api\/collection\/qa-owner\/shop-requests\/([^/]+)\/messages$/)
    if (chat) {
      if (req.method() === 'POST') state.sellerChat.push({ id: 's' + state.sellerChat.length, fromSeller: true, body: req.postDataJSON().body, createdAt: '2026-11-04T12:06:00Z' })
      return route.fulfill({ json: state.sellerChat })
    }
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
    if (p.startsWith('/api/shop/nmenard90/photo/')) return route.fulfill({ contentType: 'image/jpeg', body: tinyJpeg })
    if (p === '/api/collection/qa-buyer/shop-settings') return route.fulfill({ json: { slug: '', enabled: false, messengerUrl: '', displayName: '', bio: '' } })
    if (p.endsWith('/shop-settings')) {
      if (req.method() === 'PUT') state.settings = req.postDataJSON()
      return route.fulfill({ json: state.settings })
    }
    if (p.endsWith('/shop-requests')) return route.fulfill({ json: state.inbox })
    if (p === `/api/spaces/${user.id}/card-locations`) {
      state.locationIds = url.searchParams.get('cardIds')
      return route.fulfill({ json: [
        { cardId: 'owned-1', kind: 'box', container: 'Bulk Box 3', part: 'Main', condition: 'NM', quantity: 2, slotIndex: null, pocketSize: null },
        { cardId: 'owned-1', kind: 'binder', container: 'Trade Binder', part: null, condition: null, quantity: 1, slotIndex: 22, pocketSize: 'Nine' },
      ] })
    }
    const pull = p.match(/\/shop-requests\/([^/]+)\/items\/(\d+)$/)
    if (pull) {
      // Same rule as the server (ShopRoutes.applyItemChange): the buyer's pick is kept once the condition changes.
      const change = req.postDataJSON(), item = state.inbox.find(x => x.id === pull[1]).items[Number(pull[2])]
      state.itemPosts.push({ index: Number(pull[2]), ...change })
      if (change.pulled !== undefined) { item.pulled = change.pulled; delete item.foundQty }
      if (change.foundQty !== undefined) {
        item.pulled = change.foundQty > 0
        if (change.foundQty > 0 && change.foundQty < item.qty) item.foundQty = change.foundQty; else delete item.foundQty
      }
      if (change.condition) {
        const asked = item.askedCondition ?? item.condition
        item.condition = change.condition
        if (item.condition === asked) delete item.askedCondition; else item.askedCondition = asked
      }
      return route.fulfill({ json: item })
    }
    // A sale and a put back, by the server's rules (ShopRepository.sell / putBack): found copies not sold yet come out.
    const sale = p.match(/\/shop-requests\/([^/]+)\/(sell|put-back)$/)
    if (sale) {
      const r = state.inbox.find(x => x.id === sale[1]), body = req.postDataJSON() ?? {}
      state.salePosts.push({ action: sale[2], ...body })
      const found = it => it.pulled ? Math.min(it.qty, it.foundQty ?? it.qty) : 0
      if (sale[2] === 'put-back') {
        r.items.forEach((it, n) => { if (body.index === undefined || body.index === n) delete it.sold })
        return route.fulfill({ json: r })
      }
      let taken = 0
      for (const it of r.items) { const due = found(it) - (it.sold ?? 0); if (due > 0) { it.sold = (it.sold ?? 0) + due; taken += due } }
      r.status = 'done'
      return route.fulfill({ json: { request: r, taken, short: [] } })
    }
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
    // Your own card photos, read from Explore (no shop needed): one front photo of Owned High in NM.
    if (p === '/api/collection/qa-owner/shop-photos') return route.fulfill({ json: [{ cardId: 'owned-2', condition: 'NM', side: 'front', version: 1 }] })
    if (p === '/api/collection/qa-owner/shop-photos/owned-2/front') return route.fulfill({ contentType: 'image/jpeg', body: tinyJpeg })
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
    assert.equal(await page.locator('.share-owner-note').count(), 0, 'visitors must not see the owner note')
    await page.screenshot({ path: path.join(report, `shop-${width}.png`) })

    // Set filter lives in the URL: choosing a set filters, Back returns to all sets.
    const all = await page.locator('.card-grid .pcard').count()
    await page.getByRole('combobox', { name: 'Filter by set' }).selectOption(sets[0])
    await page.waitForURL(`**?set=${sets[0]}`)
    const inSet = fixture.shop.cards.filter(c => c.card.setId === sets[0]).length
    await page.waitForFunction(n => document.querySelectorAll('.card-grid .pcard').length === Math.min(n, 48), inSet)
    await page.goBack()
    await page.waitForFunction(n => document.querySelectorAll('.card-grid .pcard').length === n, all)

    // Signed out: sending (or asking for photos) shows the sign-in screen, keeping the picked cards; Back returns.
    const first = fixture.shop.cards[0].card
    await page.getByPlaceholder('Search name, artist, set…').fill(first.name)
    const tile = page.locator('.card-grid .pcard').filter({ hasText: first.name }).first()
    await tile.getByRole('button', { name: /^Add one/ }).click()
    await page.getByRole('button', { name: 'Send request' }).click()
    await page.locator('.shop-signin-note').getByText('Sign in to send your request.').waitFor()
    assert.equal(JSON.parse(await page.evaluate(() => sessionStorage.getItem('cardstacks.shop.pending.nmenard90'))).cart[0].cardId, first.id)
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `shop-signin-${width}.png`) })
    await page.getByRole('button', { name: '← Back to the shop' }).click()
    await tile.waitFor()
    assert.equal(await page.evaluate(() => sessionStorage.getItem('cardstacks.shop.pending.nmenard90')), null)
    assert.equal(state.sent.length, 0)
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  for (const width of WIDTHS) await run(`signed-in buyer: ask for photos on the tile, one tidy form, chat on the request (${width}px)`, async () => {
    const { context, page, state, errors } = await setup({ as: 'buyer', width, height: heightFor(width) })
    await openShop(page)
    const first = fixture.shop.cards[0].card
    await page.getByPlaceholder('Search name, artist, set…').fill(first.name)
    const tile = page.locator('.card-grid .pcard').filter({ hasText: first.name }).first()
    // 📷 Ask for photos sits on the tile (no checkbox in the form) and turns into "asked".
    await tile.getByRole('button', { name: '📷 Ask for photos' }).click()
    await tile.getByRole('button', { name: '📷 Photos asked ✓' }).waitFor()
    assert.equal(state.photoAsks.length, 1)
    assert.equal(state.photoAsks[0].cardId, first.id)
    await page.screenshot({ path: path.join(report, `shop-tile-asked-${width}.png`) })
    await tile.getByRole('button', { name: /^Add one/ }).click()
    await page.getByRole('button', { name: 'Send request' }).click()
    const dialog = page.getByRole('dialog', { name: 'Send request' })
    await dialog.getByText('Signed in as').waitFor()
    // One checkbox (the rules), Buy/Trade as one choice, no contact fields.
    assert.equal(await dialog.getByRole('checkbox').count(), 1, 'exactly one checkbox on the form')
    assert.equal(await dialog.getByRole('radio').count(), 2)
    assert(await dialog.getByRole('radio', { name: /Buy/ }).isChecked(), 'Buy is the default')
    assert.equal(await dialog.locator('input[type=tel], input[type=email], input[type=url]').count(), 0, 'no contact boxes')
    // Every label on the form uses the same font.
    const fonts = await dialog.locator('label, legend').evaluateAll(els => els.map(e => getComputedStyle(e).fontFamily))
    assert.equal(new Set(fonts).size, 1, `form fonts differ: ${[...new Set(fonts)]}`)
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: /tick the box/ }).waitFor()
    assert.equal(state.sent.length, 0, 'not sent before agreeing to the rules')
    await dialog.getByRole('checkbox', { name: /prices follow the market/ }).check()
    await dialog.getByLabel('Message to the seller (optional)').fill('Can you hold it until Friday?')
    await page.screenshot({ path: path.join(report, `shop-form-${width}.png`) })
    await dialog.getByRole('button', { name: 'Send', exact: true }).click()
    await dialog.getByRole('heading', { name: /Sent!/ }).waitFor()
    assert.equal(state.sent.length, 1)
    assert.deepEqual(Object.keys(state.sent[0]).sort(), ['items', 'message'], 'no name or contact is sent; the account says who')
    assert.equal(state.sent[0].items[0].cardId, first.id)
    assert.equal(state.sent[0].message, 'Can you hold it until Friday?')
    await page.screenshot({ path: path.join(report, `shop-sent-${width}.png`) })
    // Their request page: the card, its photos once taken, and the chat with the seller.
    await dialog.getByRole('link', { name: 'Open your request' }).click()
    await page.waitForURL('**/shop/nmenard90/request/qa-request')
    await page.getByRole('heading', { name: new RegExp(`Chat with ${fixture.shop.displayName}`) }).waitFor()
    assert.match((await page.locator('.buyer-req__card').first().innerText()).replace(/\s+/g, ' '), new RegExp(`1× ${first.name}`))
    await page.getByLabel('Message the seller').fill('Thanks! Paying by Venmo.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.locator('.offer-msg.mine').getByText('Thanks! Paying by Venmo.').waitFor()
    assert.equal(state.buyerChat.length, 1)
    const cond = state.sent[0].items[0].condition
    state.buyerPhotos = [{ cardId: first.id, condition: cond, side: 'front', version: 1 }, { cardId: first.id, condition: cond, side: 'back', version: 1 }]
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.buyer-req__card .photo-frame').nth(1).waitFor()
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `buyer-request-chat-${width}.png`) })
    // Back on the shop: a link to their requests (a buy request and a photo request).
    await page.getByRole('link', { name: /Back to the shop/ }).click()
    await page.getByRole('link', { name: /Your requests/ }).waitFor()
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  await run('trade request: catalog search, must cover the cards picked, cash top-up', async () => {
    const { context, page, state, errors } = await setup({ as: 'buyer', width: 390, height: 844 })
    await openShop(page)
    // Pick the priciest card so one Trade Bait ($3) is short and needs cash.
    const priciest = fixture.shop.cards.reduce((a, b) => ((b.card.prices?.nm ?? 0) > (a.card.prices?.nm ?? 0) ? b : a))
    await page.getByPlaceholder('Search name, artist, set…').fill(priciest.card.name)
    await page.locator('.card-grid .pcard').filter({ hasText: priciest.card.name }).first().getByRole('button', { name: /^Add one/ }).click()
    await page.getByRole('button', { name: 'Send request' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Trade/ }).check()
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

  await run('owner: shop page is what buyers see (no photo buttons), links to My Shop; Settings saves name and bio', async () => {
    const { context, page, state, errors } = await setup({ authenticated: true })
    await openShop(page)
    // The owner sees the same buttons buyers see (no seller-only photo button); trying one just explains.
    assert.equal(await page.getByRole('button', { name: /Take photo|Add photos/ }).count(), 0, 'photos are taken on the seller side, not on the shop')
    await page.locator('.card-grid .pcard').first().getByRole('button', { name: '📷 Ask for photos' }).waitFor()
    await page.getByRole('button', { name: 'Ask a question' }).click()
    await page.getByText(/This is your own shop/).first().waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0, 'no request form for your own shop')
    assert.equal(state.sent.length, 0)
    await page.locator('.share-owner-note').getByRole('link', { name: 'My Shop' }).click()
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
    // Each requested card: picture, set, today's price and where it's kept; one the seller no longer owns says so.
    const mid = page.locator('.req-card', { hasText: 'Owned Mid' })
    await mid.locator('.req-card__places li', { hasText: 'Bulk Box 3' }).waitFor()
    const midText = (await mid.innerText()).replace(/\s+/g, ' ')
    for (const want of ['2× Owned Mid', '#2', 'Great Encounters', '$5.00 each ($10.00)', 'Bulk Box 3 › Main · 2× NM', 'Trade Binder · page 3, pocket 5'])
      assert(midText.includes(want), `missing "${want}" in: ${midText}`)
    assert.equal(await mid.locator('img.thumb').count(), 1, 'the card picture is shown')
    // Hovering (tapping on a phone) the picture shows it big, for checking the card while pulling it.
    if (width === 390) await mid.locator('img.thumb').tap(); else await mid.locator('img.thumb').hover()
    await page.locator('.card-preview-wrap.visible').waitFor({ state: 'attached' }) // open (its picture loads from the internet)
    assert.equal(await page.locator('.card-preview-img').getAttribute('src'), 'https://images.pokemontcg.io/dp4/1_hires.png')
    await page.waitForTimeout(600) // still open after the opening tap's click; a later tap closes it
    assert.equal(await page.locator('.card-preview-wrap.visible').count(), 1)
    if (width === 390) await page.locator('.card-preview-overlay').tap(); else await page.mouse.move(0, 0)
    await page.locator('.card-preview-wrap.visible').waitFor({ state: 'detached' })
    const gone = (await page.locator('.req-card', { hasText: 'Greavard' }).innerText()).replace(/\s+/g, ' ')
    assert.match(gone, /No longer in your collection/); assert.match(gone, /Not in a box, binder or display case yet/)
    assert.equal(state.locationIds, 'me1-65,owned-0,owned-1,owned-2')
    // Pull list: how many cards and the total up top; grouped by set, card number order; Found and condition per card.
    const summary = page.locator('.req-cards__summary')
    assert.equal((await summary.innerText()).replace(/\s+/g, ' '), '0 of 5 cards found · Total $31.00 (1 without a price)')
    assert.deepEqual(await page.locator('.req-set__name').allInnerTexts(), ['Great Encounters · 4', 'No longer in your collection · 1'])
    assert.deepEqual((await page.locator('.req-set').first().locator('.req-card__title b').allInnerTexts()), ['1× Owned Low', '2× Owned Mid', '1× Owned High'])
    await mid.getByRole('button', { name: 'Find' }).click()
    await mid.getByRole('button', { name: 'Found', pressed: true }).waitFor()
    assert.match(await summary.innerText(), /^2 of 5 cards found/)
    await mid.getByRole('group', { name: 'Condition of Owned Mid' }).getByRole('button', { name: 'LP' }).click()
    await mid.getByText('Buyer picked NM').waitFor()
    assert.match((await mid.locator('.req-card__meta').innerText()).replace(/\s+/g, ' '), /· LP · \$4\.00 each \(\$8\.00\)/)
    assert.match(await summary.innerText(), /Total \$29\.00/)
    assert.deepEqual(state.itemPosts, [{ index: 2, pulled: true }, { index: 2, condition: 'LP' }])
    // Saved: still found and LP after a reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await mid.getByRole('button', { name: 'Found', pressed: true }).waitFor()
    assert.equal(await mid.getByRole('button', { name: 'LP', pressed: true }).count(), 1)
    // No link from this buyer: a Facebook people search for their name.
    assert.equal(await page.getByRole('link', { name: /Search “Ash” on Facebook/ }).getAttribute('href'), 'https://www.facebook.com/search/people/?q=Ash')
    // Shop nav link carries the new-request count (desktop row or phone tab bar).
    const nav = width === 390 ? page.locator('.bottom-nav a[href="/shop/requests"]') : page.locator('.app-nav a[href="/shop/requests"]')
    assert.equal(await nav.locator('.nav-badge').innerText(), '1')
    const high = page.locator('.req-card', { hasText: 'Owned High' })
    await high.getByText('Buyer asked for photos').waitFor()
    assert.equal(await mid.getByText('Buyer asked for photos').count(), 0)
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `my-shop-${width}.png`) })
    await high.getByRole('button', { name: '📷 Photos · 1 of 2' }).click()
    const photoDialog = page.getByRole('dialog', { name: 'Photos of Owned High' })
    await photoDialog.locator('img[alt="front of your Owned High"]').waitFor()
    await page.screenshot({ path: path.join(report, `my-shop-photos-${width}.png`) })
    await photoDialog.getByRole('button', { name: 'Done' }).click()
    assert.equal(await mid.getByRole('button', { name: '📷 Add photos' }).count(), 1)
    await page.getByRole('button', { name: 'Mark answered' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.shop-req').length === 0)
    assert.equal(state.inbox[0].status, 'answered')
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  for (const width of WIDTHS) await run(`My Shop: chat with a signed-in buyer in the request; Sent tab for your own requests (${width}px)`, async () => {
    const { context, page, state, errors } = await setup({ authenticated: true, width, height: heightFor(width) })
    await page.goto(origin + '/shop/requests', { waitUntil: 'domcontentloaded' })
    await page.locator('.shop-req').first().waitFor()
    assert.equal(await page.getByRole('button', { name: /^Sent/ }).count(), 0, 'no Sent tab without sent requests')
    await page.getByRole('button', { name: 'Answered', exact: true }).click()
    const r2 = page.locator('.shop-req', { hasText: 'qa-buyer' })
    await r2.getByRole('heading', { name: 'Chat with qa-buyer' }).waitFor()
    await r2.getByText('Is the Owned Low centered?').waitFor()
    assert.equal(await r2.getByText(/Reach them at/).count(), 0, 'a signed-in buyer has a chat, not a typed contact')
    await r2.getByLabel('Message qa-buyer').fill('Yes, dead center. Photos coming.')
    await r2.getByRole('button', { name: 'Send', exact: true }).click()
    await r2.locator('.offer-msg.mine').getByText('Yes, dead center. Photos coming.').waitFor()
    assert.equal(state.sellerChat.at(-1).body, 'Yes, dead center. Photos coming.')
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `my-shop-chat-${width}.png`) })
    assert.equal(errors.length, 0, errors.join('\n'))
    await context.close()
  })

  for (const width of [1440, 390]) await run(`My Shop: a sale takes out only the found cards; refunds put them back (${width}px)`, async () => {
    const { context, page, state, errors } = await setup({ authenticated: true, width, height: width === 390 ? 844 : 900 })
    await page.goto(origin + '/shop/requests', { waitUntil: 'domcontentloaded' })
    const low = page.locator('.req-card', { hasText: 'Owned Low' }), mid = page.locator('.req-card', { hasText: 'Owned Mid' })
    await mid.locator('.req-card__places li', { hasText: 'Bulk Box 3' }).waitFor()
    assert.match(await page.locator('.sale__hint').innerText(), /Mark the cards you found/)
    // Of the 2 Owned Mid asked for, only 1 was found; Owned Low was found; Owned High and Greavard weren't.
    await mid.getByRole('button', { name: 'One more found' }).click()
    await mid.getByText('1 of 2 found').waitFor()
    await mid.getByRole('button', { name: 'Found', pressed: true }).waitFor()
    await low.getByRole('button', { name: 'Find' }).click()
    await low.getByRole('button', { name: 'Found', pressed: true }).waitFor() // the click has drawn before the count is read
    assert.match(await page.locator('.req-cards__summary').innerText(), /^2 of 5 cards found/)
    await page.getByRole('button', { name: 'Complete sale · take out 2 cards' }).click()
    assert.equal((await page.locator('.sale__ask p').innerText()).replace(/\s+/g, ' '), 'Take the 2 cards you found out of your collection? The 3 cards not found stay.')
    assert.equal(state.salePosts.length, 0, 'nothing is taken out before saying yes')
    await page.getByRole('button', { name: 'Yes, take them out' }).click()
    await page.getByText('Sold: 2 cards taken out of your collection.').waitFor()
    // Still on screen though it's Done now; sold cards say so, can be put back, and can't be re-graded.
    assert.match(await page.locator('.shop-req .shop-pill').innerText(), /Done/)
    assert.match((await mid.locator('.req-sold__tag').innerText()), /Sold 1/)
    assert(await mid.getByRole('button', { name: 'LP' }).isDisabled())
    assert.equal(await page.locator('.req-card', { hasText: 'Owned High' }).locator('.req-sold').count(), 0)
    assert.match(await page.locator('.req-cards__summary').innerText(), /2 sold and taken out of your collection/)
    assert.equal(await page.getByRole('button', { name: /^Complete sale/ }).count(), 0, 'nothing left to take out')
    await noOverflow(page)
    await page.screenshot({ path: path.join(report, `my-shop-sold-${width}.png`) })
    // One card comes back (a return), then the rest (a refund).
    await mid.getByRole('button', { name: 'Put back' }).click()
    await mid.getByRole('button', { name: 'Found', pressed: true }).waitFor()
    await page.getByRole('button', { name: 'Refund · put all 1 back' }).click()
    await page.getByText('Put back: 1 card returned to your collection.').waitFor()
    assert.deepEqual(state.salePosts, [{ action: 'sell' }, { action: 'put-back', index: 2 }, { action: 'put-back' }])
    assert.deepEqual(state.itemPosts, [{ index: 2, foundQty: 1 }, { index: 3, pulled: true }])
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

  await run('Explore: a card you own has Photos, with your existing front photo', async () => {
    const { context, page, errors } = await setup({ authenticated: true })
    await page.goto(origin + '/explore?set=all', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Owned only', exact: true }).click()
    const tile = page.locator('.pcard', { hasText: 'Owned High' })
    await tile.getByRole('button', { name: '📷 Photos' }).click()
    const dialog = page.getByRole('dialog', { name: 'Photos of Owned High' })
    await dialog.waitFor()
    await dialog.locator('img[alt="front of your Owned High"]').waitFor()
    assert.equal(await dialog.getByRole('button', { name: '📷 Retake' }).count(), 1, 'front has a photo: retake')
    assert.equal(await dialog.getByRole('button', { name: '📷 Take photo' }).count(), 1, 'back has none yet')
    await page.screenshot({ path: path.join(report, 'explore-photos.png') })
    await dialog.getByRole('button', { name: 'Done' }).click()
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
