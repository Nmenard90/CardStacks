/**
 * SharePage — what someone sees when they open a collector's share link.
 *
 * HOW IT WORKS
 *   Loads the public profile for /s/:slug (no sign-in needed to look):
 *   the owner's trade list, and their whole collection too if they turned
 *   that on — both browsable (sort by value/name/set, filter by set or
 *   name, scroll loads more). Tapping "Want" puts a card in the offer tray. Making the
 *   offer itself needs a real (non-demo) account — signed-out visitors get
 *   the login screen right in the tray. The offer can be cash, cards from
 *   the visitor's own collection, or both, plus an opening message; it
 *   then lives on the Trade page's Offers tab for both people.
 *
 * USED BY: App (route "/s/:slug")
 * DEPENDS ON: api/trading, api/collection
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { useToast } from '../components/Toast'
import { LoginScreen } from '../components/LoginScreen'
import { getOwnedCards } from '../api/collection'
import { getSharedProfile, makeOffer, tradingError } from '../api/trading'
import { getGames } from '../api/cards'
import { currentGame } from '../lib/game'
import { money, RETURN_KEY } from '../lib/trading'
import { condLabel } from '../lib/conditions'
import { CardBrowser, SetLine, type BrowseFields } from '../components/CardBrowser'
import type { OwnedCard, TradeCardView } from '../types'

interface Line { card: TradeCardView; quantity: number; max: number; askingPrice?: number }
interface GiveLine { cardId: string; name: string; image: string; condition: string; quantity: number; max: number }

const key = (cardId: string, condition: string) => `${cardId}|${condition}`

/** Signing in with Google redirects back to the site root — remember this
 *  share page so ReturnAfterLogin (App.tsx) can bring the visitor back.
 *  Forgotten again when the sign-in box goes away (tray closed, signed in
 *  here), so an abandoned attempt can't hijack some later, unrelated login.
 *  The OAuth redirect is a full page unload, which never runs this. */
const rememberReturn = (el: HTMLElement | null) => {
  try {
    if (el) sessionStorage.setItem(RETURN_KEY, window.location.pathname)
    else sessionStorage.removeItem(RETURN_KEY)
  } catch { /* storage blocked */ }
}

export function SharePage() {
  const { slug = '' } = useParams()
  // Each game is its own world: the link says which game's cards to show
  // (TradePage adds ?game=), falling back to the visitor's own game.
  const [search, setSearch] = useSearchParams()
  const game = search.get('game') || currentGame()
  const { data: games = [] } = useQuery({ queryKey: ['games'], queryFn: getGames })
  const gameName = (id: string) => games.find(g => g.id === id)?.shortName ?? id
  const { user } = useUser()
  const toast = useToast()
  const navigate = useNavigate()
  const { data: profile, error, isLoading } = useQuery({
    queryKey: ['shared', slug, game],
    queryFn: () => getSharedProfile(slug, game),
    retry: false,
  })

  const [tab, setTab] = useState<'trade' | 'all'>('trade')
  const [wants, setWants] = useState<Record<string, Line>>({})
  const [composing, setComposing] = useState(false)
  const [cash, setCash] = useState('')
  const [gives, setGives] = useState<Record<string, GiveLine>>({})
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const isOwner = !!user && !!profile && user.username === profile.username

  const asking = useMemo(() => new Map((profile?.tradeList ?? []).map(i => [key(i.card.cardId, i.card.condition), i.askingPrice])), [profile])
  const cards: TradeCardView[] = useMemo(
    () => (tab === 'trade' ? (profile?.tradeList ?? []).map(i => i.card) : (profile?.collection ?? [])),
    [profile, tab])
  /** Sort/total by the asking price where the owner set one, else market. */
  const cardFields = useCallback((c: TradeCardView): BrowseFields => ({
    name: c.name, setId: c.setId, number: c.number, quantity: c.quantity, rarity: c.rarity,
    value: asking.get(key(c.cardId, c.condition)) ?? c.marketPrice ?? null,
  }), [asking])

  const wantLines = Object.values(wants)
  const wantCount = wantLines.reduce((n, l) => n + l.quantity, 0)
  const askTotal = wantLines.reduce((s, l) => s + (l.askingPrice ?? l.card.marketPrice ?? 0) * l.quantity, 0)

  const toggleWant = (c: TradeCardView) => {
    const k = key(c.cardId, c.condition)
    setWants(prev => {
      const next = { ...prev }
      if (next[k]) delete next[k]
      else next[k] = { card: c, quantity: 1, max: c.quantity, askingPrice: asking.get(k) }
      return next
    })
  }
  const setWantQty = (k: string, q: number) =>
    setWants(prev => ({ ...prev, [k]: { ...prev[k], quantity: Math.max(1, Math.min(prev[k].max, q)) } }))

  const submit = async () => {
    if (!user) return
    const cashAmount = cash.trim() === '' ? undefined : Number(cash)
    if (cashAmount !== undefined && (!Number.isFinite(cashAmount) || cashAmount < 0)) { toast('Cash must be a positive number.'); return }
    setSending(true)
    try {
      const offer = await makeOffer(user.id, {
        slug,
        wants: wantLines.map(l => ({ cardId: l.card.cardId, condition: l.card.condition, quantity: l.quantity })),
        gives: Object.values(gives).map(g => ({ cardId: g.cardId, condition: g.condition, quantity: g.quantity })),
        cashAmount,
        message: message.trim() || undefined,
      })
      toast(`Offer sent to ${profile?.username}.`)
      navigate(`/trade?offer=${offer.id}`)
    } catch (e) {
      toast(tradingError(e, 'Could not send the offer.'))
    } finally {
      setSending(false)
    }
  }

  if (isLoading) return <div className="page-tracker share-page"><p className="share-loading">Loading…</p></div>
  if (error || !profile) {
    return (
      <div className="page-tracker share-page">
        <div className="trade-empty">
          <h2>Link not found</h2>
          <p>{tradingError(error, "This share link doesn't exist or was turned off.")}</p>
          <Link to="/">Go to CardStacks</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page-tracker share-page">
      <header className="share-hero">
        <Link to="/" className="share-brand">CardStacks</Link>
        <h1>{profile.username}'s cards</h1>
        <p className="share-meta">
          ⭐ {profile.reputation} reputation · member since {new Date(profile.memberSince).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
        </p>
        {profile.bio && <p className="share-bio-text">{profile.bio}</p>}
        {isOwner && <p className="share-owner-note">This is your public page. <Link to="/trade?tab=share">Edit sharing</Link></p>}
        {(profile.games.length > 1 || !profile.games.includes(game)) && profile.games.length > 0 && (
          <nav className="trade-tabs share-games" aria-label="Game">
            {profile.games.map(g => (
              <button key={g} className={g === game ? 'active' : ''}
                onClick={() => { setWants({}); setSearch({ game: g }) }}>{gameName(g)}</button>
            ))}
          </nav>
        )}
      </header>

      <main className="trade-main">
        <div className="share-controls">
          <nav className="trade-tabs">
            <button className={tab === 'trade' ? 'active' : ''} onClick={() => setTab('trade')}>For trade ({profile.tradeList.length})</button>
            {profile.collection && (
              <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Whole collection ({profile.collection.length})</button>
            )}
          </nav>
        </div>

        <CardBrowser
          key={tab}
          items={cards}
          fields={cardFields}
          itemKey={c => key(c.cardId, c.condition)}
          empty={<p className="muted">{tab === 'trade' ? `${profile.username} hasn't listed any cards for trade yet.` : 'No cards.'}</p>}
          renderTile={c => {
            const k = key(c.cardId, c.condition)
            const ask = asking.get(k)
            const picked = !!wants[k]
            return (
              <div className={`trade-tile ${picked ? 'picked' : ''}`}>
                <img src={c.imageSmall} alt={c.name} loading="lazy" />
                <b>{c.name}</b>
                <SetLine setId={c.setId} number={c.number} />
                <small>{condLabel(c.condition)}{c.quantity > 1 ? ` · ${c.quantity} available` : ''} · market {money(c.marketPrice)}</small>
                {asking.has(k) && <span className="trade-ask">{ask != null ? `Asking ${money(ask)}` : 'Make an offer'}</span>}
                {!isOwner && (
                  <button className={picked ? 'primary' : ''} onClick={() => toggleWant(c)}>{picked ? '✓ In offer' : '+ Want'}</button>
                )}
              </div>
            )
          }}
        />
      </main>

      {wantCount > 0 && !composing && (
        <div className="offer-tray">
          <span><b>{wantCount} card{wantCount === 1 ? '' : 's'}</b> selected · asking/market ≈ {money(askTotal)}</span>
          <button className="primary" onClick={() => setComposing(true)}>Make an offer →</button>
        </div>
      )}

      {composing && (
        <div className="offer-sheet" role="dialog" aria-label="Make an offer">
          <div className="offer-sheet-inner">
            <header>
              <h3>Offer to {profile.username}</h3>
              <button onClick={() => setComposing(false)} aria-label="Close">✕</button>
            </header>

            <section>
              <h4>You want</h4>
              {wantLines.map(l => {
                const k = key(l.card.cardId, l.card.condition)
                return (
                  <div className="offer-line" key={k}>
                    <img src={l.card.imageSmall} alt="" />
                    <span>{l.card.name}<small>{condLabel(l.card.condition)} · {l.askingPrice != null ? `asking ${money(l.askingPrice)}` : `market ${money(l.card.marketPrice)}`}</small></span>
                    {l.max > 1 && <input type="number" min={1} max={l.max} value={l.quantity} onChange={e => setWantQty(k, Number(e.target.value) || 1)} />}
                    <button onClick={() => toggleWant(l.card)} aria-label="Remove">✕</button>
                  </div>
                )
              })}
              {wantLines.length === 0 && <p className="muted">Pick at least one card.</p>}
              <p className="muted">Asking/market total ≈ {money(askTotal)}</p>
            </section>

            {!user ? (
              <section className="offer-login" ref={rememberReturn}>
                <p>Sign in or create a free account to send this offer.</p>
                <LoginScreen />
              </section>
            ) : user.isAnonymous ? (
              <p className="share-off">Demo accounts can't make offers — create a free account first.</p>
            ) : isOwner ? null : (
              <>
                <section>
                  <h4>You offer</h4>
                  <label className="offer-cash-input">💵 Cash (USD)
                    <input inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} placeholder="0.00" />
                  </label>
                  <GivePicker userId={user.id} game={game} gives={gives} setGives={setGives} />
                </section>
                <section>
                  <h4>Message</h4>
                  <textarea rows={3} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)}
                    placeholder="e.g. Can pay PayPal G&S today, or meet up in Austin." />
                </section>
                <p className="offer-note">CardStacks doesn't process payments — you'll arrange payment and shipping together in the offer's message thread.</p>
                <button className="primary offer-send" disabled={sending || wantLines.length === 0} onClick={() => void submit()}>
                  {sending ? 'Sending…' : 'Send offer'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Picks cards from the visitor's own collection to put into the offer. */
function GivePicker({ userId, game, gives, setGives }: {
  userId: string
  /** The page's game — you can only trade cards from the same game. */
  game: string
  gives: Record<string, GiveLine>
  setGives: (fn: (prev: Record<string, GiveLine>) => Record<string, GiveLine>) => void
}) {
  const { data: owned = [] } = useQuery({ queryKey: ['owned', userId, game], queryFn: () => getOwnedCards(userId, game) })
  const [search, setSearch] = useState('')
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? owned.filter(o => o.card.name.toLowerCase().includes(q)).slice(0, 12) : []
  }, [owned, search])

  const add = (o: OwnedCard, condition: string, max: number) => {
    setGives(prev => ({ ...prev, [key(o.cardId, condition)]: { cardId: o.cardId, name: o.card.name, image: o.card.images.small, condition, quantity: 1, max } }))
    setSearch('')
  }
  const remove = (k: string) => setGives(prev => { const n = { ...prev }; delete n[k]; return n })
  const setQty = (k: string, q: number) => setGives(prev => ({ ...prev, [k]: { ...prev[k], quantity: Math.max(1, Math.min(prev[k].max, q)) } }))

  return (
    <div className="give-picker">
      {Object.entries(gives).map(([k, g]) => (
        <div className="offer-line" key={k}>
          <img src={g.image} alt="" />
          <span>{g.name}<small>{condLabel(g.condition)}</small></span>
          {g.max > 1 && <input type="number" min={1} max={g.max} value={g.quantity} onChange={e => setQty(k, Number(e.target.value) || 1)} />}
          <button onClick={() => remove(k)} aria-label="Remove">✕</button>
        </div>
      ))}
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="+ Add cards from your collection to trade…" />
      {matches.map(o => (
        <div className="give-match" key={o.cardId}>
          <img src={o.card.images.small} alt="" />
          <span>{o.card.name}<small>#{o.card.number}</small></span>
          <div>
            {o.conditions.filter(c => c.quantity > 0 && !gives[key(o.cardId, c.condition)]).map(c => (
              <button key={c.condition} onClick={() => add(o, c.condition, c.quantity)}>{condLabel(c.condition)} ×{c.quantity}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
