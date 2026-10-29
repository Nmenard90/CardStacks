/**
 * OfferInbox — card offers between two signed-in collectors (cash, cards, or
 * both), each with a message thread.
 *
 * HOW IT WORKS
 *   Offers were made on the old share-link trade page, which has been folded
 *   into the shop; this keeps every existing offer readable and answerable
 *   from My Shop → Offers. The list shows both sides (Received / Sent);
 *   opening one shows the deal, the actions this side may take (accept/
 *   decline, withdraw, mark complete/cancel) and its thread, which polls
 *   every 10s while open. No money moves through the app.
 *
 * USED BY: pages/ShopRequestsPage (Offers tab)
 * DEPENDS ON: api/trading, lib/conditions, components/Toast
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getOffer, postOfferMessage, setOfferStatus, tradingError } from '../api/trading'
import { condLabel } from '../lib/conditions'
import { useToast } from './Toast'
import type { CardOffer, CardOfferStatus, OfferCard } from '../types'

const money = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)

const STATUS_LABEL: Record<CardOfferStatus, string> = {
  Pending: 'Waiting for a reply', Accepted: 'Accepted — arrange it in the thread', Declined: 'Declined',
  Withdrawn: 'Withdrawn', Cancelled: 'Cancelled', Completed: 'Completed',
}

function offerHeadline(o: CardOffer): string {
  const wantCount = o.wants.reduce((n, c) => n + c.quantity, 0)
  const cards = `${wantCount} card${wantCount === 1 ? '' : 's'}`
  return o.role === 'seller' ? `${o.otherUser} wants ${cards} of yours` : `You offered on ${o.otherUser}'s ${cards}`
}

export function OfferInbox({ userId, offers, openId, setOpenId }: {
  userId: string; offers: CardOffer[]; openId: string; setOpenId: (id: string) => void
}) {
  if (offers.length === 0 && !openId) {
    return (
      <div className="trade-empty">
        <h2>No offers</h2>
        <p>Offers made through the old trade links show up here. New buy and trade requests arrive in Requests.</p>
      </div>
    )
  }
  return (
    <div className={`offers-layout ${openId ? 'has-open' : ''}`}>
      <ul className="offer-list">
        {offers.map(o => (
          <li key={o.id}>
            <button className={`offer-row ${o.id === openId ? 'active' : ''} ${o.unread ? 'unread' : ''}`} onClick={() => setOpenId(o.id)}>
              <span className={`offer-dir ${o.role}`}>{o.role === 'seller' ? 'Received' : 'Sent'}</span>
              <b>{offerHeadline(o)}</b>
              <small>
                {[o.cashAmount ? money(o.cashAmount) : '', o.gives.length ? `${o.gives.length} card${o.gives.length === 1 ? '' : 's'} in trade` : ''].filter(Boolean).join(' + ') || 'Message only'}
                {' · '}<span className={`status-${o.status.toLowerCase()}`}>{o.status}</span>
              </small>
            </button>
          </li>
        ))}
      </ul>
      {openId && <OfferDetail userId={userId} offerId={openId} close={() => setOpenId('')} />}
    </div>
  )
}

function CardLines({ title, cards }: { title: string; cards: OfferCard[] }) {
  if (cards.length === 0) return null
  const total = cards.reduce((s, c) => s + (c.marketPrice ?? 0) * c.quantity, 0)
  return (
    <section className="offer-side">
      <h4>{title} <small>market ≈ {money(total)}</small></h4>
      <div className="offer-cards">
        {cards.map(c => (
          <div className="offer-card" key={`${c.cardId}-${c.condition}`}>
            <img src={c.imageSmall} alt={c.name} loading="lazy" />
            <span><b>{c.quantity > 1 ? `${c.quantity}× ` : ''}{c.name}</b><small>{condLabel(c.condition)} · {money(c.marketPrice)}</small></span>
          </div>
        ))}
      </div>
    </section>
  )
}

function OfferDetail({ userId, offerId, close }: { userId: string; offerId: string; close: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: offer, error } = useQuery({
    queryKey: ['offer', offerId],
    queryFn: () => getOffer(userId, offerId),
    refetchInterval: 10_000,
  })

  // Fetching an offer marks it read server-side — refresh the list/badge
  // once that fetch has landed, not on mount (which races the mark-read).
  const loaded = !!offer
  useEffect(() => {
    if (!loaded) return
    void qc.invalidateQueries({ queryKey: ['offers'] })
    void qc.invalidateQueries({ queryKey: ['unread-offers'] })
  }, [offerId, loaded, qc])

  if (error) return <div className="offer-detail"><p>{tradingError(error, 'Could not load this offer.')}</p><button onClick={close}>Back</button></div>
  if (!offer) return <div className="offer-detail"><p>Loading…</p></div>

  const act = async (fn: () => Promise<CardOffer>, okMsg?: string) => {
    setBusy(true)
    try {
      qc.setQueryData(['offer', offerId], await fn())
      void qc.invalidateQueries({ queryKey: ['offers'] })
      if (okMsg) toast(okMsg)
      return true
    } catch (e) {
      toast(tradingError(e, 'That didn\'t work — try again.'))
      return false
    } finally {
      setBusy(false)
    }
  }
  const status = (s: CardOfferStatus, msg: string) => act(() => setOfferStatus(userId, offerId, s), msg)
  const send = async () => {
    const body = draft.trim()
    if (!body) return
    if (await act(() => postOfferMessage(userId, offerId, body))) setDraft('')
  }

  const isSeller = offer.role === 'seller'
  return (
    <div className="offer-detail">
      <button className="offer-back" onClick={close}>← All offers</button>
      <h3>{offerHeadline(offer)}</h3>
      <p className={`offer-status status-${offer.status.toLowerCase()}`}>{STATUS_LABEL[offer.status]}</p>

      <div className="offer-sides">
        <CardLines title={isSeller ? 'They want from you' : `You want from ${offer.otherUser}`} cards={offer.wants} />
        <section className="offer-side">
          <h4>{isSeller ? 'They offer' : 'You offer'}</h4>
          {offer.cashAmount ? <p className="offer-cash">💵 {money(offer.cashAmount)} cash</p> : null}
          <CardLines title="Cards in trade" cards={offer.gives} />
          {!offer.cashAmount && offer.gives.length === 0 && <p className="muted">Nothing yet — see the messages.</p>}
        </section>
      </div>

      <div className="offer-actions">
        {isSeller && offer.status === 'Pending' && <>
          <button className="primary" disabled={busy} onClick={() => void status('Accepted', 'Offer accepted — sort out payment & shipping in the thread.')}>Accept</button>
          <button disabled={busy} onClick={() => void status('Declined', 'Offer declined.')}>Decline</button>
        </>}
        {!isSeller && offer.status === 'Pending' && (
          <button disabled={busy} onClick={() => void status('Withdrawn', 'Offer withdrawn.')}>Withdraw offer</button>
        )}
        {offer.status === 'Accepted' && <>
          <button className="primary" disabled={busy} onClick={() => void status('Completed', 'Marked complete. Remember to update your collection.')}>Mark completed</button>
          <button disabled={busy} onClick={() => { if (confirm('Cancel this accepted deal?')) void status('Cancelled', 'Deal cancelled.') }}>Cancel deal</button>
        </>}
      </div>
      {offer.status === 'Accepted' && (
        <p className="offer-note">CardStacks doesn't handle payments. Agree below on how to pay (PayPal Goods &amp; Services protects both sides) and how to ship or meet up.</p>
      )}

      <section className="offer-thread">
        <h4>Messages</h4>
        {offer.messages.length === 0 && <p className="muted">No messages yet.</p>}
        {offer.messages.map(m => (
          <div key={m.id} className={`offer-msg ${m.senderId === userId ? 'mine' : ''}`}>
            <small>{m.senderId === userId ? 'You' : m.sender} · {new Date(m.createdAt).toLocaleString()}</small>
            <p>{m.body}</p>
          </div>
        ))}
        <div className="offer-compose">
          <textarea
            value={draft} maxLength={2000} rows={2}
            placeholder={`Message ${offer.otherUser}…`}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send() }}
          />
          <button className="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>Send</button>
        </div>
      </section>
    </div>
  )
}
