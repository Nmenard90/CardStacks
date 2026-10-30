/**
 * server.mjs — serves the built app (dist/) in production.
 *
 * HOW IT WORKS
 *   Replaces `npx serve dist --single`: static files are served as-is, and any
 *   other URL gets index.html so the React router can handle it (the same
 *   single-page-app fallback). The one difference: for public shop pages
 *   (/shop/<slug>) the HTML gets Open Graph tags added first, because
 *   Facebook's crawler doesn't run JavaScript and would otherwise see a bare
 *   page. Built on Node's own http module — no extra dependency.
 *   `/card-art?u=…` relays TCGplayer card images with a CORS header so the 3D room
 *   can draw them (see cardArt.mjs).
 *   Scripts, styles and 3D models are sent compressed (brotli, else gzip): about
 *   5 MB of them shrink to about 1 MB, the biggest part of a first visit's wait.
 *   They're compressed once, in the background when the server starts (dist/
 *   doesn't change while it runs); until a file's copy is ready it goes as is.
 *
 * USED BY: `npm start` (the production start command, port from $PORT)
 * DEPENDS ON: ogTags.mjs, cardArt.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import { injectOg, originFromHeaders, shopOg, shopSlugFromPath } from './ogTags.mjs'
import { serveCardArt } from './cardArt.mjs'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 4173

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
}

/** Kinds of file worth compressing; pictures and fonts are compressed already. */
const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.svg', '.txt', '.map', '.glb'])

/** file path → its compressed copies ({ br, gzip }), filled in by packAll. */
const packed = new Map()

/** Compresses every compressible file under `dir` in the background (zlib's worker threads), keeping smaller copies. */
function packAll(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) { packAll(file); continue }
    if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue
    const body = fs.readFileSync(file)
    const keep = (encoding) => (err, copy) => { if (!err && copy.length < body.length) packed.set(file, { ...packed.get(file), [encoding]: copy }) }
    zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, keep('br'))
    zlib.gzip(body, { level: 9 }, keep('gzip'))
  }
}

/** The best encoding this request accepts that we have for `file`, or null. */
function encodingFor(req, file) {
  const accepts = String(req.headers['accept-encoding'] ?? '')
  const copies = packed.get(file)
  if (copies?.br && /\bbr\b/.test(accepts)) return 'br'
  if (copies?.gzip && /\bgzip\b/.test(accepts)) return 'gzip'
  return null
}

/** The file for this URL path, or null if it doesn't exist or would escape dist/. */
function fileFor(pathname) {
  const target = path.normalize(path.join(DIST, pathname))
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return null
  try { return fs.statSync(target).isFile() ? target : null } catch { return null }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end() }

  let pathname, query
  try {
    const url = new URL(req.url, 'http://x')
    pathname = decodeURIComponent(url.pathname)
    query = url.searchParams
  } catch { res.writeHead(400); return res.end('Bad request') }

  if (pathname === '/card-art') return void serveCardArt(req, res, query)

  const send = (status, headers, body) => { res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : body) }

  // Real files (JS, CSS, images...). Hashed build assets can be cached forever.
  const file = fileFor(pathname)
  if (file && path.basename(file) !== 'index.html') {
    const immutable = pathname.startsWith('/assets/')
    const encoding = encodingFor(req, file)
    return send(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      ...(COMPRESSIBLE.has(path.extname(file).toLowerCase()) ? { Vary: 'Accept-Encoding' } : {}),
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
    }, encoding ? packed.get(file)[encoding] : fs.readFileSync(file))
  }

  // Everything else is a page: index.html, with share tags added for shop URLs.
  let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  const slug = shopSlugFromPath(pathname)
  if (slug) html = injectOg(html, shopOg(slug, originFromHeaders(req.headers)))
  send(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }, html)
})

try { packAll(DIST) } catch (err) { console.error('Could not prepare compressed files; serving them as is.', err) }
server.listen(PORT, () => console.log(`CardStacks web listening on :${PORT}`))
