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
 *
 * USED BY: `npm start` (the production start command, port from $PORT)
 * DEPENDS ON: ogTags.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectOg, originFromHeaders, shopOg, shopSlugFromPath } from './ogTags.mjs'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT) || 4173

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
}

/** The file for this URL path, or null if it doesn't exist or would escape dist/. */
function fileFor(pathname) {
  const target = path.normalize(path.join(DIST, pathname))
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return null
  try { return fs.statSync(target).isFile() ? target : null } catch { return null }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end() }

  let pathname
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { res.writeHead(400); return res.end('Bad request') }

  const send = (status, headers, body) => { res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : body) }

  // Real files (JS, CSS, images...). Hashed build assets can be cached forever.
  const file = fileFor(pathname)
  if (file && path.basename(file) !== 'index.html') {
    const immutable = pathname.startsWith('/assets/')
    return send(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    }, fs.readFileSync(file))
  }

  // Everything else is a page: index.html, with share tags added for shop URLs.
  let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  const slug = shopSlugFromPath(pathname)
  if (slug) html = injectOg(html, shopOg(slug, originFromHeaders(req.headers)))
  send(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }, html)
})

server.listen(PORT, () => console.log(`CardStacks web listening on :${PORT}`))
