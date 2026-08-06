/**
 * BinderViewPage — one binder shown as a flipbook.
 *
 * HOW IT WORKS
 *   `spread` is the current two-page view (0 = cover, lastSpread = back
 *   cover, everything between is a real page pair). Turning a page sets
 *   `turn` (direction + the spread turned FROM) so the outgoing page can
 *   render on the back of the animated flipping leaf; `turn` clears
 *   itself via a timeout matched to the CSS animation duration (TURN_MS).
 *
 *   Slot placement and rename are both optimistic: the screen updates
 *   immediately, and only rolls back if the server call fails.
 *
 *   Pocket size is fixed at binder creation by the backend's own rules —
 *   `resize` still exists because the buttons show the current size and
 *   changing it re-flows card positions across pages (slots keep their
 *   index, pages are just recomputed from a new pocketSize).
 *
 * USED BY: App (route "/binder/:binderId")
 */

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getBinder, setSlot as apiSetSlot, updateBinder } from '../api/binders'
import { getCards, getSets } from '../api/cards'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import { HeaderNav } from '../components/HeaderNav'
import { usePreview } from '../components/CardPreview'
import { basePrice } from '../lib/conditions'
import type { Binder, Card, PocketSize } from '../types'

/** Grid geometry per pocket size: columns × rows and the CSS grid class. */
const CFG: Record<PocketSize, { c: number; r: number; cls: string; num: number; rings: number }> = {
  Nine:   { c: 3, r: 3, cls: 'g3x3', num: 9,  rings: 8 },
  Four:   { c: 2, r: 2, cls: 'g2x2', num: 4,  rings: 6 },
  Twelve: { c: 4, r: 3, cls: 'g4x3', num: 12, rings: 8 },
}

/** How many content pages this binder always has, filled or not. */
const TOTAL_PAGES = 40

/** Must match the CSS flip-animation duration. */
const TURN_MS = 600

/** A card placed in a sleeve, cached so this page doesn't need to re-fetch it. */
interface SlotCard { cardId: string; cardName: string; imageUrl: string }

/** Sizes one binder page from the current window, so a two-page spread always fits. */
function calcPageSize(): { pw: number; ph: number } {
  const W = window.innerWidth
  const H = window.innerHeight - 50 // minus the top bar

  const aspect = 0.72 // page slightly taller than wide, like a real card

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
  const preview = usePreview()

  const [binder, setBinder] = useState<Binder | null>(null)

  // Sparse: only positions that actually have a card get an entry.
  const [slots, setSlots] = useState<Record<number, SlotCard>>({})

  const [name, setName] = useState('')
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [spread, setSpread] = useState(0)
  const [turn, setTurn] = useState<{ dir: 1 | -1; from: number } | null>(null)
  const [pageSize, setPageSize] = useState(calcPageSize)

  const [activeSlot, setActiveSlot] = useState<number | null>(null)
  const [pickSetId, setPickSetId] = useState('')
  const [pickSearch, setPickSearch] = useState('')
  const [hoverCard, setHoverCard] = useState<Card | null>(null)

  useEffect(() => { if (!user) navigate('/') }, [user, navigate])

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

  // Defaults to "Nine" until the real binder loads — see the early return below.
  const cfg = CFG[binder?.pocketSize ?? 'Nine']
  const perPage = cfg.c * cfg.r
  const lastSpread = TOTAL_PAGES / 2 + 1

  useEffect(() => {
    const onResize = () => setPageSize(calcPageSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeSlot !== null) { if (e.key === 'Escape') setActiveSlot(null); return }
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSlot, next, prev])

  const rename = (value: string) => {
    setName(value)
    if (nameTimer.current) clearTimeout(nameTimer.current)
    nameTimer.current = setTimeout(() => {
      if (user && value.trim()) updateBinder(user.id, binderId, { name: value.trim() }).catch(() => toast('Rename failed.'))
    }, 500)
  }

  const resize = (size: PocketSize) => {
    if (!user || !binder || binder.pocketSize === size) return

    const prevSize = binder.pocketSize
    setBinder({ ...binder, pocketSize: size })
    setSpread(0) // re-flow moves cards between pages — start from the cover

    updateBinder(user.id, binderId, { pocketSize: size }).catch(() => {
      setBinder(b => (b ? { ...b, pocketSize: prevSize } : b))
      toast('Could not change pocket size.')
    })
  }

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

  const renderContentPage = (page: number) => {
    const side = page % 2 === 0 ? 'lp' : 'rp'
    const base = page * perPage
    return (
      <div className={`pg ${side}`}>
        <div className={`cgrid ${cfg.cls}`}>
          {Array.from({ length: perPage }, (_, s) => {
            const idx = base + s
            const card = slots[idx]
            return (
              <div key={idx} className={'slv' + (card ? '' : ' mt')} onClick={() => openPicker(idx)}>
                {card && (
                  <img
                    src={card.imageUrl} alt={card.cardName} loading="lazy"
                    onMouseEnter={() => preview.show(card.imageUrl)}
                    onMouseLeave={() => preview.hide()}
                  />
                )}
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

  const facesFor = (s: number): { left: React.ReactNode; right: React.ReactNode } => {
    if (s === 0) return { left: null, right: frontCover }
    if (s === lastSpread) return { left: endCover, right: null }
    return { left: renderContentPage((s - 1) * 2), right: renderContentPage((s - 1) * 2 + 1) }
  }

  const cur = facesFor(spread)
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
            onClick={() => resize(s)}
          >
            {CFG[s].num}-Pocket
          </button>
        ))}
        <span id="pglbl">{pageLabel}</span>
        <HeaderNav />
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
                <div className="leaf-face front">{turn.dir === 1 ? from.right : from.left}</div>
                <div className="leaf-face back">{turn.dir === 1 ? cur.left : cur.right}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div id="picker" className={activeSlot !== null ? 'open' : ''} onClick={e => { if (e.target === e.currentTarget) setActiveSlot(null) }}>
        <div id="pbox">
          <div className="ph">
            <h3>{activeSlot !== null && slots[activeSlot] ? 'Replace or Remove' : 'Place a Card'}</h3>

            {activeSlot !== null && slots[activeSlot] && (
              <button
                className="px"
                style={{ width: 'auto', padding: '0 12px', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)' }}
                onClick={() => place(null)}
              >
                ✕ Remove card
              </button>
            )}
            <button className="px" onClick={() => setActiveSlot(null)}>✕</button>
          </div>
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
                    onMouseEnter={() => { setHoverCard(c); preview.show(c.images?.large || c.images?.small) }}
                    onMouseLeave={() => { setHoverCard(null); preview.hide() }}
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
      {preview.overlay}
    </div>
  )
}
