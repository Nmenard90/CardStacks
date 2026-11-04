/**
 * ShopRequestStatusPage — a buyer's own request on someone's shop: /shop/:slug/request/:id.
 *
 * HOW IT WORKS
 *   No login: the request's id (a random UUID the buyer got when sending it) is the key, so only the buyer's link
 *   opens it. Shows whether the seller has replied, the cards asked for (with the condition the seller confirmed
 *   with the copy in hand, and the buyer's pick when that differs), and the seller's front/back photos of each card.
 *   A card the buyer asked photos of but that has none yet says so; the page re-checks every minute while open.
 *   Card pictures come from the shop's list (a card already sold is shown by name). Other requests this browser
 *   sent to the same shop are linked underneath (lib/myShopRequests).
 *
 * USED BY: App.tsx (route "/shop/:slug/request/:id"), linked from ShopPage after sending and from its header
 * DEPENDS ON: api/shop (getBuyerRequest, getShop, shopPhotoUrl), components/CardThumb, components/CardPreview
 */

import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getBuyerRequest, getShop, shopPhotoUrl, type BuyerRequestItem, type ShopRequestStatus } from '../api/shop'
import { CardThumb } from '../components/CardThumb'
import { usePreview } from '../components/CardPreview'
import { condLabel } from '../lib/conditions'
import { myShopRequests, rememberShopRequest } from '../lib/myShopRequests'
import type { Card } from '../types'

const STATUS: Record<ShopRequestStatus, { label: string; note: string }> = {
  new: { label: 'Sent', note: "The seller hasn't replied yet. They'll message you on Facebook." },
  answered: { label: 'Replied', note: 'The seller has replied. Check your Facebook messages.' },
  done: { label: 'Closed', note: 'This request is closed.' },
}

const SIDES = ['front', 'back'] as const

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function ShopRequestStatusPage() {
  const { slug = '', id = '' } = useParams()
  const preview = usePreview()
  const { data: request, isLoading, isError } = useQuery({
    queryKey: ['buyer-request', slug, id], queryFn: () => getBuyerRequest(slug, id),
    retry: false, refetchInterval: 60_000, // photos and replies show up without a refresh
  })
  const { data: shop } = useQuery({ queryKey: ['shop', slug], queryFn: () => getShop(slug), staleTime: 60_000, retry: false })
  const cards = useMemo(() => new Map<string, Card>((shop?.cards ?? []).map(o => [o.cardId, o.card])), [shop])

  // Opening the link on this browser remembers it with the others, so the shop's "Your requests" finds it.
  useEffect(() => { if (request) rememberShopRequest(slug, id) }, [request, slug, id])
  const others = myShopRequests(slug).filter(r => r.id !== id)

  const photoOf = (item: BuyerRequestItem, side: (typeof SIDES)[number]) => {
    const ref = request?.photos.find(p => p.cardId === item.cardId && p.condition === item.condition && p.side === side)
    return ref ? shopPhotoUrl(slug, ref) : undefined
  }
  const shopName = shop?.displayName || `${slug}'s shop`

  return (
    <div className="page-tracker shop-wrap">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">{shopName.toUpperCase()}</div>
          <Link to="/" className="user-badge" title="Powered by CardStacks">🃏 <b>CardStacks</b></Link>
          <Link to={`/shop/${slug}`} className="user-badge">🛍 <b>Back to the shop</b></Link>
        </header>

        <main className="buyer-req">
          <h1 className="buyer-req__title">Your request</h1>
          {isLoading && <p className="shop-msg">Loading…</p>}
          {isError && <p className="shop-msg">This request can't be found. Check the link, or message the seller on Facebook.</p>}
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
                            <button key={p.side} type="button" className="photo-frame" title={`Zoom in: ${p.side} photo`} onClick={() => preview.show(p.url!)}>
                              <img src={p.url} alt={`${p.side} photo of the ${item.name}`} loading="lazy" />
                              <span>{p.side === 'front' ? 'Front' : 'Back'}</span>
                            </button>
                          ))}
                        </div>
                      ) : item.photos ? (
                        <p className="buyer-req__waiting">📷 You asked for photos. They'll show up here once the seller takes them.</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>}
          {others.length > 0 && (
            <section className="buyer-req__others" aria-label="Your other requests">
              <h2>Your other requests to this shop</h2>
              <ul>
                {others.map(r => <li key={r.id}><Link to={`/shop/${slug}/request/${r.id}`}>Sent {day(r.at)}</Link></li>)}
              </ul>
            </section>
          )}
        </main>
      </div>
      {preview.overlay}
    </div>
  )
}
