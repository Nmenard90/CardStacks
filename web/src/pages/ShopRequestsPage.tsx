/**
 * ShopRequestsPage — the seller's inbox for requests sent from the public /shop page.
 *
 * HOW IT WORKS
 *   Login required (owner only; the backend enforces it by path). Newest first.
 *   Each request shows who, how to reach them, what they picked, and buttons
 *   to mark it answered / done.
 *
 * USED BY: App.tsx (route "/shop/requests"), HeaderNav (Tools menu)
 * DEPENDS ON: api/shop
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getShopRequests, getShopSettings, saveShopSettings, setShopRequestStatus,
  type ShopRequest, type ShopRequestStatus, type ShopSettings,
} from '../api/shop'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
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

export function ShopRequestsPage() {
  const { user } = useUser()
  const userId = user?.id ?? ''
  const qc = useQueryClient()
  const [filter, setFilter] = useState<ShopRequestStatus | 'all'>('new')

  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ['shop-requests', userId],
    queryFn: () => getShopRequests(userId),
    enabled: !!userId,
    refetchInterval: 60_000, // new requests show up without a manual refresh
  })

  const mark = async (r: ShopRequest, status: ShopRequestStatus) => {
    await setShopRequestStatus(userId, r.id, status)
    qc.invalidateQueries({ queryKey: ['shop-requests', userId] })
  }

  if (!user) return <div className="page-tracker"><LoginScreen /></div>

  const shown = requests.filter(r => filter === 'all' || r.status === filter)
  const newCount = requests.filter(r => r.status === 'new').length

  return (
    <div className="page-shop page-shop-inbox">
      <header className="shop-top">
        <h1>Shop requests {newCount > 0 && <span className="shop-badge">{newCount} new</span>}</h1>
        <p>Requests from your public shop page. Reply on Facebook, by phone, or by email using the contact they gave.</p>
        <HeaderNav />
      </header>

      <ShopSettingsPanel userId={userId} suggestedSlug={user.username} />

      <div className="shop-tools">
        {(['new', 'answered', 'done', 'all'] as const).map(f => (
          <button key={f} type="button" className={'shop-btn' + (filter === f ? '' : ' shop-btn-ghost')} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {isLoading && <p className="shop-msg">Loading…</p>}
      {isError && <p className="shop-msg">Could not load requests. If this is the first time, the shop_requests table may not exist yet (run migration 017).</p>}
      {!isLoading && !isError && shown.length === 0 && <p className="shop-msg">Nothing here.</p>}

      <ul className="shop-list">
        {shown.map(r => (
          <li key={r.id} className="shop-req">
            <div className="shop-req-head">
              <b>{r.buyerName}</b>
              <span className={'shop-pill shop-pill-' + r.status}>{r.kind === 'chat' ? 'Question' : 'Buy request'} · {STATUS_LABEL[r.status]}</span>
              <span className="shop-sub">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <div>Reach them at: <b>{r.buyerContact}</b></div>
            {r.items.length > 0 && (
              <ul className="shop-summary">
                {r.items.map((i, n) => <li key={n}>{i.qty}× {i.name} #{i.number} ({i.condition})</li>)}
              </ul>
            )}
            {r.message && <p className="shop-req-msg">{r.message}</p>}
            <div className="shop-sheet-btns">
              {r.status !== 'answered' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'answered')}>Mark answered</button>}
              {r.status !== 'done' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'done')}>Mark done</button>}
              {r.status !== 'new' && <button type="button" className="shop-btn shop-btn-ghost" onClick={() => mark(r, 'new')}>Reopen</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
