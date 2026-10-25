/**
 * ShopPage — the public "cards for sale" page that the Facebook post links to.
 *
 * HOW IT WORKS
 *   No login. Built from the same pieces as the share page (SharePage): a
 *   CardBrowser (search by Pokémon / artist / set / number, set filter, sort)
 *   full of OwnedCardTile tiles with hover-zoom, one tile per card + condition.
 *   Buyers tap "+ Add" on what they want, then either send a request (the
 *   picked cards plus their name/contact) or just ask a question with nothing
 *   picked. Requests land in the seller's inbox (ShopRequestsPage). A Messenger
 *   button shows only when the seller saved a Messenger link.
 *   Whose shop it is comes from the URL: /shop/:slug.
 *   Prices are the card's LIVE market price every time the page loads —
 *   nothing is snapshotted — and the policy banner says so, along with
 *   "no percentage offers, no trades".
 *
 * USED BY: App.tsx (route "/shop/:slug")
 * DEPENDS ON: api/shop, api/cards, components/CardBrowser, OwnedCardTile, CardPreview, lib/conditions
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSets } from '../api/cards'
import { getShop, getShopSettings, sendShopRequest } from '../api/shop'
import { useUser } from '../context/UserContext'
import { condLabel, condPrice } from '../lib/conditions'
import { CardBrowser, type BrowseFields } from '../components/CardBrowser'
import { OwnedCardTile } from '../components/OwnedCardTile'
import { usePreview } from '../components/CardPreview'
import type { Card } from '../types'

/** One picked card + condition. `card.prices.nm` is already this condition's price (see ShopItem). */
interface CartLine { card: Card; cond: string; qty: number; max: number }
/** One tile: a card in one condition, priced for that condition. */
interface ShopItem { card: Card; cond: string; qty: number; price: number }

const money = (n: number) => '$' + n.toFixed(2)
const lineKey = (cardId: string, cond: string) => `${cardId}|${cond}`

export function ShopPage() {
  // The link name from the URL (/shop/:slug) picks whose shop this is.
  const { slug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const selectedSet = params.get('set') ?? ''
  const selectSet = (id: string) => setParams(p => {
    const next = new URLSearchParams(p)
    if (id) next.set('set', id); else next.delete('set')
    return next
  })
  const { user } = useUser()
  const { data: settings } = useQuery({
    queryKey: ['shop-settings', user?.id], queryFn: () => getShopSettings(user!.id), enabled: !!user,
  })
  const isOwner = settings?.slug === slug
  const { data: shop, isLoading, isError, refetch } = useQuery({
    queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false,
  })
  const messengerUrl = shop?.messengerUrl ?? ''
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])
  const preview = usePreview()

  // One tile per card + condition. The tile's card carries just that
  // condition's price (as `nm`) so the thumbnail's price ribbon and the
  // zoomed preview show the right number for the copy being sold.
  const items: ShopItem[] = useMemo(() => (shop?.cards ?? []).flatMap(o =>
    o.conditions.filter(c => c.quantity > 0).map(c => {
      const price = condPrice(o.card, c.condition)
      return {
        card: { ...o.card, variants: undefined, prices: price > 0 ? { nm: price } : undefined },
        cond: c.condition, qty: c.quantity, price,
      }
    })), [shop])

  const fields = useCallback((i: ShopItem): BrowseFields => ({
    name: i.card.name, setId: i.card.setId, number: i.card.number, quantity: i.qty,
    rarity: i.card.rarity, artist: i.card.artist, value: i.price > 0 ? i.price : null,
  }), [])

  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [formOpen, setFormOpen] = useState(false)
  const closeForm = useCallback(() => setFormOpen(false), [])

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
  const cartTotal = lines.reduce((n, l) => n + l.qty * (l.card.prices?.nm ?? 0), 0)
  const hasUnpriced = lines.some(l => !(l.card.prices?.nm && l.card.prices.nm > 0))

  return (
    <div className="page-tracker share-page page-shop shop-storefront">
      <nav className="shop-brand-row" aria-label="Shop navigation">
        <Link className="shop-brand" to="/">CardStacks<span>collector shops</span></Link>
        {isOwner ? <Link className="shop-edit-link" to="/shop/requests">Edit shop profile →</Link> : <span className="shop-seller-handle">@{slug}</span>}
      </nav>
      <header className="shop-profile">
        <div className="shop-avatar" aria-hidden="true">{(shop?.displayName || slug).slice(0, 2).toUpperCase()}</div>
        <div className="shop-profile-copy">
          <p className="shop-eyebrow">Pokémon singles · from my collection</p>
          <h1>{shop?.displayName || `${slug}'s card shop`}</h1>
          <p className="shop-bio">{shop?.bio || 'Welcome! Browse my cards by set, find something you love, and send me your picks.'}</p>
          {isOwner && !shop?.bio && <Link className="shop-edit-link" to="/shop/requests">Introduce yourself — add a bio →</Link>}
          {!isLoading && !isError && <div className="shop-profile-meta">
            <span>{new Set(items.map(i => i.card.id)).size.toLocaleString()} different cards</span>
            <span>{new Set(items.map(i => i.card.setId)).size} sets to explore</span>
          </div>}
        </div>
        {!isLoading && !isError && <div className={`shop-profile-actions${messengerUrl ? ' has-messenger' : ''}`}>
          {messengerUrl ? <a className="shop-btn" href={messengerUrl} target="_blank" rel="noreferrer">Message on Facebook ↗</a>
            : <button type="button" className="shop-btn" onClick={() => setFormOpen(true)}>Ask me a question</button>}
          <a className="shop-browse-link" href="#shop-inventory">Explore the cards ↓</a>
        </div>}
      </header>

      <details className="shop-buying-details">
        <summary>How buying works <span>Choose cards · send a request · confirm together</span></summary>
        <p>Add the cards you like, then send your list and a way to reach you. I'll confirm availability and the total before we arrange a sale. No payment is taken on this site.</p>
        <ul>
          <li>Prices follow the latest available market data and can change before confirmation.</li>
          <li>Sales only. Listed prices apply; no percentage-based offers.</li>
        </ul>
      </details>

      <main className="trade-main" id="shop-inventory">
        {preview.overlay}
        <div className="shop-inventory-title"><h2>Explore the collection</h2><p>Browse a set, or search for a Pokémon, card number, or artist.</p></div>
        {isLoading && <p className="shop-msg" role="status">Opening the collection…</p>}
        {isError && <div className="shop-state" role="alert"><h3>This collection isn't available right now.</h3><p>Check the shop address or try loading it again.</p><button type="button" className="shop-btn" onClick={() => void refetch()}>Try again</button></div>}

        {!isLoading && !isError && (
          <CardBrowser
            items={items}
            groupBySet defaultSort="number" setFilterValue={selectedSet} onSetFilterChange={selectSet}
            fields={fields}
            itemKey={i => lineKey(i.card.id, i.cond)}
            empty={<div className="shop-state"><h3>The shelves are empty for now.</h3><p>Check back for more cards{messengerUrl ? ', or message me about what you’re looking for.' : '.'}</p>{isOwner && <Link to="/explore">Add cards to your collection →</Link>}</div>}
            renderTile={i => {
              const inCart = cart[lineKey(i.card.id, i.cond)]?.qty ?? 0
              return (
                <OwnedCardTile
                  card={i.card} preview={preview} qty={i.qty} selected={inCart > 0}
                  subtitle={<>
                    <span className="tile-line">{setName.get(i.card.setId) ?? i.card.setId} · #{i.card.number}{i.card.rarity ? ` · ${i.card.rarity}` : ''}</span>
                    <span className="tile-line">{condLabel(i.cond)} · {i.price > 0 ? money(i.price) : 'Ask for price'}</span>
                    {i.card.artist && <span className="tile-line">✏ {i.card.artist}</span>}
                    {inCart > 0 && <b className="tile-line trade-ask">{inCart} in your request</b>}
                  </>}
                  actions={[
                    { label: '−', disabled: inCart === 0, onClick: () => adjust(i.card, i.cond, i.qty, -1) },
                    { label: '+ Add', disabled: inCart >= i.qty, onClick: () => adjust(i.card, i.cond, i.qty, 1) },
                  ]}
                />
              )
            }}
          />
        )}
      </main>

      {!isLoading && !isError && <div className="shop-bar">
        <span aria-live="polite">{cartCount > 0 ? `${cartCount} card${cartCount === 1 ? '' : 's'} picked · ${hasUnpriced ? 'some prices to confirm' : `estimated ${money(cartTotal)}`}` : 'Find your favorites. Add them to a request.'}<small>No payment taken here · availability confirmed with you</small></span>
        <button type="button" className="shop-btn" onClick={() => setFormOpen(true)}>
          {cartCount > 0 ? 'Review request →' : 'Ask a question'}
        </button>
      </div>}

      <footer className="shop-footer">A collector's collection, shared with you. <Link to="/">Powered by CardStacks</Link></footer>
      {formOpen && <RequestForm slug={slug} lines={lines} total={cartTotal} onClose={closeForm}
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
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = sheet.current
    panel?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state !== 'sending') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab' || !panel) return
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href]'))
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose, state])

  const submit = async () => {
    setError('')
    if (!name.trim() || !contact.trim()) { setError('Please enter your name and how to reach you.'); return }
    if (lines.length === 0 && !message.trim()) { setError('Type your question first.'); return }
    if (!agreed) { setError('Please tick the box to confirm you read the rules.'); return }
    setState('sending')
    try {
      await sendShopRequest(slug, {
        buyerName: name, buyerContact: contact, message,
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
      <div className="shop-sheet" ref={sheet}>
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
                <li><b>Estimated priced-card total: {money(total)}</b>{lines.some(l => !l.card.prices?.nm) ? ' — some cards still need a price.' : ''} Final prices and availability are confirmed with the seller.</li>
              </ul>
            )}
            <label>Your name<input type="text" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
            <label>How can I reach you? (Facebook name, phone, or email)
              <input type="text" value={contact} maxLength={200} onChange={e => setContact(e.target.value)} />
            </label>
            <label>{lines.length > 0 ? 'Notes (optional)' : 'Your question'}
              <textarea rows={4} value={message} maxLength={1000} onChange={e => setMessage(e.target.value)} />
            </label>
            <label className="shop-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              I understand the final price and availability are confirmed with the seller. Sales only; no percentage-based offers.
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
