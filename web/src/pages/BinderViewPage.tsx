/**
 * FILE: BinderViewPage.tsx
 * LOCATION: src/pages/BinderViewPage.tsx
 *
 * PURPOSE:
 *   One binder, rendered as the old binder.html flipbook: indigo spine
 *   with rings, a two-page spread of card sleeves, cover and END pages,
 *   arrow/keyboard page turns with a 3D flip, inline rename, and the
 *   "Place a Card" picker (set select, search, hover info panel, clear).
 *
 *   The old page used jQuery + turn.js; this port reproduces the look
 *   and the page-turn with plain React + CSS (no jQuery). One behavior
 *   change forced by the new backend: pocket size is fixed at creation,
 *   so the size buttons show the current size and explain when clicked.
 *
 * IMPORTS EXPLAINED:
 *   useParams      — binderId from the /binder/:binderId route
 *   getBinder…     — binder + slot API (Scala backend)
 *   getSets/Cards  — picker data
 *   basePrice      — headline NM price for the picker info pills
 *
 * USED BY: App (route "/binder/:binderId")
 * DEPENDS ON: api/binders, api/cards, lib/conditions, styles/binder.css
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getBinder, setSlot as apiSetSlot, updateBinder } from '../api/binders'
import { getCards, getSets } from '../api/cards'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { basePrice } from '../lib/conditions'
import type { Binder, Card, PocketSize } from '../types'

/** Grid geometry per pocket size: columns × rows and the CSS grid class. */
const CFG: Record<PocketSize, { c: number; r: number; cls: string; num: number; rings: number }> = {
  Nine:   { c: 3, r: 3, cls: 'g3x3', num: 9,  rings: 8 },
  Four:   { c: 2, r: 2, cls: 'g2x2', num: 4,  rings: 6 },
  Twelve: { c: 4, r: 3, cls: 'g4x3', num: 12, rings: 8 },
}

/** Content pages in the book — same count as the old page. */
const TOTAL_PAGES = 40

/** Milliseconds one page turn takes; matches the CSS transition below. */
const TURN_MS = 600

/** A card placed in a sleeve, as the page renders it. */
interface SlotCard { cardId: string; cardName: string; imageUrl: string }

/**
 * FUNCTION: calcPageSize
 * PURPOSE: Page dimensions for the current window — port of the old
 *          calcSize(). One page is slightly taller than wide (0.72
 *          aspect); the spread must fit beside the arrows and spine.
 * @returns {pw, ph} — one page's width and height in pixels
 */
function calcPageSize(): { pw: number; ph: number } {
  const W = window.innerWidth
  const H = window.innerHeight - 50 // minus the top bar
  const aspect = 0.72               // page slightly taller than wide
  let ph = Math.min(H * 0.88, 600)
  let pw = ph * aspect
  if (pw * 2 + 28 > W - 120) { pw = (W - 120 - 28) / 2; ph = pw / aspect }
  return { pw: Math.floor(pw), ph: Math.floor(ph) }
}

export function BinderViewPage() {
  const { user } = useUser()
  const toast = useToast()
  const navigate = useNavigate()
  const { binderId = '' } = useParams()

  // ── Binder state ────────────────────────────────────────────────────────
  const [binder, setBinder] = useState<Binder | null>(null)
  // Local slot map: slotIndex → card. The backend stores slots sparsely.
  const [slots, setSlots] = useState<Record<number, SlotCard>>({})
  const [name, setName] = useState('')
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── View state ──────────────────────────────────────────────────────────
  // spread 0 = closed (front cover alone); 1…TOTAL/2 = content; last+1 = END.
  const [spread, setSpread] = useState(0)
  // During a turn: which direction and which spread we started from.
  const [turn, setTurn] = useState<{ dir: 1 | -1; from: number } | null>(null)
  // Page dimensions — computed up front, recomputed only on window resize.
  const [pageSize, setPageSize] = useState(calcPageSize)

  // ── Picker state ────────────────────────────────────────────────────────
  const [activeSlot, setActiveSlot] = useState<number | null>(null)
  const [pickSetId, setPickSetId] = useState('')
  const [pickSearch, setPickSearch] = useState('')
  const [hoverCard, setHoverCard] = useState<Card | null>(null)

  useEffect(() => { if (!user) navigate('/') }, [user, navigate])

  // Load the binder + its slots once.
  useEffect(() => {
    if (!user) return
    getBinder(user.id, binderId)
      .then(b => {
        setBinder(b)
        setName(b.name)
        const m: Record<number, SlotCard> = {}
        for (const s of b.slots) {
          if (s.cardId) m[s.slotIndex] = { cardId: s.cardId, cardName: s.cardName ?? '', imageUrl: s.imageUrl ?? '' }
        }
        setSlots(m)
      })
      .catch(() => { toast('Could not load that binder.'); navigate('/shelf') })
  }, [user, binderId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cfg = CFG[binder?.pocketSize ?? 'Nine']
  const perPage = cfg.c * cfg.r
  const lastSpread = TOTAL_PAGES / 2 + 1 // the END-cover view

  // ── Page sizing — recompute on window resize ────────────────────────────
  useEffect(() => {
    const onResize = () => setPageSize(calcPageSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Turning ─────────────────────────────────────────────────────────────
  const turning = turn !== null
  const next = useCallback(() => {
    if (turning) return
    setSpread(s => {
      if (s >= lastSpread) return s
      setTurn({ dir: 1, from: s })
      setTimeout(() => setTurn(null), TURN_MS)
      return s + 1
    })
  }, [turning, lastSpread])
  const prev = useCallback(() => {
    if (turning) return
    setSpread(s => {
      if (s <= 0) return s
      setTurn({ dir: -1, from: s })
      setTimeout(() => setTurn(null), TURN_MS)
      return s - 1
    })
  }, [turning])

  // Arrow keys turn pages; Escape closes the picker — like the old page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeSlot !== null) { if (e.key === 'Escape') setActiveSlot(null); return }
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSlot, next, prev])

  // ── Rename (debounced PUT, like the old oninput save) ───────────────────
  const rename = (value: string) => {
    setName(value)
    if (nameTimer.current) clearTimeout(nameTimer.current)
    nameTimer.current = setTimeout(() => {
      if (user && value.trim()) updateBinder(user.id, binderId, { name: value.trim() }).catch(() => toast('Rename failed.'))
    }, 500)
  }

  // ── Picker data ─────────────────────────────────────────────────────────
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })
  const { data: pickCards = [], isLoading: pickLoading } = useQuery({
    queryKey: ['cards', pickSetId], queryFn: () => getCards(pickSetId), enabled: !!pickSetId,
  })
  const pickFiltered = useMemo(() => {
    const q = pickSearch.toLowerCase().trim()
    return pickCards.filter(c => !q || c.name.toLowerCase().includes(q) || c.number.includes(q))
  }, [pickCards, pickSearch])

  const openPicker = (slotIndex: number) => { setActiveSlot(slotIndex); setPickSearch(''); setHoverCard(null) }

  /** Places a card in the active sleeve — or clears it when card is null. */
  const place = (card: Card | null) => {
    if (activeSlot === null || !user) return
    const idx = activeSlot
    setActiveSlot(null)
    const prevVal = slots[idx]
    // Optimistic local update, then persist; roll back on failure.
    setSlots(m => {
      const n = { ...m }
      if (card) n[idx] = { cardId: card.id, cardName: card.name, imageUrl: card.images?.small ?? '' }
      else delete n[idx]
      return n
    })
    apiSetSlot(user.id, binderId, idx, card
      ? { cardId: card.id, cardName: card.name, imageUrl: card.images?.small }
      : {},
    ).catch(() => {
      setSlots(m => {
        const n = { ...m }
        if (prevVal) n[idx] = prevVal; else delete n[idx]
        return n
      })
      toast('Could not save that slot.')
    })
  }

  // ── Page rendering ──────────────────────────────────────────────────────
  /** One content page (0-based) full of sleeves. */
  const renderContentPage = (page: number) => {
    const side = page % 2 === 0 ? 'lp' : 'rp' // even pages sit on the left
    const base = page * perPage
    return (
      <div className={`pg ${side}`}>
        <div className={`cgrid ${cfg.cls}`}>
          {Array.from({ length: perPage }, (_, s) => {
            const idx = base + s
            const card = slots[idx]
            return (
              <div key={idx} className={'slv' + (card ? '' : ' mt')} onClick={() => openPicker(idx)}>
                {card && <img src={card.imageUrl} alt={card.cardName} loading="lazy" />}
              </div>
            )
          })}
        </div>
        <div className="pgn">Pg {page + 1}</div>
      </div>
    )
  }

  const frontCover = (
    <div className="cover">
      <div className="cover-ball" />
      <div className="cover-title">{name || 'My Binder'}</div>
    </div>
  )
  const endCover = (
    <div className="cover" style={{ background: 'linear-gradient(150deg,#1e1b4b,#2a2760)' }}>
      <div className="cover-title" style={{ fontSize: 12, opacity: 0.4 }}>END</div>
    </div>
  )

  /** Left/right faces for a given spread number. */
  const facesFor = (s: number): { left: React.ReactNode; right: React.ReactNode } => {
    if (s === 0) return { left: null, right: frontCover }
    if (s === lastSpread) return { left: endCover, right: null }
    return { left: renderContentPage((s - 1) * 2), right: renderContentPage((s - 1) * 2 + 1) }
  }

  const cur = facesFor(spread)
  // While turning, the leaf that rotates shows the page we came from on its
  // front and the page we arrived at on its back.
  const from = turn ? facesFor(turn.from) : null

  const pageLabel =
    spread === 0 ? 'Cover'
    : spread === lastSpread ? 'Back cover'
    : `Pages ${spread * 2 - 1}–${spread * 2}`

  if (!user || !binder) return <div className="page-binder" />

  const { pw, ph } = pageSize

  return (
    <div className="page-binder">
      <div id="bar">
        <Link className="back" to="/shelf">← Binders</Link>
        <input id="bname" value={name} onChange={e => rename(e.target.value)} />
        <div className="sp" />
        {(Object.keys(CFG) as PocketSize[]).map(s => (
          <button
            key={s} className={'sz' + (binder.pocketSize === s ? ' on' : '')}
            onClick={() => {
              if (binder.pocketSize !== s) toast('Pocket size is set when a binder is created.')
            }}
          >
            {CFG[s].num}-Pocket
          </button>
        ))}
        <span id="pglbl">{pageLabel}</span>
      </div>

      <button className="arr" id="aL" onClick={prev} disabled={spread <= 0 || turning}>‹</button>
      <button className="arr" id="aR" onClick={next} disabled={spread >= lastSpread || turning}>›</button>

      <div id="stage">
        <div id="shell">
          <div id="spine" style={{ height: ph }}>
            {Array.from({ length: cfg.rings }, (_, i) => <div key={i} className="ring" />)}
          </div>
          <div id="book" style={{ width: pw * 2, height: ph }}>
            <div className="leaf-half left" style={{ width: pw }}>{cur.left}</div>
            <div className="leaf-half right" style={{ width: pw }}>{cur.right}</div>
            {turn && from && (
              <div className={`leaf turning-${turn.dir === 1 ? 'fwd' : 'back'}`} style={{ width: pw, height: ph }}>
                {/* front face: the page that is lifting away */}
                <div className="leaf-face front">{turn.dir === 1 ? from.right : from.left}</div>
                {/* back face: the page it reveals on the other side */}
                <div className="leaf-face back">{turn.dir === 1 ? cur.left : cur.right}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Place-a-card picker */}
      <div id="picker" className={activeSlot !== null ? 'open' : ''} onClick={e => { if (e.target === e.currentTarget) setActiveSlot(null) }}>
        <div id="pbox">
          <div className="ph"><h3>Place a Card</h3><button className="px" onClick={() => setActiveSlot(null)}>✕</button></div>
          <div className="pc">
            <select value={pickSetId} onChange={e => setPickSetId(e.target.value)}>
              <option value="">— Choose a set —</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.name} ({s.total})</option>)}
            </select>
            <input
              placeholder="Search name or number…"
              value={pickSearch} onChange={e => setPickSearch(e.target.value)}
            />
          </div>
          <div id="pgrid">
            {!pickSetId && <div id="pmsg">Choose a set above</div>}
            {pickSetId && pickLoading && <div id="pmsg">Loading…</div>}
            {pickSetId && !pickLoading && (
              <>
                <div className="pcd clr" onClick={() => place(null)}>
                  <div className="ci">✕</div><div className="ct">Clear</div>
                </div>
                {pickFiltered.map(c => (
                  <div
                    key={c.id} className="pcd"
                    onClick={() => place(c)}
                    onMouseEnter={() => setHoverCard(c)}
                    onMouseLeave={() => setHoverCard(null)}
                  >
                    {c.images?.small && <img src={c.images.small} alt={c.name} loading="lazy" />}
                  </div>
                ))}
              </>
            )}
          </div>
          <div id="cardInfo" className={hoverCard ? '' : 'empty'}>
            {!hoverCard && <span>Hover a card to see details</span>}
            {hoverCard && (
              <>
                {hoverCard.images?.small && <img id="ciThumb" src={hoverCard.images.small} alt="" style={{ display: 'block' }} />}
                <div id="ciText">
                  <div id="ciName">{hoverCard.name}</div>
                  <div id="ciSub">#{hoverCard.number}{hoverCard.artist ? ` · ${hoverCard.artist}` : ''}</div>
                  <div id="ciPills">
                    {basePrice(hoverCard) > 0 && <span className="cipill price">${basePrice(hoverCard).toFixed(2)} NM</span>}
                    {hoverCard.rarity && <span className="cipill rarity">{hoverCard.rarity}</span>}
                    {hoverCard.artist && <span className="cipill artist">✏ {hoverCard.artist}</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
