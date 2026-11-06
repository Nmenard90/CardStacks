/**
 * ShopPage — the public "cards for sale" page that the Facebook post links to.
 *
 * HOW IT WORKS
 *   Anyone can browse; sending needs a free account. Laid out like the collection page (top bar with search, stats
 *   row, sort toolbar, grid of wide card tiles) so it looks like the rest of CardStacks. Each tile is a ShopCardTile:
 *   the same tile as the collection's but for buyers, with condition badges to pick a copy, −/+ to add it to the
 *   request, and "📷 Ask for photos" of that copy. Buyers then send a request (picked cards, Buy or Trade, a message)
 *   or just ask a question with nothing picked. A signed-out buyer who taps Send or Ask gets the sign-in screen; their
 *   picked cards and what they were doing are kept (lib/shopPending) and carried on afterwards. Requests land in the
 *   seller's inbox (ShopRequestsPage), and the two talk in the request's chat (the buyer's side is
 *   ShopRequestStatusPage; all their requests are in My Shop → Sent). No contact details are asked for.
 *   Whose shop it is comes from the URL: /shop/:slug; the chosen set is ?set=<id>,
 *   so a link to one set can be shared and Back returns to the previous set.
 *   The seller's shop name and bio (Shop settings) head the page.
 *   The page is the same for the seller as for buyers, minus the Send bar: photos are taken on the seller's side
 *   (My Shop, Explore) and then show on the tile here.
 *   Prices are the card's LIVE market price every time the page loads —
 *   nothing is snapshotted — and the policy banner says so, along with
 *   "no percentage offers on buys or trades" (trades themselves are welcome).
 *
 * USED BY: App.tsx (route "/shop/:slug")
 * DEPENDS ON: api/shop, api/cards, components/ShopCardTile, SortControl, CardPreview, lib/cardSort, lib/conditions
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUser } from '../context/UserContext'
import { getSets } from '../api/cards'
import { askForPhotos, getSentRequests, getShop, getShopSettings, sendShopOrder, shopPhotoUrl, type PhotoSide } from '../api/shop'
import { condPrice } from '../lib/conditions'
import { compareBy, DEFAULT_DIR, type SortDir, type SortKey } from '../lib/cardSort'
import { usePagedList } from '../lib/usePagedList'
import { ShopCardTile } from '../components/ShopCardTile'
import { TradeCardPicker, type TradeLine } from '../components/TradeCardPicker'
import { SortControl } from '../components/SortControl'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { useToast } from '../components/Toast'
import { dropPending, savePending, takePending, type PendingShopAction } from '../lib/shopPending'
import type { Card, OwnedCard } from '../types'

/** One picked card + condition. */
interface CartLine { card: Card; cond: string; qty: number; max: number }

const SHOP_SORTS: SortKey[] = ['value', 'name', 'set', 'number', 'rarity', 'artist', 'qty', 'recent']
const money = (n: number) => '$' + n.toFixed(2)
const lineKey = (cardId: string, cond: string) => `${cardId}|${cond}`
/** What the owner is told when they try a buyer's button on their own shop. */
const OWN_SHOP = "This is your own shop, so it can't send to you. Buyers' requests and photo asks show up in My Shop."

export function ShopPage() {
  // The link name from the URL (/shop/:slug) picks whose shop this is.
  const { slug = '' } = useParams()
  const { data: shop, isLoading, isError } = useQuery({
    queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false,
  })
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
  // Sending and asking for photos need a real account (a demo account has no email for replies).
  const buyerId = user && !user.isAnonymous ? user.id : ''
  const qc = useQueryClient()
  const toast = useToast()
  const location = useLocation()
  // This buyer's requests to this shop: the "Your requests" link, and which cards they already asked photos of.
  const { data: sentAll = [] } = useQuery({
    queryKey: ['shop-sent', buyerId], queryFn: () => getSentRequests(buyerId), enabled: !!buyerId && !isOwner,
  })
  const sentHere = sentAll.filter(r => r.shopSlug === slug.toLowerCase())
  const askedPhotos = new Set(sentHere.flatMap(r => r.items.filter(i => i.photos).map(i => `${i.cardId}|${i.condition}`)))
  // Signed out and tried to send or ask: the sign-in screen shows instead of the shop until they sign in or go back.
  const [signingIn, setSigningIn] = useState<PendingShopAction['then'] | null>(null)

  const [search, setSearch] = useState('')
  const [params, setParams] = useSearchParams()
  const setFilter = params.get('set') ?? ''
  const setSetFilter = (id: string) => setParams(p => {
    const next = new URLSearchParams(p)
    if (id) next.set('set', id); else next.delete('set')
    return next
  })
  const [sort, setSort] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR.value)
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [formOpen, setFormOpen] = useState(false)

  // The seller's photos: address of each picture by card + condition + side.
  const photoMap = useMemo(
    () => new Map((shop?.photos ?? []).map(p => [`${p.cardId}|${p.condition}|${p.side}`, shopPhotoUrl(slug, p)])),
    [shop, slug])
  const photoAt = (cardId: string, cond: string, side: PhotoSide) => photoMap.get(`${cardId}|${cond}|${side}`)

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

  /** Signed out: remember the picked cards and what they were doing, then show the sign-in screen. */
  const needSignIn = (then: PendingShopAction['then']) => {
    savePending(slug, { cart: lines.map(l => ({ cardId: l.card.id, cond: l.cond, qty: l.qty })), then }, location.pathname + location.search)
    setSigningIn(then)
    window.scrollTo(0, 0)
  }

  /** "📷 Ask for photos" on a tile (signed in): the seller is emailed and adds them to that card. */
  const askPhotos = async (card: Card, cond: string) => {
    if (!buyerId) { needSignIn({ photo: { cardId: card.id, cond } }); return }
    try {
      await askForPhotos(buyerId, slug, { cardId: card.id, name: card.name, number: card.number, condition: cond })
      void qc.invalidateQueries({ queryKey: ['shop-sent', buyerId] })
      toast('Photos asked for. They\'ll show on this card.')
    } catch (e) {
      const msg = (e as { response?: { data?: unknown } }).response?.data
      toast(typeof msg === 'string' && msg ? msg : 'Could not ask for photos. Please try again.')
    }
  }

  // Back from signing in: put the picked cards back and carry on with what they were doing.
  // The saved action lives in sessionStorage (outside React), so it is read here and applied in a callback.
  useEffect(() => {
    if (!buyerId || owned.length === 0) return
    const pending = takePending(slug)
    if (!pending) return
    queueMicrotask(() => {
      setSigningIn(null)
      const restored: Record<string, CartLine> = {}
      for (const p of pending.cart) {
        const o = owned.find(x => x.cardId === p.cardId)
        const max = o?.conditions.find(c => c.condition === p.cond)?.quantity ?? 0
        if (o && max > 0) restored[lineKey(o.card.id, p.cond)] = { card: o.card, cond: p.cond, qty: Math.min(p.qty, max), max }
      }
      setCart(restored)
      if (pending.then === 'send') setFormOpen(true)
      else {
        const photo = pending.then.photo
        const o = owned.find(x => x.cardId === photo.cardId)
        if (o) void askPhotos(o.card, photo.cond)
      }
    })
    // Runs once per sign-in, when both the account and the shop's cards are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerId, owned.length, slug])

  if (signingIn && !buyerId) {
    return (
      <div className="page-tracker">
        <div className="shop-signin-note">
          <p><b>{signingIn === 'send' ? 'Sign in to send your request.' : 'Sign in to ask for photos.'}</b> It's free. Your picked cards are saved, and the seller replies in a chat here on CardStacks (you also get an email).</p>
          <button type="button" className="shop-btn shop-btn-ghost" onClick={() => { dropPending(slug); setSigningIn(null) }}>← Back to the shop</button>
        </div>
        <LoginScreen />
      </div>
    )
  }

  return (
    <div className="page-tracker shop-wrap">
      <div id="app" style={{ display: 'block' }}>
        <header>
          {/* The shop name when the seller set one ("Ash's Binder"), otherwise "<SLUG>'S SHOP". */}
          <div className="logo">{shop?.displayName ? shop.displayName.toUpperCase() : <>{slug.toUpperCase()}'S <span>SHOP</span></>}</div>
          <Link to="/" className="user-badge" title="Powered by CardStacks">🃏 <b>CardStacks</b></Link>
          <input type="text" className="header-search" placeholder="Search name, artist, set…"
            value={search} onChange={e => setSearch(e.target.value)} />
          {sentHere.length > 0 && <Link className="user-badge" to={sentHere.length === 1 ? `/shop/${slug}/request/${sentHere[0].id}` : '/shop/requests?tab=sent'}>🧾 <b>Your request{sentHere.length > 1 ? 's' : ''}</b></Link>}
        </header>

        {isOwner && <p className="share-owner-note" style={{ padding: '8px 16px' }}>This is how buyers see your shop. To add photos of any card you own, use 📷 Photos on the card in <Link to="/explore">Explore</Link>. Requests and settings are in <Link to="/shop/requests">My Shop</Link>.</p>}

        <section className="shop-hero">
          <h1>{shop?.displayName || `${slug}'s Pokémon cards`}</h1>
          {shop?.bio && <p className="shop-bio">{shop.bio}</p>}
          {isOwner && !shop?.bio && <p><Link to="/shop/requests">Introduce yourself — add a shop name and bio →</Link></p>}
          <p>{owned.length > 0 ? `${owned.length} cards available` : 'Cards available'} — buy, trade, or both.</p>
          <ol className="shop-steps">
            <li><b>1</b> Pick the cards you want</li>
            <li><b>2</b> Send a request — buy, trade, or both</li>
            <li><b>3</b> We chat right here: I confirm today's price and we sort out payment and shipping</li>
          </ol>
        </section>

        <section className="shop-policy" aria-label="Pricing and deal rules">
          <b>Please read before you ask:</b>
          <ul>
            <li><b>Prices follow the market.</b> Every price here is today's market price and changes as the market changes. The price when I confirm your order is the price you pay.</li>
            <li><b>No percentage offers, buying or trading.</b> No "X% of TCGplayer" or "% off" deals. Cards are valued at today's market price, both ways.</li>
            <li><b>Trades welcome.</b> Tap "Send request", choose Trade, and search for the cards you'd offer. I'll value both sides at today's market price. Trades are never exactly even, so add a little extra (cards or cash) if you need to — but not less than the cards you pick.</li>
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
                    photos={cond => ({ front: photoAt(o.card.id, cond, 'front'), back: photoAt(o.card.id, cond, 'back') })}
                    askPhotos={{
                      asked: cond => !isOwner && askedPhotos.has(`${o.card.id}|${cond}`),
                      onAsk: cond => (isOwner ? toast(OWN_SHOP) : void askPhotos(o.card, cond)),
                    }}
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
        {/* The same bar for the owner as for buyers (they see their shop exactly as buyers do); it just can't send to itself. */}
        <span>{cartCount > 0 ? `${cartCount} card${cartCount === 1 ? '' : 's'} · about ${money(cartTotal)} at today's prices` : 'Pick cards with +, or just ask a question'}</span>
        <button type="button" className="shop-btn" onClick={() => (isOwner ? toast(OWN_SHOP) : buyerId ? setFormOpen(true) : needSignIn('send'))}>
          {cartCount > 0 ? 'Send request' : 'Ask a question'}
        </button>
      </div>

      {formOpen && buyerId && <RequestForm slug={slug} userId={buyerId} username={user?.username ?? ''} lines={lines} total={cartTotal}
        onClose={() => setFormOpen(false)}
        onSent={() => { setCart({}); void qc.invalidateQueries({ queryKey: ['shop-sent', buyerId] }) }} />}
    </div>
  )
}

/**
 * The request / question form, shown over the page, for a signed-in buyer. One column, top to bottom: the cards
 * picked, how they'd like to pay (Buy or Trade, one choice), the trade picker when trading, one message box, the one
 * rules checkbox, then Send. Every control uses the shared sheet styles (styles/shop.css) so they all match. Who the
 * buyer is comes from their account; the seller replies in the request's chat.
 */
function RequestForm({ slug, userId, username, lines, total, onClose, onSent }: {
  slug: string; userId: string; username: string; lines: CartLine[]; total: number; onClose: () => void; onSent: () => void
}) {
  const [sentId, setSentId] = useState('')
  const [message, setMessage] = useState('')
  // Buy or trade. A trade offer is sent as a "TRADE OFFER" list at the top of the message (1000 characters max),
  // which the seller's inbox shows with its line breaks.
  const [trading, setTrading] = useState(false)
  const [tradeLines, setTradeLines] = useState<TradeLine[]>([])
  // A trade is never exactly even, so the buyer may add cash to cover the gap. The offer
  // (trade cards + cash) must be at least what they picked — a little over is fine, under is not.
  const [cash, setCash] = useState('')
  const cashAmount = Math.max(0, Number.parseFloat(cash) || 0)
  const tradeValue = tradeLines.reduce((n, l) => n + l.qty * condPrice(l.card, l.cond), 0)
  const offered = tradeValue + cashAmount
  // A card with no market price can't be compared; the seller values those when replying.
  const unpriced = lines.some(l => condPrice(l.card, l.cond) === 0) || tradeLines.some(l => condPrice(l.card, l.cond) === 0)
  const shortBy = trading && !unpriced ? Math.round((total - offered) * 100) / 100 : 0
  const tradeMessage = () =>
    `TRADE OFFER (cards about ${money(tradeValue)}${cashAmount > 0 ? ` + ${money(cashAmount)} cash` : ''} for cards about ${money(total)}, at today's prices):\n` +
    tradeLines.map(l => `- ${l.qty}× ${l.card.name} #${l.card.number} (${l.cond})`).join('\n') +
    (cashAmount > 0 ? `\n- plus ${money(cashAmount)} cash` : '') +
    (message.trim() ? `\n\n${message.trim()}` : '')
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (trading && tradeLines.length === 0) { setError('Search for the cards you would like to trade and tap Add, or choose Buy.'); return }
    if (shortBy > 0.005) { setError(`Your offer is ${money(shortBy)} short of the cards you picked. Add more cards or some cash to cover it.`); return }
    if (lines.length === 0 && !message.trim()) { setError('Type your question first.'); return }
    if (trading && tradeMessage().length > 1000) { setError('That trade list plus your message is too long to send. Remove a card or shorten your message.'); return }
    if (!agreed) { setError('Please tick the box to confirm you read the rules.'); return }
    setState('sending')
    try {
      const { id } = await sendShopOrder(userId, slug, {
        message: trading ? tradeMessage() : message.trim(),
        items: lines.map(l => ({ cardId: l.card.id, name: l.card.name, number: l.card.number, condition: l.cond, qty: l.qty })),
      })
      setSentId(id)
      setState('sent')
      onSent()
    } catch (e) {
      // The backend's friendly validation text comes back as the body of a 400.
      const msg = (e as { response?: { data?: unknown } }).response?.data
      setError(typeof msg === 'string' && msg ? msg : 'Could not send. Please try again.')
      setState('idle')
    }
  }

  // Fixed when the form opens: sending empties the picked cards, and the "Sent!" screen is still this request's.
  const [title] = useState(lines.length > 0 ? 'Send request' : 'Ask a question')
  return (
    <div className="shop-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="shop-sheet">
        {state === 'sent' ? (
          <>
            <h2>Sent! ✅</h2>
            <p>The seller gets an email and replies in the chat on your request. You'll get an email when they write.</p>
            <div className="shop-sheet-btns">
              <Link className="shop-btn" to={`/shop/${slug}/request/${sentId}`}>Open your request</Link>
              <button type="button" className="shop-btn shop-btn-ghost" onClick={onClose}>Keep browsing</button>
            </div>
          </>
        ) : (
          <>
            <h2>{title}</h2>
            <p className="shop-sub">Signed in as <b>{username}</b>. The seller replies in a chat on your request.</p>
            {lines.length > 0 && (
              <ul className="shop-summary">
                {lines.map(l => <li key={lineKey(l.card.id, l.cond)}>{l.qty}× {l.card.name} #{l.card.number} ({l.cond})</li>)}
                <li><b>About {money(total)} at today's prices</b> — final price is the market price when I confirm.</li>
              </ul>
            )}
            {lines.length > 0 && (
              <fieldset className="shop-choice">
                <legend>How do you want to pay?</legend>
                <div className="shop-choice-options">
                  {([['buy', '💵', 'Buy'], ['trade', '🔁', 'Trade (add cash if needed)']] as const).map(([id, icon, label]) => {
                    const on = (id === 'trade') === trading
                    return (
                      <label key={id} className={'shop-choice-option' + (on ? ' on' : '')}>
                        <input type="radio" name="pay" value={id} checked={on} onChange={() => { setTrading(id === 'trade'); setError('') }} />
                        <span aria-hidden="true">{icon}</span> {label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}
            {trading && <TradeCardPicker lines={tradeLines} onChange={setTradeLines} />}
            {trading && (
              <div className={'trade-balance' + (shortBy > 0.005 ? ' short' : '')} role="status">
                <label>Add cash to even it out (optional)
                  <input type="number" inputMode="decimal" min={0} step="0.01" value={cash} placeholder="0.00" onChange={e => setCash(e.target.value)} />
                </label>
                {unpriced ? <p>Some of these cards have no market price yet, so I'll value them when I reply.</p>
                  : (
                    <p>
                      You want <b>{money(total)}</b> · you offer <b>{money(offered)}</b>
                      {cashAmount > 0 ? ` (cards ${money(tradeValue)} + cash ${money(cashAmount)})` : ''}.{' '}
                      {shortBy > 0.005
                        ? <b>Add {money(shortBy)} more in cards or cash. A little over is welcome, but not under.</b>
                        : offered - total > 0.005 ? `That's ${money(offered - total)} extra — thank you!` : 'That covers it.'}
                    </p>
                  )}
              </div>
            )}
            <label>{lines.length > 0 ? 'Message to the seller (optional)' : 'Your question'}
              <textarea rows={3} value={message} maxLength={trading ? 250 : 1000} onChange={e => { setMessage(e.target.value); setError('') }} />
            </label>
            <label className="shop-agree">
              <input type="checkbox" checked={agreed} onChange={e => { setAgreed(e.target.checked); setError('') }} />
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
