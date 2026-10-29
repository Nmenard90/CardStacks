/**
 * Open Graph tags for public shop pages (/shop/<slug>), so a link pasted into
 * Facebook shows a title, description and preview image.
 *
 * Why this lives outside React: Facebook's crawler does not run JavaScript, so
 * tags set from a component are never seen. server.mjs adds these to the HTML
 * it sends for shop URLs instead. Pure functions only (no I/O), so they can be
 * unit-tested with `node --test`.
 *
 * USED BY: server.mjs, ogTags.test.mjs
 */

// Same shape the backend enforces for a shop link name (ShopRoutes.slugPattern).
const SHOP_PATH = /^\/shop\/([a-z0-9-]{3,30})\/?$/
// Link names the backend refuses because they collide with real front-end routes.
const RESERVED = new Set(['requests', 'admin', 'api', 'new', 'settings'])

/** The shop link name if this path is a public shop page, otherwise null. */
export function shopSlugFromPath(pathname) {
  const match = SHOP_PATH.exec(pathname.toLowerCase())
  return match && !RESERVED.has(match[1]) ? match[1] : null
}

/** Escapes text for use inside a double-quoted HTML attribute or element. */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * @param slug   already validated by shopSlugFromPath
 * @param origin e.g. "https://cardstacks.example" — no trailing slash. Taken from
 *               the request, since Facebook needs absolute URLs and the domain
 *               is not known at build time.
 */
export function shopOg(slug, origin) {
  const title = `${slug}'s Pokémon card shop`
  const description =
    "Browse Pokémon singles by set at today's market prices and send a request — no account needed. " +
    'Prices follow the market. No percentage offers on buys or trades. Trades welcome.'
  return {
    title,
    tags: [
      `<meta name="description" content="${esc(description)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="CardStacks" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${esc(`${origin}/shop/${slug}`)}" />`,
      `<meta property="og:image" content="${esc(`${origin}/og-shop.png`)}" />`,
      `<meta property="og:image:type" content="image/png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${esc(`${slug}'s Pokémon cards for sale on CardStacks`)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ].join('\n    '),
  }
}

/** Swaps the page <title> and adds the tags just before </head>. */
export function injectOg(html, { title, tags }) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`)
    .replace(/<\/head>/i, `    ${tags}\n  </head>`)
}

/**
 * Builds the site origin from proxy headers. Only a plain host name is accepted
 * (letters, digits, dots, dashes, optional port) — anything else falls back to
 * localhost, so a forged Host header can't put markup into the tags. (A
 * well-formed fake host would only change the response to whoever sent it.)
 */
export function originFromHeaders(headers) {
  const first = v => String(v ?? '').split(',')[0].trim().toLowerCase()
  const proto = first(headers['x-forwarded-proto']) === 'https' ? 'https' : 'http'
  const host = first(headers['x-forwarded-host']) || first(headers.host)
  return /^[a-z0-9.-]+(:\d{1,5})?$/.test(host) ? `${proto}://${host}` : 'http://localhost'
}
