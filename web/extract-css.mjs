// One-off build script: ports the legacy app's CSS verbatim into the React app.
// Extracts each old page's <style> block and prefixes every selector with a
// page-scope class so all four stylesheets can coexist in the SPA.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import postcss from 'postcss'
import prefixer from 'postcss-prefix-selector'

const pages = [
  { src: '../files/index.html',    out: 'src/styles/tracker.css',  scope: '.page-tracker'  },
  { src: '../files/shelf.html',    out: 'src/styles/shelf.css',    scope: '.page-shelf'    },
  { src: '../files/binder.html',   out: 'src/styles/binder.css',   scope: '.page-binder'   },
  { src: '../files/analyzer.html', out: 'src/styles/analyzer.css', scope: '.page-analyzer' },
]

mkdirSync('src/styles', { recursive: true })

for (const { src, out, scope } of pages) {
  const html = readFileSync(src, 'utf8')
  const m = html.match(/<style>([\s\S]*?)<\/style>/)
  if (!m) { console.error('no <style> in', src); continue }
  let css = m[1]
  // Strip font @imports and :root tokens — both are defined once in index.css.
  css = css.replace(/@import url\([^)]*\);/g, '')
  css = css.replace(/:root\s*\{[^}]*\}/g, '')

  const scoped = await postcss([
    prefixer({
      prefix: scope,
      transform(prefix, selector, prefixed) {
        // body/html styles become the page wrapper's own styles
        if (selector === 'body' || selector === 'html') return prefix
        if (selector.startsWith('body')) return prefix + selector.slice(4)
        // universal reset is already global in index.css
        if (selector === '*') return selector
        return prefixed
      },
    }),
  ]).process(css, { from: undefined })

  // Keyframe names collide across pages (every page defines `spin`) — namespace them.
  const ns = scope.slice(1).replace('page-', '')
  let final = scoped.css
    .replace(/@keyframes\s+([\w-]+)/g, (_, n) => `@keyframes ${ns}-${n}`)
    .replace(/animation:\s*([\w-]+)/g, (_, n) => `animation:${ns}-${n}`)

  writeFileSync(out, `/* Ported verbatim from old ${src.split('/').pop()} — scoped under ${scope} */\n` + final)
  console.log(out, final.length, 'bytes')
}
