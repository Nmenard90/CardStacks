/**
 * FILE: ConventionModePage.tsx
 * LOCATION: src/pages/ConventionModePage.tsx
 *
 * PURPOSE:
 *   Convention Mode MVP. Reuses the existing card search/pricing API and adds
 *   an in-person deal assistant: asking price, condition, suggested offer,
 *   fake-risk checklist, local paid-price reports, and vendor notes.
 *
 *   This first version intentionally stores reports in localStorage so the UI
 *   can be tested before adding backend tables/moderation/trust scoring.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSets, searchCards } from '../api/cards'
import { useUser } from '../context/UserContext'
import { HeaderNav } from '../components/HeaderNav'
import { CONDS, condPrice, type Cond } from '../lib/conditions'
import type { Card, ConventionPriceReport, PaymentType, VendorNote } from '../types'

const REPORT_KEY = 'tcg.convention.priceReports.v1'
const VENDOR_NOTE_KEY = 'tcg.convention.vendorNotes.v1'

const paymentLabels: Record<PaymentType, string> = {
  cash: 'Cash',
  card: 'Card',
  trade: 'Trade',
  trade_credit: 'Trade credit',
  unknown: 'Unknown',
}

const money = (value: number) => value > 0 ? `$${value.toFixed(2)}` : '—'
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function saveJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

function fakeRiskChecklist(card: Card | null, askingPrice: number, claimedCondition: Cond) {
  const name = card?.name.toLowerCase() ?? ''
  const isVintageSignal = ['base', 'charizard', 'blastoise', 'venusaur', 'lugia', '1st edition'].some(x => name.includes(x))
  const isTexturedSignal = ['ex', 'vmax', 'vstar', 'alt art', 'full art', 'secret'].some(x => name.includes(x))
  const checks = [
    'Ask to see clear front and back photos outside the sleeve/top loader.',
    'Compare set number, copyright line, font, HP, energy symbols, and rarity symbol against a verified reference.',
    'Check card back color and print sharpness; washed-out blue or blurry text is a red flag.',
    'Be careful if the seller refuses close-ups, rushes the deal, or only shows one photo.',
  ]
  if (isVintageSignal || askingPrice >= 75) checks.unshift('For vintage/high-value cards, inspect holo pattern, edges, corners, and surface under angled light.')
  if (isTexturedSignal || askingPrice >= 50) checks.push('Modern hits should have the correct raised texture; smooth glossy “texture” is suspicious.')
  if (claimedCondition === 'NM' && askingPrice > 0) checks.push('If the seller claims NM, require corner/back close-ups before paying NM pricing.')
  if (askingPrice > 100) checks.push('For slabs, verify the cert number on the grading company site and compare label/card details.')
  return checks.slice(0, 7)
}

export function ConventionModePage() {
  const { user } = useUser()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searchMsg, setSearchMsg] = useState('Search for a card to start a convention deal check')
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [condition, setCondition] = useState<Cond>('NM')
  const [askingPrice, setAskingPrice] = useState('')
  const [paidPrice, setPaidPrice] = useState('')
  const [booth, setBooth] = useState('')
  const [eventName, setEventName] = useState('')
  const [paymentType, setPaymentType] = useState<PaymentType>('cash')
  const [note, setNote] = useState('')
  const [reports, setReports] = useState<ConventionPriceReport[]>(() => loadJson(REPORT_KEY, []))
  const [vendorNotes, setVendorNotes] = useState<VendorNote[]>(() => loadJson(VENDOR_NOTE_KEY, []))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])

  useEffect(() => saveJson(REPORT_KEY, reports), [reports])
  useEffect(() => saveJson(VENDOR_NOTE_KEY, vendorNotes), [vendorNotes])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    // After picking a card the query is set to its name — use 0ms delay to clear
    // results immediately without re-running the search. All setState calls stay
    // inside the timer callback so there's no synchronous setState in the effect body.
    const isCardSelected = selectedCard !== null && query.trim() === selectedCard.name.trim()
    timer.current = setTimeout(async () => {
      if (isCardSelected) {
        setResults([])
        setSearchMsg('')
        return
      }
      const q = query.trim()
      if (q.length < 2) {
        setResults([])
        setSearchMsg(selectedCard ? '' : 'Search for a card to start a convention deal check')
        return
      }
      setSearchMsg('Searching…')
      try {
        const cards = await searchCards(q)
        setResults(cards.slice(0, 50))
        setSearchMsg(cards.length ? '' : 'No cards found')
      } catch {
        setSearchMsg('Search failed — check your backend connection')
      }
    }, isCardSelected ? 0 : 300)
  }, [query, selectedCard])

  const selectedSetName = selectedCard ? (setName.get(selectedCard.setId) ?? selectedCard.setId) : ''
  const market = selectedCard ? condPrice(selectedCard, condition) : 0
  const ask = Number(askingPrice) || 0
  const paid = Number(paidPrice) || 0
  const reportedForCard = reports.filter(r => r.cardId === selectedCard?.id)
  const paidValues = reportedForCard.map(r => r.paidPrice).filter(v => v > 0).sort((a, b) => a - b)
  const reportedLow = paidValues[0] ?? 0
  const reportedHigh = paidValues[paidValues.length - 1] ?? 0
  const reportedAvg = paidValues.length ? paidValues.reduce((a, b) => a + b, 0) / paidValues.length : 0
  const suggestedOffer = market > 0 ? clamp(market * 0.82, reportedLow || market * 0.7, market * 0.95) : 0
  const walkAway = market > 0 ? market * 1.03 : 0
  const askVsMarket = market > 0 && ask > 0 ? ((ask - market) / market) * 100 : 0

  const riskScore = useMemo(() => {
    if (!selectedCard) return 0
    let score = 18
    if (ask > market * 1.1 && market > 0) score += 15
    if (ask > 75) score += 15
    if (condition === 'NM') score += 10
    // Recompute the count from `reports` (stable state) rather than the derived
    // `reportedForCard` array, so the React Compiler can preserve this memo.
    if (reports.filter(r => r.cardId === selectedCard.id).length < 3) score += 8
    if (!booth.trim()) score += 5
    return clamp(score, 0, 100)
  }, [selectedCard, ask, market, condition, reports, booth])

  const riskLabel = riskScore >= 65 ? 'High' : riskScore >= 40 ? 'Medium' : riskScore > 0 ? 'Low' : '—'
  const checklist = fakeRiskChecklist(selectedCard, ask, condition)

  const selectCard = (card: Card) => {
    setSelectedCard(card)
    setQuery(card.name)
    setResults([])
  }

  const logDeal = () => {
    if (!selectedCard || paid <= 0) return
    const report: ConventionPriceReport = {
      id: crypto.randomUUID(),
      cardId: selectedCard.id,
      cardName: selectedCard.name,
      setName: selectedSetName,
      imageUrl: selectedCard.images?.small,
      condition,
      askingPrice: ask || undefined,
      paidPrice: paid,
      paymentType,
      eventName: eventName.trim() || undefined,
      boothNumber: booth.trim() || undefined,
      note: note.trim() || undefined,
      confidence: 'local',
      createdAt: new Date().toISOString(),
      userId: user?.id,
    }
    setReports(prev => [report, ...prev].slice(0, 60))
    if (booth.trim() || note.trim()) {
      setVendorNotes(prev => [{
        id: crypto.randomUUID(),
        eventName: eventName.trim() || 'Unspecified event',
        boothNumber: booth.trim() || 'Unknown booth',
        note: note.trim() || `Logged ${selectedCard.name} at ${money(paid)}`,
        createdAt: new Date().toISOString(),
      }, ...prev].slice(0, 30))
    }
    setPaidPrice('')
    setNote('')
  }

  const removeReport = (id: string) => {
    setReports(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="page-convention">
      <div className="con-bar">
        <span className="bar-title">Convention <span>Mode</span></span>
        <div className="gap" />
        {user && <span className="bar-user">{user.username}</span>}
        <HeaderNav />
      </div>

      <main className="con-page">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Live card-show decision support</p>
            <h1>Check the deal before you buy.</h1>
            <p className="hero-copy">Search a card, enter the vendor ask, compare it to condition pricing, log what people actually paid, and get a fast fake-risk checklist.</p>
          </div>
          <div className="hero-stats">
            <div><b>{reports.length}</b><span>local reports</span></div>
            <div><b>{vendorNotes.length}</b><span>vendor notes</span></div>
          </div>
        </section>

        <section className="con-grid">
          <div className="panel deal-panel">
            <div className="panel-head">
              <div><p className="eyebrow">Step 1</p><h2>Deal check</h2></div>
              <span className={`risk-pill ${riskLabel.toLowerCase()}`}>Risk: {riskLabel}</span>
            </div>

            <label className="field-label">Card search</label>
            <input className="con-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search e.g. Charizard, Lugia, Gengar…" />
            {(searchMsg || results.length > 0) && !selectedCard && <div className="search-box">{searchMsg && <p>{searchMsg}</p>}</div>}
            {results.length > 0 && (
              <div className="search-results" style={{ maxHeight: 360, overflowY: 'auto' }}>
                {results.map(card => (
                  <button key={card.id} className="result-row" onClick={() => selectCard(card)}>
                    {card.images?.small && <img src={card.images.small} alt={card.name} />}
                    <span><b>{card.name}</b><small>#{card.number} · {setName.get(card.setId) ?? card.setId}</small></span>
                    <strong>{money(condPrice(card, 'NM'))}</strong>
                  </button>
                ))}
              </div>
            )}

            {selectedCard && (
              <div className="selected-card">
                {selectedCard.images?.small && <img src={selectedCard.images.small} alt={selectedCard.name} />}
                <div>
                  <h3>{selectedCard.name}</h3>
                  <p>#{selectedCard.number} · {selectedSetName}{selectedCard.rarity ? ` · ${selectedCard.rarity}` : ''}</p>
                  <button className="link-btn" onClick={() => { setSelectedCard(null); setQuery('') }}>Change card</button>
                </div>
              </div>
            )}

            <div className="form-row">
              <div>
                <label className="field-label">Claimed condition</label>
                <div className="cond-row">
                  {CONDS.map(c => <button key={c} className={condition === c ? 'active' : ''} onClick={() => setCondition(c)}>{c}</button>)}
                </div>
              </div>
              <div>
                <label className="field-label">Vendor asking</label>
                <input className="con-input" inputMode="decimal" value={askingPrice} onChange={e => setAskingPrice(e.target.value)} placeholder="80" />
              </div>
            </div>

            <div className="deal-score">
              <div><span>Market estimate</span><b>{money(market)}</b></div>
              <div><span>Suggested offer</span><b>{money(suggestedOffer)}</b></div>
              <div><span>Walk-away</span><b>{money(walkAway)}</b></div>
            </div>
            {ask > 0 && market > 0 && (
              <p className={askVsMarket > 10 ? 'deal-warning' : askVsMarket < -10 ? 'deal-good' : 'deal-neutral'}>
                Vendor ask is {Math.abs(askVsMarket).toFixed(0)}% {askVsMarket >= 0 ? 'above' : 'below'} the app’s {condition} estimate.
              </p>
            )}
          </div>

          <div className="panel checklist-panel">
            <div className="panel-head"><div><p className="eyebrow">Step 2</p><h2>Fake-risk quick check</h2></div></div>
            <ul className="checklist">
              {checklist.map(item => <li key={item}>{item}</li>)}
            </ul>
            <div className="seller-script">
              <b>Message to seller/vendor</b>
              <p>“Could I see clear front and back photos outside the sleeve, plus close-ups of the corners, holo surface, and any stamp or slab label?”</p>
            </div>
          </div>
        </section>

        <section className="con-grid bottom-grid">
          <div className="panel">
            <div className="panel-head"><div><p className="eyebrow">Step 3</p><h2>Log what was actually paid</h2></div></div>
            <div className="form-row three">
              <div><label className="field-label">Paid price</label><input className="con-input" inputMode="decimal" value={paidPrice} onChange={e => setPaidPrice(e.target.value)} placeholder="65" /></div>
              <div><label className="field-label">Booth / vendor</label><input className="con-input" value={booth} onChange={e => setBooth(e.target.value)} placeholder="Booth B12" /></div>
              <div><label className="field-label">Payment</label><select className="con-input" value={paymentType} onChange={e => setPaymentType(e.target.value as PaymentType)}>{Object.entries(paymentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            </div>
            <div className="form-row">
              <div><label className="field-label">Event</label><input className="con-input" value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Austin Card Show" /></div>
              <div><label className="field-label">Note</label><input className="con-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Accepted cash discount, condition looked LP…" /></div>
            </div>
            <button className="primary-action" disabled={!selectedCard || paid <= 0} onClick={logDeal}>Log paid price</button>
          </div>

          <div className="panel report-summary">
            <div className="panel-head"><div><p className="eyebrow">Crowd price memory</p><h2>{selectedCard ? selectedCard.name : 'Select a card'}</h2></div></div>
            <div className="deal-score compact">
              <div><span>Reports</span><b>{reportedForCard.length}</b></div>
              <div><span>Paid range</span><b>{reportedLow ? `${money(reportedLow)}–${money(reportedHigh)}` : '—'}</b></div>
              <div><span>Average</span><b>{money(reportedAvg)}</b></div>
            </div>
            <p className="muted-note">MVP uses local reports only. Later these can become trusted, event-verified community reports with anti-bot weighting.</p>
          </div>
        </section>

        <section className="panel history-panel">
          <div className="panel-head"><div><p className="eyebrow">Recent activity</p><h2>Local convention log</h2></div></div>
          <div className="history-list">
            {reports.length === 0 && <p className="empty-state">No deals logged yet.</p>}
            {reports.slice(0, 10).map(r => (
              <div className="history-row" key={r.id}>
                {r.imageUrl && <img src={r.imageUrl} alt={r.cardName} />}
                <div><b>{r.cardName}</b><small>{r.condition} · {r.setName}{r.boothNumber ? ` · ${r.boothNumber}` : ''}{r.eventName ? ` · ${r.eventName}` : ''}</small>{r.note && <p>{r.note}</p>}</div>
                <strong>{money(r.paidPrice)}</strong>
                <button className="link-btn" title="Remove this entry" onClick={() => removeReport(r.id)}>✕</button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
