/**
 * cardArt.test.mjs — the card-art relay only fetches TCGplayer images and only answers with images.
 * Run: npm run test:server (node --test, no network: fetch is injected).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { artTarget, serveCardArt } from './cardArt.mjs'

test('allows https TCGplayer image hosts only', () => {
  assert.ok(artTarget('https://tcgplayer-cdn.tcgplayer.com/product/42382_800w.jpg'))
  assert.ok(artTarget('https://product-images.tcgplayer.com/fit-in/437x437/42382.jpg'))
  for (const bad of [
    null, '', 'not a url', 'http://tcgplayer-cdn.tcgplayer.com/a.jpg', 'https://evil.com/a.jpg',
    'https://tcgplayer-cdn.tcgplayer.com.evil.com/a.jpg', 'https://user:pw@tcgplayer-cdn.tcgplayer.com/a.jpg',
    'https://tcgplayer-cdn.tcgplayer.com:8443/a.jpg', 'https://169.254.169.254/latest', 'file:///etc/passwd',
    `https://tcgplayer-cdn.tcgplayer.com/${'a'.repeat(600)}`,
  ]) assert.equal(artTarget(bad), null, String(bad))
})

/** A ServerResponse stand-in that records what was written. */
function recorder() {
  const out = { status: 0, headers: {}, body: undefined }
  return { out, res: { writeHead: (s, h) => { out.status = s; out.headers = h }, end: (b) => { out.body = b } } }
}
const fakeFetch = (status, type, bytes) => async () => new Response(new Uint8Array(bytes), { status, headers: { 'content-type': type } })

test('relays an allowed image with a CORS header', async () => {
  const { out, res } = recorder()
  await serveCardArt({ method: 'GET' }, res, new URLSearchParams({ u: 'https://tcgplayer-cdn.tcgplayer.com/product/1_800w.jpg' }), fakeFetch(200, 'image/jpeg', 10))
  assert.equal(out.status, 200)
  assert.equal(out.headers['Access-Control-Allow-Origin'], '*')
  assert.equal(out.headers['Content-Type'], 'image/jpeg')
  assert.equal(out.body.length, 10)
})

test('refuses disallowed urls without fetching', async () => {
  const { out, res } = recorder()
  let called = false
  await serveCardArt({ method: 'GET' }, res, new URLSearchParams({ u: 'https://evil.com/x.jpg' }), async () => { called = true })
  assert.equal(out.status, 400)
  assert.equal(called, false)
})

test('refuses non-image answers and upstream errors', async () => {
  for (const [fetchImpl, status] of [[fakeFetch(200, 'text/html', 5), 502], [fakeFetch(404, 'image/jpeg', 0), 404], [fakeFetch(500, 'image/jpeg', 0), 502], [async () => { throw new Error('boom') }, 504]]) {
    const { out, res } = recorder()
    await serveCardArt({ method: 'GET' }, res, new URLSearchParams({ u: 'https://tcgplayer-cdn.tcgplayer.com/a.jpg' }), fetchImpl)
    assert.equal(out.status, status)
  }
})
