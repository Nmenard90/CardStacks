/**
 * ShopRequestsPage — "My Shop": everything the seller does with their public shop, in one place.
 *
 * HOW IT WORKS
 *   Login required (owner only; the backend enforces it by path). Three tabs, kept in the URL
 *   (?tab=requests|offers|settings, ?offer=<id> opens one offer) so Back steps between them:
 *   - Requests: buy, trade and photo requests sent from the public /shop/<slug> page, newest first,
 *     each with who, what they picked (a pull list), the chat with the buyer, and answered / done buttons.
 *     "Complete sale" takes the found cards out of the collection; a refund puts them back.
 *   - Sent: requests this user sent to other shops (hidden until there is one); each opens its chat page.
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
  foundCount, getSentRequests, getShopRequests, getShopSettings, putBackShopRequest, saveShopSettings, sellShopRequest, setShopRequestStatus,
  type BuyerRequestView, type ShopRequest, type ShopRequestStatus, type ShopSettings,
} from '../api/shop'
import { ShopRequestChat } from '../components/ShopRequestChat'
import { afterInventoryChange } from '../lib/shopSale'
import { getOffers } from '../api/trading'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { OfferInbox } from '../components/OfferInbox'
import { RequestedCards } from '../components/RequestedCards'
import { usePreview } from '../components/CardPreview'
import { contactAction, contactMethod, parseContact } from '../lib/contact'
import { useUser } from '../context/UserContext'

const STATUS_LABEL: Record<ShopRequestStatus, string> = { new: 'New', answered: 'Answered', done: 'Done' }

/** Where a request stands: open (new / answered) or finished — sold (a sale took cards out) or closed with no sale. */
type Outcome = 'new' | 'answered' | 'sold' | 'closed'
const outcomeOf = (r: ShopRequest): Outcome =>
  r.status !== 'done' ? r.status : r.items.some(i => (i.sold ?? 0) > 0) ? 'sold' : 'closed'
const OUTCOME_LABEL: Record<Outcome, string> = { new: 'New', answered: 'Answered', sold: 'Sold', closed: 'Closed · no sale' }
const FILTERS: { id: Outcome | 'all'; label: string }[] = [
  { id: 'new', label: 'New' }, { id: 'answered', label: 'Answered' }, { id: 'sold', label: 'Sold' },
  { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' },
]

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

type Tab = 'requests' | 'sent' | 'offers' | 'settings'

const KIND_LABEL = (r: { kind: string; message: string }) =>
  r.kind === 'photos' ? 'Photo request' : r.kind === 'chat' ? 'Question' : r.message.startsWith('TRADE OFFER') ? 'Trade request' : 'Buy request'

/** Requests you sent to other shops: each opens its page (cards, the seller's photos, the chat). */
function SentRequests({ sent, loading }: { sent: BuyerRequestView[]; loading: boolean }) {
  if (loading) return <p className="shop-msg">Loading…</p>
  if (sent.length === 0) return <p className="shop-msg">You haven't sent any requests yet. Find a shop, pick cards, and tap Send request.</p>
  return (
    <ul className="shop-list">
      {sent.map(r => (
        <li key={r.id} className="shop-req">
          <div className="shop-req-head">
            <b>{r.shopName || r.shopSlug}</b>
            <span className={'shop-pill shop-pill-' + r.status}>{KIND_LABEL(r)} · {STATUS_LABEL[r.status]}</span>
            {r.unread && <span className="shop-pill shop-pill-new">New message</span>}
            <span className="shop-sub">{new Date(r.createdAt).toLocaleString()}</span>
          </div>
          {r.items.length > 0 && <p className="shop-sub">{r.items.map(i => `${i.qty}× ${i.name} #${i.number} (${i.condition})`).join(' · ')}</p>}
          <div className="shop-sheet-btns">
            <Link className="shop-btn" to={`/shop/${r.shopSlug}/request/${r.id}`}>Open chat and photos</Link>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * How to reach a buyer: the way they asked for (text, call, email, Facebook, other) and a button that does it. Older
 * requests have no chosen way: their link when they gave one, otherwise a Facebook search for their name.
 */
function BuyerContact({ name, contact }: { name: string; contact: string }) {
  const { method, value } = parseContact(contact)
  const action = contactAction(contact, name)
  return (
    <div className="shop-req-contact">
      {method ? contactMethod(method).sellerLabel : 'Reach them at:'} <b>{value}</b>
      {action && (
        <a className="shop-btn shop-btn-ghost shop-req-search" href={action.href}
          {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{action.label}</a>
      )}
    </div>
  )
}

/**
 * Completing a sale: the cards marked found come out of the seller's collection (only those, never twice). Asks first,
 * then says what happened, including any card the collection no longer had. A whole order can be put back (a refund
 * or a sale that fell through); one card is put back from its row (RequestedCards).
 */
function SaleControls({ request, userId, onChange }: { request: ShopRequest; userId: string; onChange: () => void }) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const toTake = request.items.reduce((n, i) => n + Math.max(0, foundCount(i) - (i.sold ?? 0)), 0)
  const notFound = request.items.reduce((n, i) => n + (i.sold ? 0 : i.qty - foundCount(i)), 0)
  const sold = request.items.reduce((n, i) => n + (i.sold ?? 0), 0)
  const plural = (n: number) => `${n} card${n === 1 ? '' : 's'}`

  const run = async (work: () => Promise<string>) => {
    setBusy(true); setNote('')
    try { onChange(); setNote(await work()); afterInventoryChange(qc, userId) }
    catch { setNote("Couldn't do that. Nothing in your collection changed; please try again.") }
    finally { setBusy(false); setAsking(false) }
  }
  const sell = () => run(async () => {
    const r = await sellShopRequest(userId, request.id)
    const short = r.short.map(s => `${s.name} #${s.number} (had ${s.taken} of ${s.wanted})`).join(', ')
    return `Sold: ${plural(r.taken)} taken out of your collection.` + (short ? ` Already gone from your collection: ${short}.` : '')
  })
  const putAllBack = () => run(async () => { await putBackShopRequest(userId, request.id); return `Put back: ${plural(sold)} returned to your collection.` })

  if (request.items.length === 0) return null
  return (
    <div className="sale">
      {asking ? (
        <div className="sale__ask" role="group" aria-label="Complete this sale">
          <p>Take the <b>{plural(toTake)}</b> you found out of your collection?{notFound > 0 && <> The {plural(notFound)} not found stay.</>}</p>
          <button type="button" className="shop-btn" disabled={busy} onClick={sell}>Yes, take them out</button>
          <button type="button" className="shop-btn shop-btn-ghost" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
        </div>
      ) : (
        <div className="sale__btns">
          {toTake > 0 && <button type="button" className="shop-btn" onClick={() => setAsking(true)}>Complete sale · take out {plural(toTake)}</button>}
          {sold > 0 && <button type="button" className="shop-btn shop-btn-ghost" disabled={busy} onClick={putAllBack}>Refund · put all {sold} back</button>}
          {toTake === 0 && sold === 0 && <span className="sale__hint">Mark the cards you found, then complete the sale to take them out of your collection.</span>}
        </div>
      )}
      {note && <p className="sale__note" role="status">{note}</p>}
    </div>
  )
}

export function ShopRequestsPage() {
  const { user } = useUser()
  const userId = user?.id ?? ''
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Outcome | 'all'>('new')
  const [touched, setTouched] = useState<Set<string>>(new Set())
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
  const { data: sent = [], isLoading: sentLoading } = useQuery({
    queryKey: ['shop-sent', userId], queryFn: () => getSentRequests(userId),
    enabled: !!userId && !user?.isAnonymous, refetchInterval: 60_000,
  })

  const openOffer = params.get('offer') ?? ''
  const urlTab = params.get('tab')
  const tab: Tab = openOffer ? 'offers' : urlTab === 'offers' || urlTab === 'settings' || urlTab === 'sent' ? urlTab : 'requests'
  const setTab = (t: Tab) => { if (t !== tab) setParams(t === 'requests' ? {} : { tab: t }) }

  const mark = async (r: ShopRequest, status: ShopRequestStatus) => {
    await setShopRequestStatus(userId, r.id, status)
    qc.invalidateQueries({ queryKey: ['shop-requests', userId] })
  }

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  // A request just sold (or put back) stays on screen until the filter changes, though it's now Done.
  const shown = requests.filter(r => filter === 'all' || outcomeOf(r) === filter || touched.has(r.id))
  // The Requests badge counts new requests plus older ones with an unread message.
  const newCount = requests.filter(r => r.status === 'new' || r.unread).length
  const unreadSent = sent.filter(r => r.unread).length
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
            {(sent.length > 0 || tab === 'sent') && (
              <button className={tab === 'sent' ? 'active' : ''} onClick={() => setTab('sent')}>
                Sent {unreadSent > 0 && <span className="trade-badge">{unreadSent}</span>}
              </button>
            )}
            {(offers.length > 0 || tab === 'offers') && (
              <button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')}>
                Offers {unreadOffers > 0 && <span className="trade-badge">{unreadOffers}</span>}
              </button>
            )}
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
            {settings?.enabled && settings.slug && <Link className="shop-view-link" to={`/shop/${settings.slug}`}>👁 View my shop</Link>}
          </nav>

          {tab === 'settings' && <ShopSettingsPanel userId={userId} suggestedSlug={user.username} />}

          {tab === 'sent' && <>
            <p className="shop-sub">Requests you sent to other shops. Open one to see the seller's photos and chat with them.</p>
            <SentRequests sent={sent} loading={sentLoading} />
          </>}

          {tab === 'offers' && (
            <OfferInbox userId={userId} offers={offers} openId={openOffer}
              setOpenId={id => setParams(id ? { offer: id } : { tab: 'offers' })} />
          )}

          {tab === 'requests' && <>
            <p className="shop-sub">Buy, trade and photo requests from your public shop. Reply in each request's chat; you get an email at your sign-in address for each new request and message.</p>
            {shopOff && <p className="shop-msg">Your shop is off, so nobody can send requests. <button type="button" className="shop-link-btn" onClick={() => setTab('settings')}>Turn it on in Settings →</button></p>}
            <div className="shop-tools">
              {FILTERS.map(({ id: f, label }) => (
                <button key={f} type="button" className={'shop-btn' + (filter === f ? '' : ' shop-btn-ghost')} onClick={() => { setFilter(f); setTouched(new Set()) }}>
                  {label}{f !== 'all' && ` (${requests.filter(r => outcomeOf(r) === f).length})`}
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
                    <span className={'shop-pill shop-pill-' + r.status}>{KIND_LABEL(r)} · {OUTCOME_LABEL[outcomeOf(r)]}</span>
                    {r.unread && <span className="shop-pill shop-pill-new">New message</span>}
                    <span className="shop-sub">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  {r.status === 'done' && (
                    <p className="shop-sub">{outcomeOf(r) === 'sold'
                      ? 'This sale is complete. The sold cards came out of your collection; a refund puts them back.'
                      : 'You closed this request without a sale. Reopen it to work on it again.'}</p>
                  )}
                  {/* Requests from before the chat only have the contact the buyer typed. */}
                  {!r.buyerUserId && <BuyerContact name={r.buyerName} contact={r.buyerContact} />}
                  {/* A finished request is a record: no finding or re-grading until it's reopened. */}
                  {r.items.length > 0 && <RequestedCards requestId={r.id} items={r.items} userId={userId} preview={preview} locked={r.status === 'done'} />}
                  {r.message && <p className="shop-req-msg">{r.message}</p>}
                  {r.buyerUserId && <ShopRequestChat userId={userId} request={r} />}
                  {/* A closed request has nothing to sell; a sold one keeps only its refund. */}
                  {(outcomeOf(r) !== 'closed' || touched.has(r.id)) && <SaleControls request={r} userId={userId} onChange={() => setTouched(t => new Set(t).add(r.id))} />}
                  <div className="shop-sheet-btns">
                    {r.status === 'done' ? (
                      <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'new')}>Reopen</button>
                    ) : <>
                      {r.status === 'new' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'answered')}>Mark answered</button>}
                      <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'done')}>{r.items.length > 0 ? 'Close, no sale' : 'Mark done'}</button>
                    </>}
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
