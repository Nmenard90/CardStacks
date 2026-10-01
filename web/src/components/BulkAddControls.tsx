/**
 * The Bulk Add entry form — set picker, condition, copies per add, 1st Ed
 * (early WotC sets only), add-by-number box and name search dropdown.
 * Stateless about where cards go: every add is reported through `onAdd`,
 * so Bulk Add can put it in its unsaved session and a storage box can put
 * it straight into that box, with one identical form in both places.
 *
 * USED BY: BulkAddPage, SpacesLivePage (BoxInventory)
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getCards, getSets, searchCards } from '../api/cards'
import { buildSetTotals, narrowByCollectorNumber } from '../lib/cardSearch'
import { CONDS, condPrice, hasFirstEdition } from '../lib/conditions'
import { SetSelector, ALL_SETS } from './SetSelector'
import { useToast } from './Toast'
import type { PreviewOpts } from './CardPreview'
import type { Card } from '../types'

interface Props {
  /** One add: `step` copies of `card` under condition key `condKey`
   *  (e.g. "NM", or "NM 1st Ed" for a genuine 1st Edition set). */
  onAdd: (card: Card, condKey: string, step: number) => void
  /** How many of a card are already where this form adds to — shown next
   *  to each search result, e.g. "×3 in session" / "×3 in this box". */
  have?: (cardId: string) => number
  haveLabel?: string
  preview: { show: (src: string, opts?: PreviewOpts) => void; hide: () => void }
}

/**
 * Strips leading zeros from the trailing digit run of a collector number,
 * keeping any letter prefix — "007" -> "7", "SWSH001" -> "SWSH1", "GG01"
 * -> "GG1". A number that doesn't fit that shape (like "7a", which has a
 * letter AFTER the digits) is left unchanged, which is what keeps "7a"
 * from ever matching "7".
 */
function stripLeadingZeros(number: string): string {
  return number.replace(/^([a-z]*)0*(\d+)$/, '$1$2')
}

/**
 * Does a card's printed number match what the user typed? Matches
 * exactly (ignoring case), or with leading zeros ignored, so "007"
 * matches "7" and "SWSH001" matches "SWSH1". Never matches "7" to "7a".
 */
function numberMatches(cardNumber: string, typed: string): boolean {
  const a = cardNumber.trim().toLowerCase()
  const b = typed.trim().toLowerCase()
  if (!b) return false
  if (a === b) return true
  return stripLeadingZeros(a) === stripLeadingZeros(b)
}

// Scoped under .bulk-controls so the form looks the same on any page.
const STYLE = `
.bulk-controls .bulk-search-wrap{position:relative;flex:1;min-width:240px}
.bulk-controls .bulk-search{width:100%;font-size:15px;padding:11px 14px}
.bulk-controls .bulk-results{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;
  max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:14px;
  background:#11131c;box-shadow:0 18px 40px rgba(0,0,0,.45)}
.bulk-controls .brow{width:100%;border:0;border-bottom:1px solid var(--border);background:transparent;
  color:var(--text);padding:9px 12px;display:flex;align-items:center;gap:11px;text-align:left;cursor:pointer}
.bulk-controls .brow:last-child{border-bottom:0}
.bulk-controls .brow:hover,.bulk-controls .brow.hi{background:rgba(255,255,255,.07)}
.bulk-controls .brow img{width:38px;height:52px;object-fit:cover;border-radius:5px;background:#0008}
.bulk-controls .brow .bi{flex:1;min-width:0}
.bulk-controls .brow .bi b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bulk-controls .brow .bi small{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.bulk-controls .brow .bp{color:var(--green);font-weight:700;font-size:13px}
.bulk-controls .brow .bhave{color:var(--accent);font-size:11px;font-weight:800;margin-left:6px}
.bulk-controls .bulk-hint{color:var(--muted);font-size:13px;padding:10px 12px}
.bulk-controls .num-entry{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bulk-controls .num-entry input{width:120px;text-align:center;font-size:16px;padding:10px 8px}
.bulk-controls .num-flash{font-size:13px;font-weight:700}
.bulk-controls .num-flash.ok{color:var(--green)}
.bulk-controls .num-flash.err{color:var(--red,#e55)}
`

export function BulkAddControls({ onAdd, have, haveLabel = 'in session', preview }: Props) {
  const toast = useToast()

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })

  // setId -> set name, so a search result can show its set's name without
  // another network request.
  const setName = useMemo(() => new Map(sets.map(s => [s.id, s.name])), [sets])
  const setTotals = useMemo(() => buildSetTotals(sets), [sets])

  // SET SELECTION — drives the instant local "add by number" path.
  const [setId, setSetId] = useState<string | null>(null)
  const { data: setCards = [] } = useQuery({
    queryKey: ['cards', setId],
    queryFn: () => getCards(setId as string),
    enabled: !!setId && setId !== ALL_SETS,
  })
  const activeSet = setId && setId !== ALL_SETS ? sets.find(s => s.id === setId) : undefined

  // ADD CONTROLS — condition, 1st edition, and how many copies per add.
  const [cond, setCond] = useState<(typeof CONDS)[number]>('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [step, setStep] = useState(1)

  // NUMBER ENTRY — one box. Accepts a bare number ("7") when a set is
  // picked, or "number/total" ("080/198") to find the set globally — same
  // "N/D" parsing the Name search box already does, so there's only ever
  // one field to type into and Enter always submits.
  const [numInput, setNumInput] = useState('')
  const [numFlash, setNumFlash] = useState<{ text: string; err: boolean } | null>(null)
  const [numBusy, setNumBusy] = useState(false)
  const numRef = useRef<HTMLInputElement>(null)

  // NAME SEARCH — debounced dropdown.
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState(false)
  const [hi, setHi] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  // Waits a moment after typing stops before actually searching, so the
  // backend isn't hit on every keystroke. A "number/total" query (e.g.
  // "080/198") is resolved by finding the set by its total, loading it,
  // and matching the number — more reliable than the plain text search.
  useEffect(() => {
    const q = query.trim()
    const delay = q.length < 2 ? 0 : 250
    const timer = window.setTimeout(async () => {
      setHi(0)
      if (q.length < 2) { setResults([]); setSearching(false); setSearchErr(false); return }
      setSearching(true)
      setSearchErr(false)
      try {
        // Checks whether the whole typed text is "number/total".
        const slash = q.match(/^([A-Za-z0-9]+)\s*\/\s*(\d+)$/)
        if (slash) {
          const [, numStr, denStr] = slash

          // Finds every set whose printed or real total matches what was typed.
          const candidates = sets.filter(s => String(s.printedTotal) === denStr || String(s.total) === denStr)
          const found: Card[] = []
          for (const s of candidates) {
            const cards = await getCards(s.id)
            found.push(...cards.filter(c => numberMatches(c.number, numStr)))
          }
          setResults(found.slice(0, 40))
        } else {
          // A normal name/number search, then the same narrowing used on
          // the main Collection page.
          const hits = await searchCards(q)
          setResults(narrowByCollectorNumber(hits, q, setTotals).slice(0, 40))
        }
      } catch {
        setResults([]); setSearchErr(true)
      } finally {
        setSearching(false)
      }
    }, delay)

    return () => clearTimeout(timer)
  }, [query, setTotals, sets])

  /** Add `step` copies of a card in the current condition. */
  const addCard = (card: Card) => {
    // 1st Ed only exists for the early WotC sets — ignored everywhere else,
    // so a toggle left on can't mislabel modern cards.
    const condKey = firstEd && hasFirstEdition(card.setId) ? `${cond} 1st Ed` : cond
    onAdd(card, condKey, step)
  }

  /** Brief confirmation shown under the number boxes. */
  const flash = (text: string, err: boolean) => {
    setNumFlash({ text, err })
    // Errors stay visible longer (1.6s) than confirmations (1.1s), so
    // there's more time to actually read what went wrong.
    window.setTimeout(() => setNumFlash(null), err ? 1600 : 1100)
  }

  /**
   * Lets the whole add flow run from the number field without ever
   * leaving the physical numpad — none of `+ - *` are valid characters
   * in a real collector number, so binding them here can't collide with
   * typing an actual number. `*` cycles Condition, `+`/`-` adjust the
   * quantity step. (`.` used to toggle 1st Ed silently — removed: it sits
   * right next to 0/Enter and mislabeled whole batches as 1st Edition.)
   */
  const onNumKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addByNumber(); return }
    if (e.key === '*') {
      e.preventDefault()
      // Moves to the next condition, wrapping back to the first after the last.
      setCond(c => CONDS[(CONDS.indexOf(c) + 1) % CONDS.length])
    } else if (e.key === '+') {
      e.preventDefault()
      setStep(s => s + 1)
    } else if (e.key === '-') {
      e.preventDefault()
      setStep(s => Math.max(1, s - 1))
    }
  }

  /**
   * Adds a card from the number box. Parses `numInput` as either a bare
   * number ("7") or "number/total" ("080/198"):
   *   - Set selected → instant local match in that set's cards (any
   *     "/total" typed is ignored — the set already picks it).
   *   - No set, but a total given → uses the total to find the set(s),
   *     loads each, and matches the number there.
   *   - No set and no total → a bare number is ambiguous across sets, so
   *     this asks for a total or a set instead of guessing.
   */
  const addByNumber = async () => {
    const raw = numInput.trim()
    if (!raw || numBusy) return

    const slash = raw.match(/^([A-Za-z0-9]+)\s*\/\s*(\d+)$/)
    const n = slash ? slash[1] : raw
    const d = slash ? slash[2] : ''

    // Fast path: a set is selected, so just match against its own cards.
    if (activeSet) {
      const card = setCards.find(c => numberMatches(c.number, n))
      if (card) { addCard(card); flash(`✓ #${card.number} ${card.name}`, false); setNumInput('') }
      else flash(`#${n} not found in ${activeSet.name}`, true)
      numRef.current?.focus()
      return
    }

    // No set selected — the total is what identifies which set(s) to look in.
    if (!d) { flash('type number/total (e.g. 7/198), or pick a set above', true); numRef.current?.focus(); return }
    const candidates = sets.filter(s => String(s.printedTotal) === d || String(s.total) === d)
    if (candidates.length === 0) { flash(`no set with total ${d}`, true); numRef.current?.focus(); return }

    setNumBusy(true)
    try {
      const matches: Card[] = []
      for (const s of candidates) {
        const cards = await getCards(s.id)
        matches.push(...cards.filter(c => numberMatches(c.number, n)))
      }
      if (matches.length === 0) {
        flash(`no card #${n}/${d}`, true)
        numRef.current?.focus()
      } else if (matches.length === 1) {
        addCard(matches[0])
        flash(`✓ #${matches[0].number} ${matches[0].name}`, false)
        setNumInput('')
        numRef.current?.focus()
      } else {
        // Several sets share this number + total — don't guess. Hand it
        // to the name search dropdown so the user can pick by set name.
        // Focus stays on the search box: refocusing the number box here
        // would blur the search box and clear the results we just set.
        setNumInput('')
        setQuery(`${n}/${d}`)
        searchRef.current?.focus()
        flash(`${matches.length} sets have #${n}/${d} — pick one below`, true)
      }
    } catch {
      flash('lookup failed — check the backend', true)
      numRef.current?.focus()
    } finally {
      setNumBusy(false)
    }
  }

  /** Enter in the name box: add the highlighted (or top) result. */
  const onSearchEnter = async () => {
    const q = query.trim()
    if (!q) return
    if (results.length) {
      addCard(results[hi] ?? results[0]); setQuery(''); setResults([]); searchRef.current?.focus(); return
    }
    // No dropdown results yet (Enter pressed before the debounced search
    // even ran) — do a fresh, immediate search right now instead.
    try {
      const hits = await searchCards(q)
      if (hits.length) { addCard(hits[0]); setQuery(''); setResults([]) }
      else toast(`No match for "${q}"`)
    } catch { toast('Search failed — check the backend.') }
    searchRef.current?.focus()
  }

  return (
    <div className="bulk-controls">
      <style>{STYLE}</style>

      {/* ── Set picker — scopes the number entry to one set ─────────────────── */}
      <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="sort-label">Set:</span>
        <SetSelector sets={sets} selectedId={setId} onSelect={setSetId} />
        {activeSet && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            {setCards.length} cards{activeSet.printedTotal ? ` · /${activeSet.printedTotal}` : ''}
          </span>
        )}
      </div>

      {/* ── Condition / quantity, then 1st Ed on its own ─────────────────────── */}
      <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="sort-label">Condition:</span>
        <select value={cond} onChange={e => setCond(e.target.value as (typeof CONDS)[number])}>
          {CONDS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
          Copies per add ×<input type="number" min={1} value={step} style={{ width: 54 }}
            onChange={e => setStep(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </label>
        {/* Kept well away from the quantity box, and only offered when the
            chosen set actually had a 1st Edition print run (or no set is
            picked yet). Gold while on, so it can't stay on unnoticed. */}
        {(!activeSet || hasFirstEdition(activeSet.id)) && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 24,
            paddingLeft: 16, borderLeft: '1px solid var(--border, #333)', fontSize: 13,
            color: firstEd ? '#fbbf24' : 'var(--muted)', fontWeight: firstEd ? 700 : 400,
          }}>
            <input type="checkbox" checked={firstEd} onChange={e => setFirstEd(e.target.checked)} />
            {firstEd ? '★ Adding as 1st Edition' : '1st Edition (Base–Neo era only)'}
          </label>
        )}
      </div>

      {/* ── Add by number — one box, Enter always submits ──────────────────── */}
      <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="sort-label">No.:</span>
        <div className="num-entry">
          <input
            ref={numRef} type="text" placeholder={activeSet ? '7' : '80/198'} maxLength={16}
            autoComplete="off" spellCheck={false} value={numInput}
            onChange={e => setNumInput(e.target.value)}
            onKeyDown={onNumKeyDown}
          />
          <button className="tb-btn primary" onClick={addByNumber} disabled={numBusy}>{numBusy ? '…' : 'Add'}</button>
          {numFlash && <span className={'num-flash ' + (numFlash.err ? 'err' : 'ok')}>{numFlash.text}</span>}
        </div>
        <span style={{ color: 'var(--muted)', fontSize: 12, flexBasis: '100%' }}>
          {activeSet
            ? `Type the card number and press Enter. A "/total" is accepted but ignored — the set already picks it.`
            : `Type number/total (e.g. 80/198) and press Enter — the total finds the set. Or pick a set above. Promos like SWSH158 go in alone.`}
          {' · numpad-only: '}<b>*</b>{' cond · '}<b>+</b>/<b>-</b>{' qty'}
        </span>
      </div>

      {/* ── Add by name — search dropdown ───────────────────────────────────── */}
      <div className="toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="sort-label">Name:</span>
        <div className="bulk-search-wrap">
          <input
            ref={searchRef} className="bulk-search" type="text" value={query}
            placeholder="Search by name — e.g. Charizard"
            onChange={e => setQuery(e.target.value)}
            // A short delay before clearing on blur: clicking a dropdown
            // result also briefly blurs this box just before the click
            // registers, so clearing instantly would make the click miss.
            onBlur={() => window.setTimeout(() => { setResults([]); setQuery('') }, 150)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onSearchEnter() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
              else if (e.key === 'Escape') { setQuery(''); setResults([]) }
            }}
          />
          {query.trim().length >= 2 && (
            <div className="bulk-results">
              {searching && results.length === 0 && <div className="bulk-hint">Searching…</div>}
              {!searching && searchErr && (
                <div className="bulk-hint" style={{ color: 'var(--red, #e55)' }}>Search failed — check the backend.</div>
              )}
              {!searching && !searchErr && results.length === 0 && <div className="bulk-hint">No matches.</div>}
              {results.map((card, i) => {
                const owned = have?.(card.id) ?? 0
                return (
                  <button
                    key={card.id} className={'brow' + (i === hi ? ' hi' : '')}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => { addCard(card); setQuery(''); setResults([]) }}
                  >
                    {card.images?.small
                      ? <img
                          src={card.images.small} alt={card.name} loading="lazy"
                          onMouseEnter={() => preview.show(card.images.large || card.images.small)}
                          onMouseLeave={() => preview.hide()}
                        />
                      : <span style={{ width: 38 }} />}
                    <span className="bi">
                      <b>{card.name}{owned > 0 && <span className="bhave">×{owned} {haveLabel}</span>}</b>
                      <small>#{card.number} · {setName.get(card.setId) ?? card.setId}</small>
                    </span>
                    <span className="bp">{condPrice(card, cond) > 0 ? '$' + condPrice(card, cond).toFixed(2) : '—'}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
