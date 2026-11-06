/**
 * ShopRequestStatusPage — a buyer's own request on someone's shop: /shop/:slug/request/:id.
 *
 * HOW IT WORKS
 *   Signed in: only the buyer who sent it can open it (the backend checks it is theirs). Shows whether the seller
 *   has replied, the cards (with the condition the seller confirmed with the copy in hand, and the buyer's pick when
 *   that differs), the seller's front/back photos of each card, the buyer's note, and the chat with the seller.
 *   Checks for new messages and photos every 10s while open; opening it marks the seller's messages read.
 *   Card pictures come from the shop's list (a card already sold is shown by name). All of the buyer's requests are
 *   listed in My Shop → Sent.
 *
 * USED BY: App.tsx (route "/shop/:slug/request/:id"), linked from ShopPage after sending and from My Shop → Sent
 * DEPENDS ON: api/shop (getSentRequest, postBuyerMessage, getShop, shopPhotoUrl), components/MessageThread,
 *   components/CardThumb, components/CardPreview, components/LoginScreen
 */

import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSentRequest, getShop, postBuyerMessage, shopPhotoUrl, type BuyerRequestItem, type BuyerRequestView, type ShopRequestStatus } from '../api/shop'
import { CardThumb } from '../components/CardThumb'
import { usePreview } from '../components/CardPreview'
import { LoginScreen } from '../components/LoginScreen'
import { MessageThread } from '../components/MessageThread'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { condLabel } from '../lib/conditions'
import type { Card } from '../types'

const STATUS: Record<ShopRequestStatus, { label: string; note: string }> = {
  new: { label: 'Sent', note: "The seller hasn't replied yet. You'll get an email when they write here." },
  answered: { label: 'Replied', note: 'The seller has replied. Their messages are below.' },
  done: { label: 'Closed', note: 'This request is closed.' },
}

const SIDES = ['front', 'back'] as const

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function ShopRequestStatusPage() {
  const { slug = '', id = '' } = useParams()
  const { user } = useUser()
  const userId = user && !user.isAnonymous ? user.id : ''
  const preview = usePreview()
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['sent-request', userId, id]
  const { data: request, isLoading, isError } = useQuery({
    queryKey: key, queryFn: () => getSentRequest(userId, id), enabled: !!userId,
    retry: false, refetchInterval: 10_000, // replies and photos show up without a refresh
  })
  const { data: shop } = useQuery({ queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false })
  const cards = useMemo(() => new Map<string, Card>((shop?.cards ?? []).map(o => [o.cardId, o.card])), [shop])

  // Opening it marked the seller's messages read: refresh My Shop → Sent and the nav badge once that has landed.
  const loaded = !!request
  useEffect(() => { if (loaded) void qc.invalidateQueries({ queryKey: ['shop-sent', userId] }) }, [loaded, qc, userId])

  if (!userId) return <div className="page-tracker"><LoginScreen /></div>

  const photoOf = (item: BuyerRequestItem, side: (typeof SIDES)[number]) => {
    const ref = request?.photos.find(p => p.cardId === item.cardId && p.condition === item.condition && p.side === side)
    return ref ? shopPhotoUrl(slug, ref) : undefined
  }
  const shopName = request?.shopName || shop?.displayName || `${slug}'s shop`

  return (
    <div className="page-tracker shop-wrap">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">{shopName.toUpperCase()}</div>
          <Link to="/" className="user-badge" title="Powered by CardStacks">🃏 <b>CardStacks</b></Link>
          <Link to={`/shop/${slug}`} className="user-badge">🛍 <b>Back to the shop</b></Link>
          <Link to="/shop/requests?tab=sent" className="user-badge">🧾 <b>All your requests</b></Link>
        </header>

        <main className="buyer-req">
          <h1 className="buyer-req__title">{request?.kind === 'photos' ? 'Your photo request' : 'Your request'}</h1>
          {isLoading && <p className="shop-msg">Loading…</p>}
          {isError && <p className="shop-msg">This request can't be found. It may have been sent from another account; your requests are in <Link to="/shop/requests?tab=sent">My Shop → Sent</Link>.</p>}
          {request && <>
            <p className="buyer-req__status">
              <span className={'shop-pill shop-pill-' + request.status}>{STATUS[request.status].label}</span>
              <span>{day(request.createdAt)}</span>
              <span className="shop-sub">{STATUS[request.status].note}</span>
            </p>
            {request.items.length === 0 && <p className="shop-msg">This was a question, with no cards picked.</p>}
            <ul className="buyer-req__cards">
              {request.items.map((item, n) => {
                const card = cards.get(item.cardId)
                const pics = SIDES.map(side => ({ side, url: photoOf(item, side) })).filter(p => p.url)
                return (
                  <li key={n} className="buyer-req__card">
                    {card ? <CardThumb card={card} showPrice={false} preview={preview} className="buyer-req__thumb" />
                      : <div className="thumb-placeholder buyer-req__thumb">🃏</div>}
                    <div className="buyer-req__body">
                      <div className="req-card__title"><b>{item.qty}× {item.name}</b> <span>#{item.number}</span></div>
                      <div className="req-card__meta">
                        {condLabel(item.condition)}
                        {item.askedCondition && item.askedCondition !== item.condition &&
                          <> · you picked {condLabel(item.askedCondition)}; the seller checked the card and it's {condLabel(item.condition)}</>}
                      </div>
                      {pics.length > 0 ? (
                        <div className="shop-photos">
                          {pics.map(p => (
                            <button key={p.side} type="button" className="photo-frame" title={`Zoom in: ${p.side} photo`} onClick={() => preview.show(p.url!, { pinned: true })}>
                              <img src={p.url} alt={`${p.side} photo of the ${item.name}`} loading="lazy" />
                              <span>{p.side === 'front' ? 'Front' : 'Back'}</span>
                            </button>
                          ))}
                        </div>
                      ) : item.photos ? (
                        <p className="buyer-req__waiting">📷 You asked for photos. They'll show up here and on the card in the shop once the seller takes them.</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            {request.message && <p className="shop-req-msg">{request.message}</p>}
            <MessageThread
              title={`Chat with ${shopName}`}
              empty="No messages yet. Ask the seller anything here; they get an email."
              otherName="the seller"
              messages={request.messages.map(m => ({ id: m.id, mine: !m.fromSeller, who: shopName, body: m.body, createdAt: m.createdAt }))}
              onSend={async body => {
                try {
                  const messages = await postBuyerMessage(userId, id, body)
                  qc.setQueryData<BuyerRequestView>(key, prev => (prev ? { ...prev, messages } : prev))
                  return true
                } catch {
                  toast("Couldn't send that. Please try again.")
                  return false
                }
              }}
            />
          </>}
        </main>
      </div>
      {preview.overlay}
    </div>
  )
}
