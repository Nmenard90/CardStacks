/**
 * cardArt.mjs — a narrow image relay so the 3D room can draw TCGplayer card art.
 *
 * PURPOSE
 *   WebGL can only use a cross-origin image when its server sends CORS headers. pokemontcg.io does; TCGplayer's CDN
 *   (art for TCGTracking sets: Japanese Pokémon, the newest English sets, other games) does not, so those cards would
 *   be blank in 3D. `GET /card-art?u=<image url>` fetches the image server-side and returns it with
 *   `Access-Control-Allow-Origin: *`.
 *
 *   Locked down so it can't be used as an open proxy: https only, exact TCGplayer image hosts only, no credentials or
 *   cookies forwarded, image content types only, a size cap and a timeout. Responses are cacheable for a day.
 *
 * IMPORTS EXPLAINED: none — Node's global fetch.
 * USED BY: server.mjs (production), vite.config.ts (dev server middleware)
 * DEPENDS ON: nothing
 */

/** Hosts whose images may be relayed. Exact names, no wildcards. */
export const ART_HOSTS = Object.freeze(['tcgplayer-cdn.tcgplayer.com', 'product-images.tcgplayer.com'])
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

/**
 * PURPOSE: The upstream URL a /card-art request may fetch, or null when it isn't allowed.
 * @param {string|null} raw  the `u` query value
 * @return {URL|null}
 */
export function artTarget(raw) {
  if (!raw || raw.length > 500) return null
  let url
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (!ART_HOSTS.includes(url.hostname)) return null
  return url
}

/**
 * PURPOSE: Serves one /card-art request.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URLSearchParams} query  the request's query string
 * @param {typeof fetch} [fetchImpl]  injected in tests
 * @return {Promise<void>}
 */
export async function serveCardArt(req, res, query, fetchImpl = fetch) {
  const fail = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(text) }
  const target = artTarget(query.get('u'))
  if (!target) return fail(400, 'Not an allowed card image')
  try {
    const upstream = await fetchImpl(target, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'image/*' } })
    const type = upstream.headers.get('content-type') ?? ''
    if (!upstream.ok) return fail(upstream.status === 404 ? 404 : 502, 'Image unavailable')
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(type.split(';')[0].trim())) return fail(502, 'Not an image')
    const declared = Number(upstream.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) return fail(502, 'Image too large')
    const body = Buffer.from(await upstream.arrayBuffer())
    if (body.length > MAX_BYTES) return fail(502, 'Image too large')
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    fail(504, 'Image fetch failed')
  }
}
