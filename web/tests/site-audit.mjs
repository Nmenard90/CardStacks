/**
 * site-audit.mjs — walks every page of CardStacks in a real Chromium, at desktop and phone sizes, and reports problems.
 *
 * PURPOSE
 *   A quick health check of the whole site, signed out and signed in (a throwaway "Try the demo" account the backend
 *   deletes after 24 hours — nothing else is read or changed, and nothing is clicked except "Try the demo" / "Skip").
 *   For every page it records: crashes and console errors, failed requests, content wider than the screen, images
 *   without alt text, buttons/links/fields with no accessible name, tap targets under 24 px on a phone (WCAG 2.2 AA),
 *   pages with no heading, and a screenshot.
 *
 * RUN
 *   SITE_AUDIT_ORIGIN=https://cardstacks.up.railway.app node tests/site-audit.mjs
 *   Env: SITE_AUDIT_ORIGIN (default http://127.0.0.1:5180), SITE_AUDIT_OUT (report + screenshot folder),
 *        PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM_EXECUTABLE (as in room-browser.mjs).
 *   Writes audit.json and audit.md to SITE_AUDIT_OUT. Exits 0 even when it finds problems: it is a report, not a gate.
 *
 * USED BY: developers / agents before and after a release (see docs/agent-reports)
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../../', import.meta.url))
const origin = (process.env.SITE_AUDIT_ORIGIN || 'http://127.0.0.1:5180').replace(/\/$/, '')
const out = process.env.SITE_AUDIT_OUT || path.join(root, 'docs/agent-reports/site-audit')
fs.mkdirSync(out, { recursive: true })

const SIGNED_OUT = ['/', '/privacy', '/terms', '/shop/no-such-shop-qa', '/s/no-such-link-qa', '/no-such-page-qa']
const SIGNED_IN = ['/', '/explore', '/add', '/spaces', '/analyzer', '/convention', '/shop/requests', '/shop/requests?tab=settings',
  '/trade', '/bulk', '/owned', '/shelf', '/privacy', '/terms', '/shop/no-such-shop-qa', '/no-such-page-qa']
const SIZES = [
  { label: 'desktop', viewport: { width: 1440, height: 900 } },
  { label: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
]

/** Runs in the page: everything that can be judged from the DOM. */
function inspect({ phone }) {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 }
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ''}`
  }
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || ''
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    const own = el.innerText || el.textContent || ''
    const alt = [...el.querySelectorAll('img[alt], svg[aria-label]')].map((i) => i.getAttribute('alt') || i.getAttribute('aria-label')).join(' ')
    const field = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? '' : ''
    const wrapped = el.closest('label')?.textContent ?? ''
    return (label + by + own + alt + field + wrapped + (el.getAttribute('placeholder') ?? '')).trim()
  }
  // Inside a box that scrolls sideways on purpose (a carousel, a table), sticking out is fine.
  const scrollsSideways = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p).overflowX; if (s === 'auto' || s === 'scroll' || s === 'hidden' || s === 'clip') return true } return false }
  const width = document.documentElement.clientWidth
  const spill = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el) || el.closest('canvas, svg')) return false
    const r = el.getBoundingClientRect()
    return (r.right > width + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed' && !scrollsSideways(el)
  })
  const interactive = [...document.querySelectorAll('a[href], button, [role="button"], [role="tab"], input:not([type="hidden"]), select, textarea')].filter(visible)
  const unnamed = interactive.filter((el) => !nameOf(el))
  const small = phone ? interactive.filter((el) => {
    if (el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label')) return false // the label is the target
    const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24
  }) : []
  return {
    title: document.title,
    headings: document.querySelectorAll('h1, h2').length,
    textLength: document.body.innerText.trim().length,
    pageScrollsSideways: document.documentElement.scrollWidth > width + 1,
    spill: spill.slice(0, 6).map(describe),
    spillCount: spill.length,
    imagesWithoutAlt: [...document.querySelectorAll('img:not([alt])')].filter(visible).slice(0, 6).map((i) => i.src.slice(0, 80)),
    unnamed: unnamed.slice(0, 6).map((el) => el.outerHTML.slice(0, 120)),
    unnamedCount: unnamed.length,
    smallTargets: small.slice(0, 8).map((el) => { const r = el.getBoundingClientRect(); return `${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}` }),
    smallTargetCount: small.length,
  }
}

const browser = await chromium.launch({
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
})
const report = { origin, at: new Date().toISOString(), pages: [] }

async function visit(page, size, signedIn, route, problems) {
  problems.length = 0
  const started = Date.now()
  let status = null
  try {
    const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 45000 })
    status = response?.status() ?? null
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(1200) // late renders (room, lazy pages)
  } catch (error) { problems.push(`navigation: ${String(error.message).split('\n')[0]}`) }
  const facts = await page.evaluate(inspect, { phone: size.label === 'phone' }).catch((error) => ({ error: String(error.message) }))
  const file = `${size.label}-${signedIn ? 'in' : 'out'}-${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`
  await page.screenshot({ path: path.join(out, file) }).catch(() => {})
  report.pages.push({ size: size.label, signedIn, route, landedOn: page.url().replace(origin, ''), status, ms: Date.now() - started, problems: [...problems], ...facts, screenshot: file })
  const flags = [...problems, facts.pageScrollsSideways && 'scrolls sideways', facts.unnamedCount && `${facts.unnamedCount} unnamed controls`, facts.smallTargetCount && `${facts.smallTargetCount} small tap targets`, facts.imagesWithoutAlt?.length && 'images without alt', facts.textLength < 20 && 'blank page'].filter(Boolean)
  console.log(`  ${flags.length ? '!' : '✓'} ${size.label} ${signedIn ? 'in ' : 'out'} ${route}${flags.length ? `  — ${flags.join('; ')}` : ''}`)
}

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: size.viewport, hasTouch: size.hasTouch, isMobile: size.isMobile, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', (error) => problems.push(`page error: ${error.message.split('\n')[0]}`))
  page.on('console', (msg) => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) problems.push(`console: ${msg.text().split('\n')[0].slice(0, 200)}`) })
  page.on('response', (response) => { if (response.status() >= 400 && !/favicon/.test(response.url())) problems.push(`${response.status()} ${response.request().method()} ${response.url().replace(origin, '').slice(0, 120)}`) })
  page.on('requestfailed', (request) => { const why = request.failure()?.errorText ?? ''; if (!/ERR_ABORTED/.test(why)) problems.push(`failed ${request.method()} ${request.url().replace(origin, '').slice(0, 120)} (${why})`) })

  console.log(`\n${size.label}, signed out`)
  for (const route of SIGNED_OUT) await visit(page, size, false, route, problems)

  console.log(`\n${size.label}, signed in (demo account)`)
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Try the demo/ }).click({ timeout: 30000 })
    await page.waitForFunction(() => !document.querySelector('.auth-demo-btn'), null, { timeout: 60000 })
    const skip = page.getByRole('button', { name: 'Skip' })
    if (await skip.isVisible({ timeout: 8000 }).catch(() => false)) await skip.click() // the room's first-visit guide
  } catch (error) { console.log(`  ✗ could not start the demo: ${error.message.split('\n')[0]}`) }
  for (const route of SIGNED_IN) await visit(page, size, true, route, problems)
  await context.close()
}
await browser.close()

const bad = report.pages.filter((p) => p.problems.length || p.pageScrollsSideways || p.unnamedCount || p.smallTargetCount || p.imagesWithoutAlt?.length || p.textLength < 20 || p.error)
const lines = [`# Site audit — ${origin}`, '', `${report.at} · ${report.pages.length} page views · ${bad.length} with findings`, '',
  '| Size | Signed in | Page | Landed on | Findings |', '|---|---|---|---|---|',
  ...report.pages.map((p) => `| ${p.size} | ${p.signedIn ? 'yes' : 'no'} | \`${p.route}\` | \`${p.landedOn}\` | ${[
    ...p.problems, p.error, p.pageScrollsSideways && `page scrolls sideways (${p.spill.join(', ')})`, p.unnamedCount && `${p.unnamedCount} unnamed: ${p.unnamed.map((u) => `\`${u.replace(/[|`]/g, ' ')}\``).join(' ')}`,
    p.smallTargetCount && `${p.smallTargetCount} tap targets < 24 px: ${p.smallTargets.join(', ')}`, p.imagesWithoutAlt?.length && 'images without alt', p.textLength < 20 && 'blank page', p.headings === 0 && 'no heading',
  ].filter(Boolean).join('<br>').replace(/\|/g, '/') || '—'} |`)]
fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(report, null, 2))
fs.writeFileSync(path.join(out, 'audit.md'), lines.join('\n') + '\n')
console.log(`\n${report.pages.length} page views, ${bad.length} with findings → ${path.join(out, 'audit.md')}`)
