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

import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useUser } from '../context/UserContext'
import { getSets } from '../api/cards'
import { getShop, getShopSettings, sendShopRequest } from '../api/shop'
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
  const { data: shop, isLoading, isError } = useQuery({
    queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false,
  })
  const messengerUrl = shop?.messengerUrl ?? ''
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])
  const preview = usePreview()

  // Is the viewer the shop's owner? Only a signed-in user's own settings can say so
  // (the public response deliberately carries no owner identity).
  const { user } = useUser()
  const { data: mine } = useQuery({
    queryKey: ['shop-settings', user?.id], queryFn: () => getShopSettings(user!.id), enabled: !!user && !user.isAnonymous,
  })
  const isOwner = !!mine && mine.slug === slug.toLowerCase()

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

  return (
    <div className="page-tracker share-page page-shop">
      <header className="share-hero">
        <Link to="/" className="share-brand">CardStacks</Link>
        <h1>Pokémon cards for sale</h1>
        <p className="share-meta">Browse, pick what you want, and send me a request. Or message me on Facebook.</p>
        {messengerUrl && <a className="shop-btn" href={messengerUrl} target="_blank" rel="noreferrer">💬 Message me on Facebook</a>}
        {isOwner && <p className="share-owner-note">This is how buyers see your shop. <Link to="/shop/requests">Edit shop &amp; see requests</Link></p>}
      </header>

      <section className="shop-policy" aria-label="Pricing and deal rules">
        <b>Please read before you ask:</b>
        <ul>
          <li><b>Prices follow the market.</b> Every price here is today's market price and changes as the market changes. The price when I confirm your order is the price you pay.</li>
          <li><b>No percentage offers.</b> No "X% of TCGplayer" or "% off" offers. The price shown is the price.</li>
          <li><b>No trades.</b> Sales only.</li>
        </ul>
      </section>

      <main className="trade-main">
        {preview.overlay}
        {isLoading && <p className="shop-msg">Loading cards…</p>}
        {isError && <p className="shop-msg">This shop isn't open right now. Check the link, or try again later.</p>}

        {!isLoading && !isError && (
          <CardBrowser
            items={items}
            fields={fields}
            itemKey={i => lineKey(i.card.id, i.cond)}
            empty={<p className="muted">No cards for sale right now.</p>}
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

      <footer className="shop-footer">
        This shop runs on <Link to="/">CardStacks</Link> — a free tracker for your Pokémon collection. <Link to="/">Start your own</Link>
      </footer>

      <div className="shop-bar">
        <span>{cartCount > 0 ? `${cartCount} card${cartCount === 1 ? '' : 's'} · about ${money(cartTotal)} at today's prices` : 'Pick cards with + Add, or just ask a question'}</span>
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
  const [agreed, setAgreed] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

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
            <label>{lines.length > 0 ? 'Notes (optional)' : 'Your question'}
              <textarea rows={4} value={message} maxLength={1000} onChange={e => setMessage(e.target.value)} />
            </label>
            <label className="shop-agree">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              I understand prices follow the market and can change, and there are no percentage offers and no trades.
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
