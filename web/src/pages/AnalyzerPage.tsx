/**
 * FILE: AnalyzerPage.tsx
 * LOCATION: src/pages/AnalyzerPage.tsx
 *
 * PURPOSE:
 *   The Trade Analyzer — a 1:1 port of the old analyzer.html. Two
 *   columns (You Give / You Get), a per-card condition pill row and
 *   1st Edition toggle, the live verdict banner with totals and a
 *   lopsided-trade warning, and the Add-a-Card search modal (name
 *   search across all sets, optional set filter, or browse a whole
 *   set when no name is typed).
 *
 *   Pricing: per-condition prices come straight off the card's API
 *   prices; 1st Edition applies the old 1.3× estimate on top.
 *
 * IMPORTS EXPLAINED:
 *   searchCards/getCards/getSets — card lookup endpoints
 *   condPrice                    — condition pricing shared with the tracker
 *   useUser                      — shows the badge + collection hint panel
 *
 * USED BY: App (route "/analyzer")
 * DEPENDS ON: api/cards, api/collection, lib/conditions, styles/analyzer.css
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCards, getSets, searchCards } from '../api/cards'
import { getOwnedCards } from '../api/collection'
import { useUser } from '../context/UserContext'
import { HeaderNav } from '../components/HeaderNav'
import { CONDS, condPrice, type Cond } from '../lib/conditions'
import type { Card } from '../types'

/** Which column a card sits in. */
type Side = 'give' | 'get'

/** One card in the trade, with its chosen condition and edition. */
interface TradeItem {
  card: Card
  setName: string
  cond: Cond
  firstEd: boolean
}

/** Old page's estimate: 1st Edition copies fetch roughly 1.3× the base. */
const FIRST_ED_MULT = 1.3

/** Dollar value of one trade item under its chosen condition/edition. */
const itemPrice = (item: TradeItem): number => {
  const base = condPrice(item.card, item.cond)
  return item.firstEd ? +(base * FIRST_ED_MULT).toFixed(2) : base
}

export function AnalyzerPage() {
  const { user } = useUser()

  // ── Trade state ─────────────────────────────────────────────────────────
  const [give, setGive] = useState<TradeItem[]>([])
  const [get, setGet] = useState<TradeItem[]>([])
  // Which side the modal is adding to; null = closed.
  const [modalSide, setModalSide] = useState<Side | null>(null)

  // ── Search modal state ──────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [filterSetId, setFilterSetId] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searchMsg, setSearchMsg] = useState('Type to search for a card')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  // Full owned-card list for the Quick Add panel.
  const { data: owned = [] } = useQuery({
    queryKey: ['owned', user?.id], queryFn: () => getOwnedCards(user!.id), enabled: !!user,
  })

  // Which side the collection panel's one-click add targets.
  const [collSide, setCollSide] = useState<Side>('give')
  // Filter string inside the collection panel.
  const [collFilter, setCollFilter] = useState('')

  // ── Search (debounced 350 ms, like the old page) ────────────────────────
  useEffect(() => {
    if (modalSide === null) return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      const q = query.trim()
      if (!q && !filterSetId) { setResults([]); setSearchMsg('Type a card name to search'); return }
      if (q && q.length < 2) { setResults([]); setSearchMsg('Keep typing…'); return }
      setResults([]); setSearchMsg('Searching…')
      try {
        // Name search across all sets — or browse the chosen set when no name.
        let cards = q ? await searchCards(q) : await getCards(filterSetId)
        if (q && filterSetId) cards = cards.filter(c => c.setId === filterSetId)
        if (cards.length === 0) { setSearchMsg('No cards found — try a different name or set'); return }
        setResults(cards.slice(0, 60))
        setSearchMsg('')
      } catch {
        setSearchMsg('Search failed — check your connection')
      }
    }, 350)
  }, [query, filterSetId, modalSide])

  const openModal = (side: Side) => {
    setModalSide(side)
    setQuery('')
    setResults([])
    setSearchMsg('Type to search for a card')
    setTimeout(() => inputRef.current?.focus(), 50)
  }
  const closeModal = () => setModalSide(null)

  // Escape closes the modal — like the old page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Mutations on the two sides ──────────────────────────────────────────
  const addCard = (card: Card) => {
    const item: TradeItem = { card, setName: setName.get(card.setId) ?? card.setId, cond: 'NM', firstEd: false }
    if (modalSide === 'give') setGive(s => [...s, item])
    else setGet(s => [...s, item])
    closeModal()
  }

  const addCardToSide = (side: Side, card: Card) => {
    const item: TradeItem = { card, setName: setName.get(card.setId) ?? card.setId, cond: 'NM', firstEd: false }
    if (side === 'give') setGive(s => [...s, item])
    else setGet(s => [...s, item])
  }
  const update = (side: Side, idx: number, patch: Partial<TradeItem>) => {
    const setter = side === 'give' ? setGive : setGet
    setter(items => items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  const remove = (side: Side, idx: number) => {
    const setter = side === 'give' ? setGive : setGet
    setter(items => items.filter((_, i) => i !== idx))
  }

  // ── Verdict — port of the old updateVerdict() ───────────────────────────
  const giveTotal = give.reduce((s, i) => s + itemPrice(i), 0)
  const getTotal = get.reduce((s, i) => s + itemPrice(i), 0)
  const diff = getTotal - giveTotal // positive = you receive more
  const pct = giveTotal > 0 ? Math.abs((diff / giveTotal) * 100) : 0
  const empty = give.length === 0 && get.length === 0
  const fair = !empty && (Math.abs(diff) < 0.5 || (giveTotal > 0 && pct < 3))

  const verdictClass = empty ? '' : fair ? 'fair' : diff < 0 ? 'giving' : 'getting'
  const verdictIcon = empty ? '⚖️' : fair ? '✅' : diff < 0 ? '⚠️' : '🎉'
  const verdictTitle = empty
    ? 'Add cards to both sides to analyze the trade'
    : fair ? 'Fair Trade'
    : diff < 0 ? `You're giving $${Math.abs(diff).toFixed(2)} more than you're getting`
    : `You're getting $${diff.toFixed(2)} more than you're giving`
  const verdictDesc = empty
    ? 'Select the condition for each card — prices update automatically'
    : fair ? 'Both sides are within $0.50 of each other. This is a solid deal.'
    : diff < 0 ? `Your cards are worth ${pct.toFixed(0)}% more. Make sure you're ok with this difference.`
    : `You're receiving ${pct.toFixed(0)}% more value. Good deal for you!`
  const showWarn = !empty && !fair && diff < 0 && pct > 15

  // ── One trade column ────────────────────────────────────────────────────
  const renderColumn = (side: Side, items: TradeItem[]) => {
    const total = items.reduce((s, i) => s + itemPrice(i), 0)
    return (
      <div className="trade-col">
        <div className="col-head">
          <span className={`col-badge ${side === 'give' ? 'giving' : 'getting'}`}>
            {side === 'give' ? 'You Give' : 'You Get'}
          </span>
          <h3>{items.length === 0 ? 'Nothing yet' : `${items.length} card${items.length !== 1 ? 's' : ''}`}</h3>
          <span className="col-total">{total > 0 ? '$' + total.toFixed(2) : ''}</span>
        </div>
        <div className="col-cards">
          {items.length === 0 && (
            <div className="empty-col">
              <div className="ei">{side === 'give' ? '📤' : '📥'}</div>
              {side === 'give' ? "Cards you're offering" : "Cards you're receiving"}
            </div>
          )}
          {items.map((item, i) => {
            const price = itemPrice(item)
            return (
              <div className="tcard" key={`${item.card.id}-${i}`}>
                {item.card.images?.small
                  ? <img className="tcard-img" src={item.card.images.small} alt={item.card.name} />
                  : <div className="tcard-img" />}
                <div className="tcard-info">
                  <div className="tcard-name">{item.card.name}</div>
                  <div className="tcard-set">#{item.card.number} · {item.setName}</div>
                  <div className="tcard-prices">
                    {CONDS.map(cn => (
                      <div
                        key={cn}
                        className={`tcard-cond ${cn}${item.cond === cn ? ' sel' : ''}`}
                        title={`${cn}: ${condPrice(item.card, cn) > 0 ? '$' + condPrice(item.card, cn).toFixed(2) : '—'}`}
                        onClick={() => update(side, i, { cond: cn })}
                      >
                        {cn}
                      </div>
                    ))}
                  </div>
                  <label className={'fed-toggle' + (item.firstEd ? ' active' : '')}>
                    <input
                      type="checkbox" checked={item.firstEd}
                      onChange={e => update(side, i, { firstEd: e.target.checked })}
                    />
                    1st Edition {item.firstEd && <span style={{ color: '#fbbf24' }}>★</span>}
                  </label>
                </div>
                <div className="tcard-val">{price > 0 ? '$' + price.toFixed(2) : '—'}</div>
                <button className="tcard-rm" title="Remove" onClick={() => remove(side, i)}>✕</button>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '0 10px 10px' }}>
          <button className="add-btn" onClick={() => openModal(side)}>+ Add a card</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-analyzer">
      <div id="bar">
        <span className="bar-title">Trade <span>Analyzer</span></span>
        <div className="gap" />
        {user && <span className="bar-user">{user.username}</span>}
        <HeaderNav />
      </div>

      <div id="page">
        {/* Verdict */}
        <div id="verdict" className={verdictClass}>
          <div className="verdict-icon">{verdictIcon}</div>
          <div className="verdict-text">
            <h2>{verdictTitle}</h2>
            <p>{verdictDesc}</p>
          </div>
          <div className="verdict-bar">
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>You Give</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{giveTotal > 0 ? '$' + giveTotal.toFixed(2) : '—'}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>You Get</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{getTotal > 0 ? '$' + getTotal.toFixed(2) : '—'}</div>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 2 }}>Difference</div>
                <div className={'verdict-diff ' + (empty || fair ? 'zero' : diff < 0 ? 'neg' : 'pos')}>
                  {empty ? '—' : fair ? '~Even' : (diff < 0 ? '-' : '+') + '$' + Math.abs(diff).toFixed(2)}
                </div>
                <div className="verdict-pct">
                  {!empty && !fair && (diff < 0 ? `You overpay by ${pct.toFixed(0)}%` : `You get ${pct.toFixed(0)}% more value`)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Trade columns */}
        <div id="cols">
          {renderColumn('give', give)}
          <div id="vs">
            <div className="vs-circle">VS</div>
            <div className="vs-arrow">⇄</div>
          </div>
          {renderColumn('get', get)}
        </div>

        {/* Lopsided-trade warning */}
        <div className={'warn-banner' + (showWarn ? ' show' : '')}>
          ⚠️ <strong>Heads up:</strong> You're giving significantly more than you're receiving.
          Make sure the other party isn't taking advantage. Always verify card values on TCGPlayer before trading.
        </div>

        {/* Collection panel — shown once the user owns cards */}
        {user && owned.length > 0 && (() => {
          const q = collFilter.trim().toLowerCase()
          const visible = q
            ? owned.filter(o =>
                o.card.name.toLowerCase().includes(q) ||
                o.card.number.toLowerCase().includes(q)
              )
            : owned
          return (
            <div id="collPanel" className="show">
              <div className="cp-head">
                <span>Quick Add from Your Collection</span>
                <span className="cp-side-toggle">
                  <button
                    className={'cp-side-btn' + (collSide === 'give' ? ' active' : '')}
                    onClick={() => setCollSide('give')}
                  >Give</button>
                  <button
                    className={'cp-side-btn' + (collSide === 'get' ? ' active' : '')}
                    onClick={() => setCollSide('get')}
                  >Get</button>
                </span>
                <input
                  className="cp-filter"
                  placeholder="Filter…"
                  value={collFilter}
                  onChange={e => setCollFilter(e.target.value)}
                />
              </div>
              <div className="cp-grid">
                {visible.slice(0, 48).map(o => (
                  <div
                    key={o.cardId}
                    className="cp-card"
                    title={`${o.card.name} — click to add to ${collSide}`}
                    onClick={() => addCardToSide(collSide, o.card)}
                  >
                    {o.card.images?.small
                      ? <img src={o.card.images.small} alt={o.card.name} />
                      : <span className="cp-placeholder">🃏</span>
                    }
                  </div>
                ))}
                {visible.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: 12, gridColumn: '1/-1' }}>
                    No owned cards match "{collFilter}"
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* Add-a-card search modal */}
      <div id="modal" className={modalSide !== null ? 'open' : ''} onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
        <div id="mbox">
          <div className="mh">
            <h3>{modalSide === 'give' ? "Add Card You're Giving" : "Add Card You're Getting"}</h3>
            <button className="mx" onClick={closeModal}>✕</button>
          </div>
          <div className="msearch">
            <input
              ref={inputRef} placeholder="Search by name e.g. Charizard ex…"
              value={query} onChange={e => setQuery(e.target.value)}
            />
            <select value={filterSetId} onChange={e => setFilterSetId(e.target.value)}>
              <option value="">All sets (filter optional)</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div id="mresults">
            {searchMsg && <div id="mloading">{searchMsg}</div>}
            {!searchMsg && results.map(c => {
              const price = condPrice(c, 'NM')
              return (
                <div className="mcard" key={c.id} onClick={() => addCard(c)}>
                  {c.images?.small
                    ? <img src={c.images.small} alt={c.name} loading="lazy" />
                    : <div style={{ width: 36, height: 50, background: 'var(--surface2)', borderRadius: 4, flexShrink: 0 }} />}
                  <div className="mcard-info">
                    <div className="mcard-name">{c.name}</div>
                    <div className="mcard-meta">#{c.number} · {setName.get(c.setId) ?? c.setId}{c.rarity ? ' · ' + c.rarity : ''}</div>
                  </div>
                  <div className="mcard-price">{price > 0 ? '$' + price.toFixed(2) : '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
