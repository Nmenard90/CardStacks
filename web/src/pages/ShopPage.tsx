/**
 * ShopPage — the public "cards for sale" page that the Facebook post links to.
 *
 * HOW IT WORKS
 *   No login. Laid out like the collection page (top bar with search, stats
 *   row, sort toolbar, grid of wide card tiles) so it looks like the rest of
 *   CardStacks. Each tile is a ShopCardTile: the same tile as the collection's
 *   but for buyers, with condition badges to pick a copy and −/+ to add it to
 *   the request. Buyers then send a request (picked cards plus name/contact) or
 *   just ask a question with nothing picked. Requests land in the seller's inbox
 *   (ShopRequestsPage). A Messenger button shows only when the seller saved one.
 *   Whose shop it is comes from the URL: /shop/:slug.
 *   Prices are the card's LIVE market price every time the page loads —
 *   nothing is snapshotted — and the policy banner says so, along with
 *   "no percentage offers on buys or trades" (trades themselves are welcome).
 *
 * USED BY: App.tsx (route "/shop/:slug")
 * DEPENDS ON: api/shop, api/cards, components/ShopCardTile, SortControl, CardPreview, lib/cardSort, lib/conditions
 */

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useUser } from '../context/UserContext'
import { getSets } from '../api/cards'
import { getShop, getShopSettings, sendShopRequest } from '../api/shop'
import { condPrice } from '../lib/conditions'
import { compareBy, DEFAULT_DIR, type SortDir, type SortKey } from '../lib/cardSort'
import { usePagedList } from '../lib/usePagedList'
import { ShopCardTile } from '../components/ShopCardTile'
import { SortControl } from '../components/SortControl'
import { usePreview } from '../components/CardPreview'
import type { Card, OwnedCard } from '../types'

/** One picked card + condition. */
interface CartLine { card: Card; cond: string; qty: number; max: number }

const SHOP_SORTS: SortKey[] = ['value', 'name', 'set', 'number', 'rarity', 'artist', 'qty', 'recent']
const money = (n: number) => '$' + n.toFixed(2)
const lineKey = (cardId: string, cond: string) => `${cardId}|${cond}`

export function ShopPage() {
  // The link name from the URL (/shop/:slug) picks whose shop this is.
  const { slug = '' } = useParams()
  const { data: shop, isLoading, isError } = useQuery({
    queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false,
  })
  const messengerUrl = shop?.messengerUrl ?? ''
  const owned = useMemo(() => shop?.cards ?? [], [shop])
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setInfo = useMemo(() => new Map(sets.map(s => [s.id, s])), [sets])
  const preview = usePreview()

  // Is the viewer the shop's owner? Only a signed-in user's own settings can say so
  // (the public response deliberately carries no owner identity).
  const { user } = useUser()
  const { data: mine } = useQuery({
    queryKey: ['shop-settings', user?.id], queryFn: () => getShopSettings(user!.id), enabled: !!user && !user.isAnonymous,
  })
  const isOwner = !!mine && mine.slug === slug.toLowerCase()

  const [search, setSearch] = useState('')
  const [setFilter, setSetFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR.value)
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [formOpen, setFormOpen] = useState(false)

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = owned.filter(o =>
      o.conditions.some(c => c.quantity > 0) &&
      (!setFilter || o.card.setId === setFilter) &&
      (!needle || [o.card.name, o.card.artist, o.card.number, setInfo.get(o.card.setId)?.name].some(t => t?.toLowerCase().includes(needle))))
    return list.sort(compareBy((o: OwnedCard) => ({
      name: o.card.name, setId: o.card.setId, number: o.card.number, rarity: o.card.rarity, artist: o.card.artist,
      // Best-condition price, so "value" sorts by what the card sells for.
      value: Math.max(0, ...o.conditions.filter(c => c.quantity > 0).map(c => condPrice(o.card, c.condition))) || null,
      qty: o.conditions.reduce((n, c) => n + c.quantity, 0), addedAt: o.updatedAt,
    }), sort, sortDir, id => setInfo.get(id)?.releaseDate))
  }, [owned, search, setFilter, sort, sortDir, setInfo])

  /** Sets the seller has cards from, newest first, with counts — for the filter. */
  const setOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of owned) counts.set(o.card.setId, (counts.get(o.card.setId) ?? 0) + 1)
    return [...counts.entries()]
      .map(([id, n]) => ({ id, n, name: setInfo.get(id)?.name ?? id, date: setInfo.get(id)?.releaseDate ?? '' }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  }, [owned, setInfo])

  const totalCopies = owned.reduce((n, o) => n + o.conditions.reduce((m, c) => m + c.quantity, 0), 0)
  const totalValue = owned.reduce((n, o) => n + o.conditions.reduce((m, c) => m + c.quantity * condPrice(o.card, c.condition), 0), 0)
  const page = usePagedList(rows, `${search}|${setFilter}|${sort}|${sortDir}|${owned.length}`, 48)

  const adjust = (card: Card, cond: string, max: number, delta: number) =>
    setCart(prev => {
      const key = lineKey(card.id, cond)
      const next = Math.min(max, Math.max(0, (prev[key]?.qty ?? 0) + delta))
      const copy = { ...prev }
      if (next === 0) delete copy[key]; else copy[key] = { card, cond, qty: next, max }
      return copy
    })

  const lines = Object.values(cart)
  const cartCount = lines.reduce((n, l) => n + l.qty, 0)
  const cartTotal = lines.reduce((n, l) => n + l.qty * condPrice(l.card, l.cond), 0)

  return (
    <div className="page-tracker shop-wrap">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">{slug.toUpperCase()}'S <span>SHOP</span></div>
          <Link to="/" className="user-badge" title="Powered by CardStacks">🃏 <b>CardStacks</b></Link>
          <input type="text" className="header-search" placeholder="Search name, artist, set…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {messengerUrl && <a className="user-badge" href={messengerUrl} target="_blank" rel="noreferrer">💬 <b>Message me on Facebook</b></a>}
        </header>

        {isOwner && <p className="share-owner-note" style={{ padding: '8px 16px' }}>This is how buyers see your shop. <Link to="/shop/requests">Edit shop &amp; see requests</Link></p>}

        <section className="shop-hero">
          <h1>{slug}'s Pokémon cards</h1>
          <p>{owned.length > 0 ? `${owned.length} cards available` : 'Cards available'} — buy, trade, or both.</p>
          <ol className="shop-steps">
            <li><b>1</b> Pick the cards you want</li>
            <li><b>2</b> Send a request — buy, trade, or both</li>
            <li><b>3</b> I confirm today's price and we sort out payment and shipping</li>
          </ol>
        </section>

        <section className="shop-policy" aria-label="Pricing and deal rules">
          <b>Please read before you ask:</b>
          <ul>
            <li><b>Prices follow the market.</b> Every price here is today's market price and changes as the market changes. The price when I confirm your order is the price you pay.</li>
            <li><b>No percentage offers, buying or trading.</b> No "X% of TCGplayer" or "% off" deals. Cards are valued at today's market price, both ways.</li>
            <li><b>Trades welcome.</b> Tap "Send request", tick "I'd like to trade", and tell me what you'd offer. I'll value both sides at today's market price.</li>
          </ul>
        </section>

        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Cards for sale</div><div className="stat-value">{owned.length}</div></div>
          <div className="stat"><div className="stat-label">Total copies</div><div className="stat-value">{totalCopies}</div></div>
          <div className="stat"><div className="stat-label">Total value</div><div className="stat-value gold">{money(totalValue)}</div></div>
          {(search || setFilter) && (
            <div className="stat"><div className="stat-label">Showing</div><div className="stat-value">{rows.length} of {owned.length}</div></div>
          )}
        </div>

        <div className="toolbar">
          <select value={setFilter} onChange={e => setSetFilter(e.target.value)} aria-label="Filter by set">
            <option value="">All sets ({owned.length})</option>
            {setOptions.map(s => <option key={s.id} value={s.id}>{s.name} ({s.n})</option>)}
          </select>
          <SortControl keys={SHOP_SORTS} sort={sort} dir={sortDir} onChange={(k, d) => { setSort(k); setSortDir(d) }} />
        </div>

        <div id="app-wrap">
          <div id="main">
            {isLoading && <div className="loading">Loading cards…</div>}
            {isError && <div className="empty">This shop isn't open right now. Check the link, or try again later.</div>}
            {!isLoading && !isError && owned.length === 0 && <div className="empty">No cards for sale right now.</div>}
            {!isLoading && !isError && owned.length > 0 && rows.length === 0 && <div className="empty">No cards match.</div>}
            {rows.length > 0 && (
              <div className="card-grid">
                {page.visible.map(o => (
                  <ShopCardTile
                    key={o.cardId} card={o.card} preview={preview}
                    setName={setInfo.get(o.card.setId)?.name ?? o.card.setId}
                    conds={o.conditions.filter(c => c.quantity > 0).map(c => ({ cond: c.condition, qty: c.quantity }))}
                    inCart={cond => cart[lineKey(o.card.id, cond)]?.qty ?? 0}
                    onAdj={(cond, d) => adjust(o.card, cond, o.conditions.find(c => c.condition === cond)?.quantity ?? 0, d)}
                  />
                ))}
              </div>
            )}
            {page.hasMore && (
              <div className="browser-more"><button onClick={page.loadMore}>Show more ({page.remaining} left)</button></div>
            )}
          </div>
        </div>

        <footer className="shop-footer">
          This shop runs on <Link to="/">CardStacks</Link> — a free tracker for your Pokémon collection. <Link to="/">Start your own</Link>
        </footer>
      </div>
      {preview.overlay}

      <div className="shop-bar">
        <span>{cartCount > 0 ? `${cartCount} card${cartCount === 1 ? '' : 's'} · about ${money(cartTotal)} at today's prices` : 'Pick cards with +, or just ask a question'}</span>
        <button type="button" className="shop-btn" onClick={() => setFormOpen(true)}>
          {cartCount > 0 ? 'Send request' : 'Ask a question'}
        </button>
      </div>

      {formOpen && <RequestForm slug={slug} lines={lines} total={cartTotal} onClose={() => setFormOpen(false)}
        onSent={() => { setCart({}) }} />}
    </div>
  )
}

/** The request / question form, shown over the page. */
function RequestForm({ slug, lines, total, onClose, onSent }: {
  slug: string; lines: CartLine[]; total: number; onClose: () => void; onSent: () => void
}) {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  // Optional trade offer. The backend has one 1000-character message field, so the
  // offer is sent as a "TRADE OFFER:" first paragraph (600 + 350 + label stays under it).
  const [trading, setTrading] = useState(false)
  const [tradeText, setTradeText] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (!name.trim() || !contact.trim()) { setError('Please enter your name and how to reach you.'); return }
    if (trading && !tradeText.trim()) { setError('Tell me what you would like to trade, or untick the trade box.'); return }
    if (lines.length === 0 && !trading && !message.trim()) { setError('Type your question first.'); return }
    if (!agreed) { setError('Please tick the box to confirm you read the rules.'); return }
    setState('sending')
    try {
      await sendShopRequest(slug, {
        buyerName: name, buyerContact: contact,
        message: trading ? `TRADE OFFER: ${tradeText.trim()}${message.trim() ? `\n\n${message.trim()}` : ''}` : message,
        items: lines.map(l => ({ cardId: l.card.id, name: l.card.name, number: l.card.number, condition: l.cond, qty: l.qty })),
      })
      setState('sent')
      onSent()
    } catch (e) {
      // The backend's friendly validation text comes back as the body of a 400.
      const msg = (e as { response?: { data?: unknown } }).response?.data
      setError(typeof msg === 'string' && msg ? msg : 'Could not send. Please try again, or message me on Facebook.')
      setState('idle')
    }
  }

  return (
    <div className="shop-modal" role="dialog" aria-modal="true" aria-label="Send request">
      <div className="shop-sheet">
        {state === 'sent' ? (
          <>
            <h2>Sent! ✅</h2>
            <p>Thanks {name.trim()}. I'll get back to you at <b>{contact.trim()}</b> to confirm availability and the price on that day.</p>
            <button type="button" className="shop-btn" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <h2>{lines.length > 0 ? 'Send request' : 'Ask a question'}</h2>
            {lines.length > 0 && (
              <ul className="shop-summary">
                {lines.map(l => (
                  <li key={lineKey(l.card.id, l.cond)}>{l.qty}× {l.card.name} #{l.card.number} ({l.cond})</li>
                ))}
                <li><b>About {money(total)} at today's prices</b> — final price is the market price when I confirm.</li>
              </ul>
            )}
            <label>Your name<input type="text" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
            <label>How can I reach you? (Facebook name, phone, or email)
              <input type="text" value={contact} maxLength={200} onChange={e => setContact(e.target.value)} />
            </label>
            <label className="shop-agree">
              <input type="checkbox" checked={trading} onChange={e => setTrading(e.target.checked)} />
              I'd like to trade (instead of, or as well as, paying)
            </label>
            {trading && (
              <label>What would you trade? (card names, sets, conditions)
                <textarea rows={3} value={tradeText} maxLength={600} onChange={e => setTradeText(e.target.value)} />
              </label>
            )}
            <label>{lines.length > 0 || trading ? 'Notes (optional)' : 'Your question'}
              <textarea rows={trading ? 2 : 4} value={message} maxLength={trading ? 350 : 1000} onChange={e => setMessage(e.target.value)} />
            </label>
            <label className="shop-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              I understand prices follow the market and can change, and there are no percentage offers on buys or trades.
            </label>
            {error && <p className="shop-error" role="alert">{error}</p>}
            <div className="shop-sheet-btns">
              <button type="button" className="shop-btn" disabled={state === 'sending'} onClick={submit}>
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
              <button type="button" className="shop-btn shop-btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
