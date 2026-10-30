/**
 * ShopRequestsPage — "My Shop": everything the seller does with their public shop, in one place.
 *
 * HOW IT WORKS
 *   Login required (owner only; the backend enforces it by path). Three tabs, kept in the URL
 *   (?tab=requests|offers|settings, ?offer=<id> opens one offer) so Back steps between them:
 *   - Requests: buy and trade requests sent from the public /shop/<slug> page, newest first,
 *     each with who, how to reach them, what they picked, and answered / done buttons.
 *   - Offers: card offers made through the old share-link trade page (folded into the shop),
 *     still answerable with their message threads. Hidden when there are none.
 *   - Settings: shop on/off, link name, shop name, bio and Messenger link.
 *   /trade and its ?offer= links redirect here (App.tsx).
 *
 * USED BY: App.tsx (route "/shop/requests"), HeaderNav ("Shop")
 * DEPENDS ON: api/shop, api/trading, components/OfferInbox, components/RequestedCards, components/CardPreview
 */

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getShopRequests, getShopSettings, saveShopSettings, setShopRequestStatus,
  type ShopRequest, type ShopRequestStatus, type ShopSettings,
} from '../api/shop'
import { getOffers } from '../api/trading'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { OfferInbox } from '../components/OfferInbox'
import { RequestedCards } from '../components/RequestedCards'
import { usePreview } from '../components/CardPreview'
import { contactUrl, facebookSearchUrl } from '../lib/contact'
import { useUser } from '../context/UserContext'

const STATUS_LABEL: Record<ShopRequestStatus, string> = { new: 'New', answered: 'Answered', done: 'Done' }

/** Turns the user's public shop on/off and sets its link name and Messenger link. */
function ShopSettingsPanel({ userId, suggestedSlug }: { userId: string; suggestedSlug: string }) {
  const { data: saved, isLoading } = useQuery({
    queryKey: ['shop-settings', userId], queryFn: () => getShopSettings(userId), enabled: !!userId,
  })
  const qc = useQueryClient()
  const [draft, setDraft] = useState<ShopSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  if (isLoading || !saved) return null

  // First visit has no saved shop, so offer a link name made from the username.
  const form: ShopSettings = draft ?? {
    ...saved,
    slug: saved.slug || suggestedSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30),
  }
  const link = `${window.location.origin}/shop/${form.slug.trim().toLowerCase()}`

  const save = async (next: ShopSettings) => {
    setBusy(true); setMsg('')
    try {
      const result = await saveShopSettings(userId, next)
      setDraft(null)
      qc.setQueryData(['shop-settings', userId], result)
      void qc.invalidateQueries({ queryKey: ['shop'] })
      setMsg(result.enabled ? 'Saved. Your shop is live.' : 'Saved. Your shop is off.')
    } catch (e) {
      const body = (e as { response?: { data?: unknown } }).response?.data
      setMsg(typeof body === 'string' && body ? body : 'Could not save. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <section className="shop-policy shop-settings" aria-label="Your shop settings">
      <b>Your public shop</b>
      <p className="shop-sub">Off by default. When on, anyone with your link can see the cards you own, today's market prices, and send you a request. What you paid and where cards are stored is never shown.</p>
      <label className="shop-agree">
        <input type="checkbox" checked={form.enabled} onChange={e => setDraft({ ...form, enabled: e.target.checked })} />
        Shop is {form.enabled ? 'ON (public)' : 'OFF (private)'}
      </label>
      <label>Link name (letters, numbers, dashes)
        <input type="text" value={form.slug} maxLength={30} onChange={e => setDraft({ ...form, slug: e.target.value })} />
      </label>
      <label>Shop name
        <input type="text" value={form.displayName ?? ''} maxLength={80}
          placeholder="Give your collection a name" onChange={e => setDraft({ ...form, displayName: e.target.value })} />
      </label>
      <label>About you and your cards
        <textarea value={form.bio ?? ''} rows={4} maxLength={1000}
          placeholder="Introduce yourself, the cards you collect, and how you like to arrange a sale."
          onChange={e => setDraft({ ...form, bio: e.target.value })} />
        <span className="shop-sub">Shown on your public shop. {(form.bio ?? '').length}/1000 characters.</span>
      </label>
      <label>Your Messenger link (optional, like https://m.me/yourname)
        <input type="text" value={form.messengerUrl} maxLength={200} onChange={e => setDraft({ ...form, messengerUrl: e.target.value })} />
      </label>
      {saved.enabled && saved.slug && <p>Your link: <b>{`${window.location.origin}/shop/${saved.slug}`}</b></p>}
      <div className="shop-sheet-btns">
        <button type="button" className="shop-btn" disabled={busy} onClick={() => save(form)}>{busy ? 'Saving…' : 'Save'}</button>
        {saved.enabled && saved.slug && (
          <Link className="shop-btn shop-btn-ghost" to={`/shop/${saved.slug}`}>👁 View my shop</Link>
        )}
        {saved.enabled && saved.slug && (
          <button type="button" className="shop-btn shop-btn-ghost"
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/shop/${saved.slug}`).then(() => setMsg('Link copied.'), () => setMsg(`Copy this: ${link}`))}>
            Copy link
          </button>
        )}
      </div>
      {msg && <p role="status">{msg}</p>}
    </section>
  )
}

type Tab = 'requests' | 'offers' | 'settings'

/**
 * How to reach a buyer: their link when they gave one, otherwise what they typed plus a Facebook search for their
 * name (older requests often just say "Facebook").
 */
function BuyerContact({ name, contact }: { name: string; contact: string }) {
  const url = contactUrl(contact)
  return (
    <div className="shop-req-contact">
      Reach them at:{' '}
      {url ? <a href={url.href} target="_blank" rel="noopener noreferrer"><b>{url.hostname.replace(/^www\./, '')}{url.pathname}</b> ↗</a> : <b>{contact}</b>}
      {!url && <a className="shop-btn shop-btn-ghost shop-req-search" href={facebookSearchUrl(name)} target="_blank" rel="noopener noreferrer">Search “{name}” on Facebook ↗</a>}
    </div>
  )
}

export function ShopRequestsPage() {
  const { user } = useUser()
  const userId = user?.id ?? ''
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<ShopRequestStatus | 'all'>('new')
  const preview = usePreview() // hover a requested card's picture to see it big while pulling it

  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ['shop-requests', userId],
    queryFn: () => getShopRequests(userId),
    enabled: !!userId,
    refetchInterval: 60_000, // new requests show up without a manual refresh
  })
  const { data: offers = [] } = useQuery({
    queryKey: ['offers', userId],
    queryFn: () => getOffers(userId),
    enabled: !!userId && !user?.isAnonymous,
    refetchInterval: 30_000,
  })
  const { data: settings } = useQuery({
    queryKey: ['shop-settings', userId], queryFn: () => getShopSettings(userId), enabled: !!userId,
  })

  const openOffer = params.get('offer') ?? ''
  const urlTab = params.get('tab')
  const tab: Tab = openOffer ? 'offers' : urlTab === 'offers' || urlTab === 'settings' ? urlTab : 'requests'
  const setTab = (t: Tab) => { if (t !== tab) setParams(t === 'requests' ? {} : { tab: t }) }

  const mark = async (r: ShopRequest, status: ShopRequestStatus) => {
    await setShopRequestStatus(userId, r.id, status)
    qc.invalidateQueries({ queryKey: ['shop-requests', userId] })
  }

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  const shown = requests.filter(r => filter === 'all' || r.status === filter)
  const newCount = requests.filter(r => r.status === 'new').length
  const unreadOffers = offers.filter(o => o.unread).length
  const shopOff = settings && !settings.enabled

  return (
    <div className="page-tracker page-shop-inbox">
      <h1 className="sr-only">My Shop</h1>
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">🛍 MY <span>SHOP</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <div className="header-right"><HeaderNav /></div>
        </header>

        <main className="trade-main">
          <nav className="trade-tabs" aria-label="My Shop sections">
            <button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
              Requests {newCount > 0 && <span className="trade-badge">{newCount}</span>}
            </button>
            {(offers.length > 0 || tab === 'offers') && (
              <button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')}>
                Offers {unreadOffers > 0 && <span className="trade-badge">{unreadOffers}</span>}
              </button>
            )}
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
            {settings?.enabled && settings.slug && <Link className="shop-view-link" to={`/shop/${settings.slug}`}>👁 View my shop</Link>}
          </nav>

          {tab === 'settings' && <ShopSettingsPanel userId={userId} suggestedSlug={user.username} />}

          {tab === 'offers' && (
            <OfferInbox userId={userId} offers={offers} openId={openOffer}
              setOpenId={id => setParams(id ? { offer: id } : { tab: 'offers' })} />
          )}

          {tab === 'requests' && <>
            <p className="shop-sub">Buy and trade requests from your public shop. Reply on Facebook, by phone, or by email using the contact they gave.</p>
            {shopOff && <p className="shop-msg">Your shop is off, so nobody can send requests. <button type="button" className="shop-link-btn" onClick={() => setTab('settings')}>Turn it on in Settings →</button></p>}
            <div className="shop-tools">
              {(['new', 'answered', 'done', 'all'] as const).map(f => (
                <button key={f} type="button" className={'shop-btn' + (filter === f ? '' : ' shop-btn-ghost')} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : STATUS_LABEL[f]}
                </button>
              ))}
            </div>

            {isLoading && <p className="shop-msg">Loading…</p>}
            {isError && <p className="shop-msg">Could not load requests. Please try again.</p>}
            {!isLoading && !isError && shown.length === 0 && <p className="shop-msg">Nothing here.</p>}

            <ul className="shop-list">
              {shown.map(r => (
                <li key={r.id} className="shop-req">
                  <div className="shop-req-head">
                    <b>{r.buyerName}</b>
                    <span className={'shop-pill shop-pill-' + r.status}>{r.kind === 'chat' ? 'Question' : r.message.startsWith('TRADE OFFER') ? 'Trade request' : 'Buy request'} · {STATUS_LABEL[r.status]}</span>
                    <span className="shop-sub">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <BuyerContact name={r.buyerName} contact={r.buyerContact} />
                  {r.items.length > 0 && <RequestedCards requestId={r.id} items={r.items} userId={userId} preview={preview} />}
                  {r.message && <p className="shop-req-msg">{r.message}</p>}
                  <div className="shop-sheet-btns">
                    {r.status !== 'answered' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'answered')}>Mark answered</button>}
                    {r.status !== 'done' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'done')}>Mark done</button>}
                    {r.status !== 'new' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'new')}>Reopen</button>}
                  </div>
                </li>
              ))}
            </ul>
          </>}
        </main>
      </div>
      {preview.overlay}
    </div>
  )
}
