/**
 * TradePage — the owner's side of share-link trading.
 *
 * HOW IT WORKS
 *   Three tabs:
 *   - Offers: every offer made or received, newest activity first; opening
 *     one shows both sides of the deal, the actions this side may take
 *     (accept/decline, withdraw, mark complete/cancel) and its message
 *     thread, which polls every 10s while open.
 *   - Trade list: cards hand-picked from the collection as available, each
 *     with an optional asking price (blank = "make me an offer").
 *     The list and the whole collection below it are both browsable
 *     (CardBrowser: sort by value/name/set/recent, filter by set or name).
 *   - Share link: the one link to hand out, whether it's on, whether it
 *     also exposes the whole collection, a short bio, and a way to replace
 *     the link (the old one stops working).
 *   No money moves through the app — cash amounts are settled however the
 *   two collectors agree, in the thread.
 *
 * USED BY: App (route "/trade", "?offer=<id>" opens one offer)
 * DEPENDS ON: api/trading, api/collection
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { useToast } from '../components/Toast'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { getOwnedCards } from '../api/collection'
import {
  getOffer, getOffers, getShareSettings, getTradeList, postOfferMessage, regenerateShareLink,
  removeTradeItem, saveTradeItem, setOfferStatus, tradingError, updateShareSettings,
} from '../api/trading'
import { money, shareOrigin } from '../lib/trading'
import { condPrice } from '../lib/conditions'
import { CardBrowser, SetLine, type BrowseFields } from '../components/CardBrowser'
import type { CardOffer, OfferCard, CardOfferStatus, OwnedCard, TradeListItem } from '../types'

type Tab = 'offers' | 'list' | 'share'

export function TradePage() {
  const { user } = useUser()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get('offer') ? 'offers' : ((params.get('tab') as Tab) || 'offers'))

  const { data: offers = [] } = useQuery({
    queryKey: ['offers', user?.id],
    queryFn: () => getOffers(user!.id),
    enabled: !!user && !user.isAnonymous,
    refetchInterval: 30_000,
  })
  const unread = offers.filter(o => o.unread).length

  if (!user) return <div className="page-tracker trade-page"><LoginScreen /></div>

  return (
    <div className="page-tracker trade-page">
      <div id="app" style={{ display: 'block' }}>
        <header>
          <div className="logo">🤝 TRADE <span>&amp; SELL</span></div>
          <div className="user-badge">👤 <b>{user.username}</b></div>
          <div className="header-right"><HeaderNav /></div>
        </header>

        {user.isAnonymous ? (
          <main className="trade-main">
            <div className="trade-empty">
              <h2>Create a free account to trade</h2>
              <p>Demo accounts are deleted after 24 hours, so they can't share cards or make offers. Sign up from the demo banner to keep your collection and start trading.</p>
            </div>
          </main>
        ) : (
          <main className="trade-main">
            <nav className="trade-tabs">
              <button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')}>
                Offers {unread > 0 && <span className="trade-badge">{unread}</span>}
              </button>
              <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>My trade list</button>
              <button className={tab === 'share' ? 'active' : ''} onClick={() => setTab('share')}>Share link</button>
            </nav>

            {tab === 'offers' && (
              <OffersTab
                userId={user.id} offers={offers}
                openId={params.get('offer') || ''}
                setOpenId={id => setParams(id ? { offer: id } : {})}
              />
            )}
            {tab === 'list' && <TradeListTab userId={user.id} />}
            {tab === 'share' && <ShareTab userId={user.id} />}
          </main>
        )}
      </div>
    </div>
  )
}

// ── Offers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<CardOfferStatus, string> = {
  Pending: 'Waiting for a reply', Accepted: 'Accepted — arrange it in the thread', Declined: 'Declined',
  Withdrawn: 'Withdrawn', Cancelled: 'Cancelled', Completed: 'Completed',
}

function offerHeadline(o: CardOffer): string {
  const wantCount = o.wants.reduce((n, c) => n + c.quantity, 0)
  const cards = `${wantCount} card${wantCount === 1 ? '' : 's'}`
  return o.role === 'seller' ? `${o.otherUser} wants ${cards} of yours` : `You offered on ${o.otherUser}'s ${cards}`
}

function OffersTab({ userId, offers, openId, setOpenId }: {
  userId: string; offers: CardOffer[]; openId: string; setOpenId: (id: string) => void
}) {
  if (offers.length === 0 && !openId) {
    return (
      <div className="trade-empty">
        <h2>No offers yet</h2>
        <p>Add cards to your trade list, then send people your share link. Offers they make show up here.</p>
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
            <span><b>{c.quantity > 1 ? `${c.quantity}× ` : ''}{c.name}</b><small>{c.condition} · {money(c.marketPrice)}</small></span>
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

// ── Trade list ───────────────────────────────────────────────────────────────

interface Editing {
  cardId: string; name: string; image: string; condition: string; quantity: number
  owned: Record<string, number>; askingPrice: string; note: string
}

const condMap = (o: OwnedCard) =>
  Object.fromEntries(o.conditions.filter(c => c.quantity > 0).map(c => [c.condition, c.quantity])) as Record<string, number>

/** Best per-copy market value across the conditions actually owned. */
const ownedValue = (o: OwnedCard): number | null => {
  const prices = o.conditions.filter(c => c.quantity > 0).map(c => condPrice(o.card, c.condition)).filter(p => p > 0)
  return prices.length ? Math.max(...prices) : null
}
const ownedFields = (o: OwnedCard): BrowseFields => ({
  name: o.card.name, setId: o.card.setId, number: o.card.number, value: ownedValue(o),
  quantity: o.conditions.reduce((n, c) => n + Math.max(0, c.quantity), 0), addedAt: o.updatedAt,
})
const listedFields = (i: TradeListItem): BrowseFields => ({
  name: i.card.name, setId: i.card.setId, number: i.card.number, value: i.askingPrice ?? i.card.marketPrice ?? null,
  quantity: i.card.quantity, addedAt: i.updatedAt,
})

function TradeListTab({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: items = [], isLoading } = useQuery({ queryKey: ['trade-list', userId], queryFn: () => getTradeList(userId) })
  const { data: owned = [], isLoading: ownedLoading } = useQuery({ queryKey: ['owned', userId], queryFn: () => getOwnedCards(userId) })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saving, setSaving] = useState(false)

  const ownedById = useMemo(() => new Map(owned.map(o => [o.cardId, o])), [owned])
  const listedByCard = useMemo(() => {
    const m = new Map<string, TradeListItem[]>()
    for (const i of items) m.set(i.card.cardId, [...(m.get(i.card.cardId) ?? []), i])
    return m
  }, [items])
  const ownedNonZero = useMemo(() => owned.filter(o => o.conditions.some(c => c.quantity > 0)), [owned])

  const startFromOwned = (o: OwnedCard) => {
    const conds = condMap(o)
    // Open on an already-listed condition if there is one, else the first owned.
    const first = listedByCard.get(o.cardId)?.[0]?.card.condition ?? Object.keys(conds)[0] ?? 'NM'
    const existing = items.find(i => i.card.cardId === o.cardId && i.card.condition === first)
    setEditing({
      cardId: o.cardId, name: o.card.name, image: o.card.images.small, condition: first,
      quantity: existing?.card.quantity ?? 1, owned: conds,
      askingPrice: existing?.askingPrice != null ? String(existing.askingPrice) : '', note: existing?.note ?? '',
    })
  }
  const startFromItem = (i: TradeListItem) => {
    const o = ownedById.get(i.card.cardId)
    setEditing({
      cardId: i.card.cardId, name: i.card.name, image: i.card.imageSmall, condition: i.card.condition,
      quantity: i.card.quantity, owned: o ? condMap(o) : { [i.card.condition]: i.card.quantity },
      askingPrice: i.askingPrice != null ? String(i.askingPrice) : '', note: i.note ?? '',
    })
  }

  const save = async () => {
    if (!editing) return
    const price = editing.askingPrice.trim() === '' ? undefined : Number(editing.askingPrice)
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) { toast('Asking price must be a positive number, or blank for "make an offer".'); return }
    setSaving(true)
    try {
      const list = await saveTradeItem(userId, {
        cardId: editing.cardId, condition: editing.condition, quantity: editing.quantity,
        askingPrice: price, note: editing.note.trim() || undefined,
      })
      qc.setQueryData(['trade-list', userId], list)
      toast(`${editing.name} is on your trade list.`)
      setEditing(null)
    } catch (e) {
      toast(tradingError(e, 'Could not save that card.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (i: TradeListItem) => {
    try {
      await removeTradeItem(userId, i.id)
      qc.setQueryData<TradeListItem[]>(['trade-list', userId], prev => (prev || []).filter(x => x.id !== i.id))
    } catch (e) {
      toast(tradingError(e, 'Could not remove that card.'))
    }
  }

  return (
    <div className="trade-list-tab">
      <section>
        <h3>On your trade list</h3>
        {isLoading ? <p className="muted">Loading…</p> : (
          <CardBrowser
            items={items}
            fields={listedFields}
            itemKey={i => i.id}
            empty={<p className="muted">Nothing listed yet — pick cards from your collection below.</p>}
            renderTile={i => (
              <div className="trade-tile">
                <img src={i.card.imageSmall} alt={i.card.name} loading="lazy" />
                <b>{i.card.name}</b>
                <SetLine setId={i.card.setId} number={i.card.number} />
                <small>{i.card.condition}{i.card.quantity > 1 ? ` · ×${i.card.quantity}` : ''} · market {money(i.card.marketPrice)}</small>
                <span className="trade-ask">{i.askingPrice != null ? `Asking ${money(i.askingPrice)}` : 'Make an offer'}</span>
                {i.note && <small className="trade-note">{i.note}</small>}
                <div className="trade-tile-actions">
                  <button onClick={() => startFromItem(i)}>Edit</button>
                  <button onClick={() => void remove(i)}>Remove</button>
                </div>
              </div>
            )}
          />
        )}
      </section>

      <section>
        <h3>Your collection <small>tap a card to list it</small></h3>
        {ownedLoading ? <p className="muted">Loading…</p> : (
          <CardBrowser
            items={ownedNonZero}
            fields={ownedFields}
            itemKey={o => o.cardId}
            empty={<p className="muted">Your collection is empty — add cards first.</p>}
            renderTile={o => {
              const listed = listedByCard.get(o.cardId) ?? []
              const conds = condMap(o)
              const value = ownedValue(o)
              return (
                <button className={`trade-tile owned-tile ${listed.length ? 'listed' : ''}`} onClick={() => startFromOwned(o)}>
                  {listed.length > 0 && <span className="listed-chip">Listed</span>}
                  <img src={o.card.images.small} alt={o.card.name} loading="lazy" />
                  <b>{o.card.name}</b>
                  <SetLine setId={o.card.setId} number={o.card.number} />
                  <small>{Object.entries(conds).map(([c, q]) => `${q}× ${c}`).join(' · ')}</small>
                  <span className="trade-ask">{value != null ? money(value) : 'No price'}</span>
                  <span className="owned-cta">{listed.length ? 'Edit listing' : '+ List for trade'}</span>
                </button>
              )
            }}
          />
        )}
      </section>

      {editing && (
        <div className="offer-sheet" role="dialog" aria-label="List for trade" onClick={e => { if (e.target === e.currentTarget) setEditing(null) }}>
          <div className="offer-sheet-inner">
            <header>
              <h3>List for trade</h3>
              <button onClick={() => setEditing(null)} aria-label="Close">✕</button>
            </header>
            <div className="trade-edit">
              <img src={editing.image} alt="" />
              <div className="trade-edit-fields">
                <b>{editing.name}</b>
                <label>Condition
                  <select value={editing.condition} onChange={e => {
                    // Switch to that condition's own listing (if any), not the previous one's price/note.
                    const condition = e.target.value
                    const existing = items.find(i => i.card.cardId === editing.cardId && i.card.condition === condition)
                    setEditing({
                      ...editing, condition, quantity: existing?.card.quantity ?? 1,
                      askingPrice: existing?.askingPrice != null ? String(existing.askingPrice) : '', note: existing?.note ?? '',
                    })
                  }}>
                    {Object.entries(editing.owned).map(([c, q]) => <option key={c} value={c}>{c} (own {q})</option>)}
                  </select>
                </label>
                <label>Quantity
                  <input type="number" min={1} max={editing.owned[editing.condition] ?? 1} value={editing.quantity}
                    onChange={e => setEditing({ ...editing, quantity: Math.max(1, Math.min(editing.owned[editing.condition] ?? 1, Number(e.target.value) || 1)) })} />
                </label>
                <label>Asking price (USD, each)
                  <input inputMode="decimal" value={editing.askingPrice} placeholder="Blank = make me an offer"
                    onChange={e => setEditing({ ...editing, askingPrice: e.target.value })} />
                </label>
                <label>Note
                  <input value={editing.note} maxLength={300} placeholder="e.g. light whitening on back"
                    onChange={e => setEditing({ ...editing, note: e.target.value })} />
                </label>
                <div className="trade-edit-actions">
                  <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save to trade list'}</button>
                  <button onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Share link ───────────────────────────────────────────────────────────────

function ShareTab({ userId }: { userId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: share, error } = useQuery({ queryKey: ['share', userId], queryFn: () => getShareSettings(userId) })
  const [bio, setBio] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (error) return <div className="trade-empty"><p>{tradingError(error, 'Could not load your share link.')}</p></div>
  if (!share) return <p className="muted">Loading…</p>

  const url = `${shareOrigin()}/s/${share.slug}`
  const currentBio = bio ?? share.bio ?? ''

  const update = async (patch: Partial<{ enabled: boolean; collectionPublic: boolean; bio: string }>) => {
    setBusy(true)
    try {
      const next = await updateShareSettings(userId, {
        enabled: patch.enabled ?? share.enabled,
        collectionPublic: patch.collectionPublic ?? share.collectionPublic,
        // Toggles keep the saved bio — an unsaved draft is only sent by "Save bio".
        bio: (patch.bio ?? share.bio ?? '').trim() || undefined,
      })
      qc.setQueryData(['share', userId], next)
      if (patch.bio !== undefined) setBio(null)
      toast('Saved.')
    } catch (e) {
      toast(tradingError(e, 'Could not save.'))
    } finally {
      setBusy(false)
    }
  }
  const shareLink = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'My cards on CardStacks', url })
      else { await navigator.clipboard.writeText(url); toast('Link copied.') }
    } catch { /* share sheet dismissed */ }
  }
  const regenerate = async () => {
    if (!confirm('Make a new link? Anyone with the old link will no longer be able to see your cards.')) return
    try {
      qc.setQueryData(['share', userId], await regenerateShareLink(userId))
      toast('New link created — the old one no longer works.')
    } catch (e) {
      toast(tradingError(e, 'Could not make a new link.'))
    }
  }

  return (
    <div className="share-tab">
      <section className="share-link-box">
        <h3>Your share link</h3>
        <div className="share-url">
          <input readOnly value={url} onFocus={e => e.currentTarget.select()} />
          <button className="primary" onClick={() => void shareLink()}>{'share' in navigator ? 'Share' : 'Copy'}</button>
          <a href={`/s/${share.slug}`} target="_blank" rel="noreferrer">Preview</a>
        </div>
        {!share.enabled && <p className="share-off">This link is turned off — nobody can open it right now.</p>}
      </section>

      <section className="share-options">
        <label className="share-toggle">
          <input type="checkbox" checked={share.enabled} disabled={busy} onChange={e => void update({ enabled: e.target.checked })} />
          <span><b>Link is on</b><small>Turn off to hide your cards without losing your trade list.</small></span>
        </label>
        <label className="share-toggle">
          <input type="checkbox" checked={share.collectionPublic} disabled={busy} onChange={e => void update({ collectionPublic: e.target.checked })} />
          <span><b>Also show my whole collection</b><small>People can then offer on any card you own, not just your trade list. Purchase prices always stay private.</small></span>
        </label>
        <label className="share-bio">About you <small>(shown on your page)</small>
          <textarea rows={3} maxLength={500} value={currentBio} placeholder="e.g. Ships from Austin, TX within 2 days. Happy to meet up locally."
            onChange={e => setBio(e.target.value)} />
        </label>
        <div className="share-actions">
          <button className="primary" disabled={busy || bio === null} onClick={() => void update({ bio: currentBio })}>Save bio</button>
          <button onClick={() => void regenerate()}>Make a new link</button>
        </div>
      </section>
    </div>
  )
}
