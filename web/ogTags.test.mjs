// Unit tests for the Open Graph tag builder. Run: node --test ogTags.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { injectOg, originFromHeaders, shopOg, shopSlugFromPath } from './ogTags.mjs'

const PAGE = '<!doctype html><html><head><meta charset="UTF-8" /><title>CardStacks</title></head><body></body></html>'

test('only real shop pages get tags', () => {
  assert.equal(shopSlugFromPath('/shop/testowner'), 'testowner')
  assert.equal(shopSlugFromPath('/shop/TestOwner/'), 'testowner')
  assert.equal(shopSlugFromPath('/shop/requests'), null)   // the owner's inbox, not a shop
  assert.equal(shopSlugFromPath('/shop/ab'), null)          // too short to be a link name
  assert.equal(shopSlugFromPath('/shop/a/b'), null)
  assert.equal(shopSlugFromPath('/shop/<script>'), null)
  assert.equal(shopSlugFromPath('/s/abc123'), null)
  assert.equal(shopSlugFromPath('/'), null)
})

test('tags cover title, description, preview image and url, all absolute', () => {
  const html = injectOg(PAGE, shopOg('testowner', 'https://cards.example'))
  for (const want of [
    "<title>testowner's Pokémon cards for sale</title>",
    'property="og:title" content="testowner\'s Pokémon cards for sale"',
    'property="og:description" content="Browse the collection',
    'property="og:image" content="https://cards.example/og-shop.png"',
    'property="og:url" content="https://cards.example/shop/testowner"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:card" content="summary_large_image"',
  ]) assert.ok(html.includes(want), `missing: ${want}`)
  assert.equal((html.match(/<title>/g) ?? []).length, 1)
  assert.ok(html.indexOf('og:title') < html.indexOf('</head>'), 'tags must be inside <head>')
})

test('the description states the no-percentage / no-trade rules', () => {
  const { tags } = shopOg('testowner', 'https://cards.example')
  assert.match(tags, /Prices follow the market/)
  assert.match(tags, /No percentage offers, no trades/)
})

test('origin comes from proxy headers; junk hosts fall back safely', () => {
  assert.equal(originFromHeaders({ host: 'a.example', 'x-forwarded-proto': 'https' }), 'https://a.example')
  assert.equal(originFromHeaders({ host: 'internal:8080', 'x-forwarded-host': 'public.example', 'x-forwarded-proto': 'https,http' }), 'https://public.example')
  assert.equal(originFromHeaders({ host: 'localhost:5174' }), 'http://localhost:5174')
  assert.equal(originFromHeaders({ host: '"><script>x</script>' }), 'http://localhost')
  assert.equal(originFromHeaders({}), 'http://localhost')
})
