/**
 * ShopPage — the public "cards for sale" page that the Facebook post links to.
 *
 * HOW IT WORKS
 *   No login. Buyers browse and search the seller's cards, tap + on the
 *   conditions they want, then either send a request (the picked cards plus
 *   their name/contact) or just ask a question with nothing picked. Requests
 *   land in the seller's inbox (ShopRequestsPage). A Messenger button shows
 *   only when the seller saved a Messenger link in their shop settings.
 *   Whose shop it is comes from the URL: /shop/:slug.
 *   Prices are the card's LIVE market price every time the page loads —
 *   nothing is snapshotted — and the policy banner says so, along with
 *   "no percentage offers, no trades".
 *
 * USED BY: App.tsx (route "/shop/:slug")
 * DEPENDS ON: api/shop, api/cards, lib/conditions
 */

import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSets } from '../api/cards'
import { getShop, sendShopRequest } from '../api/shop'
import { condPrice } from '../lib/conditions'
import type { Card } from '../types'

const PAGE_SIZE = 40

/** One picked card + condition. */
interface CartLine { card: Card; cond: string; qty: number; max: number }
type SortMode = 'set' | 'name' | 'priceHigh' | 'priceLow'

const money = (n: number) => '$' + n.toFixed(2)
const lineKey = (cardId: string, cond: string) => `${cardId}|${cond}`

export function ShopPage() {
  // The link name from the URL (/shop/:slug) picks whose shop this is.
  const { slug = '' } = useParams()
  const { data: shop, isLoading, isError } = useQuery({
    queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false,
  })
  const owned = useMemo(() => shop?.cards ?? [], [shop])
  const messengerUrl = shop?.messengerUrl ?? ''
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })

  const [search, setSearch] = useState('')
  const [setId, setSetId] = useState('')
  const [sort, setSort] = useState<SortMode>('set')
  const [shown, setShown] = useState(PAGE_SIZE)
  const [cart, setCart] = useState<Record<string, CartLine>>({})
  const [formOpen, setFormOpen] = useState(false)

  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  // Only sets the seller actually has cards from, for the filter dropdown.
  const ownedSets = useMemo(() => {
    const ids = [...new Set(owned.map(o => o.card.setId))]
    return ids.sort((a, b) => (setName.get(a) ?? a).localeCompare(setName.get(b) ?? b))
  }, [owned, setName])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = owned.filter(o => {
      if (setId && o.card.setId !== setId) return false
      if (!q) return true
      return o.card.name.toLowerCase().includes(q) || o.card.number.toLowerCase().includes(q) ||
        (setName.get(o.card.setId) ?? '').toLowerCase().includes(q)
    })
    const best = (o: typeof owned[number]) => Math.max(0, ...o.conditions.map(c => condPrice(o.card, c.condition)))
    list.sort((a, b) => {
      if (sort === 'name') return a.card.name.localeCompare(b.card.name)
      if (sort === 'priceHigh') return best(b) - best(a)
      if (sort === 'priceLow') return best(a) - best(b)
      return (setName.get(a.card.setId) ?? a.card.setId).localeCompare(setName.get(b.card.setId) ?? b.card.setId) ||
        a.card.number.localeCompare(b.card.number, undefined, { numeric: true })
    })
    return list
  }, [owned, search, setId, sort, setName])

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
    <div className="page-shop">
      <header className="shop-top">
        <h1>Pokémon cards for sale</h1>
        <p>Browse, pick what you want, and send me a request. Or message me on Facebook.</p>
        {messengerUrl && <a className="shop-btn" href={messengerUrl} target="_blank" rel="noreferrer">💬 Message me on Facebook</a>}
      </header>

      <section className="shop-policy" aria-label="Pricing and deal rules">
        <b>Please read before you ask:</b>
        <ul>
          <li><b>Prices follow the market.</b> Every price here is today's market price and changes as the market changes. The price when I confirm your order is the price you pay.</li>
          <li><b>No percentage offers.</b> No "X% of TCGplayer" or "% off" offers. The price shown is the price.</li>
          <li><b>No trades.</b> Sales only.</li>
        </ul>
      </section>

      <div className="shop-tools">
        <input type="search" placeholder="Search name, number, or set…" value={search}
          onChange={e => { setSearch(e.target.value); setShown(PAGE_SIZE) }} />
        <select value={setId} onChange={e => { setSetId(e.target.value); setShown(PAGE_SIZE) }} aria-label="Filter by set">
          <option value="">All sets</option>
          {ownedSets.map(id => <option key={id} value={id}>{setName.get(id) ?? id}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortMode)} aria-label="Sort">
          <option value="set">Sort: set & number</option>
          <option value="name">Sort: name</option>
          <option value="priceHigh">Sort: price high → low</option>
          <option value="priceLow">Sort: price low → high</option>
        </select>
      </div>

      {isLoading && <p className="shop-msg">Loading cards…</p>}
      {isError && <p className="shop-msg">This shop isn't open right now. Check the link, or try again later.</p>}
      {!isLoading && !isError && rows.length === 0 && <p className="shop-msg">No cards match that search.</p>}

      <ul className="shop-list">
        {rows.slice(0, shown).map(o => (
          <li key={o.cardId} className="shop-card">
            {o.card.images?.small
              ? <img src={o.card.images.small} alt={o.card.name} loading="lazy" />
              : <div className="shop-noimg">🃏</div>}
            <div className="shop-card-body">
              <b>{o.card.name}</b>
              <span className="shop-sub">{setName.get(o.card.setId) ?? o.card.setId} · #{o.card.number}{o.card.rarity ? ` · ${o.card.rarity}` : ''}</span>
              {o.conditions.filter(c => c.quantity > 0).map(c => {
                const price = condPrice(o.card, c.condition)
                const inCart = cart[lineKey(o.card.id, c.condition)]?.qty ?? 0
                return (
                  <div key={c.condition} className="shop-cond">
                    <span className="shop-cond-name">{c.condition}</span>
                    <span className="shop-cond-price">{price > 0 ? money(price) : 'Ask'}</span>
                    <span className="shop-cond-avail">{c.quantity} avail.</span>
                    <span className="shop-stepper">
                      <button type="button" aria-label="Remove one" disabled={inCart === 0}
                        onClick={() => adjust(o.card, c.condition, c.quantity, -1)}>−</button>
                      <b>{inCart}</b>
                      <button type="button" aria-label="Add one" disabled={inCart >= c.quantity}
                        onClick={() => adjust(o.card, c.condition, c.quantity, 1)}>+</button>
                    </span>
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ul>

      {rows.length > shown && (
        <button type="button" className="shop-btn shop-more" onClick={() => setShown(s => s + PAGE_SIZE)}>
          Show more ({rows.length - shown} left)
        </button>
      )}

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
