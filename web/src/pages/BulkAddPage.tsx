/**
 * FILE: BulkAddPage.tsx — high-volume bulk card entry, separate from CollectionPage.
 *
 * PURPOSE:
 *   Lets a user enter thousands of cards quickly by collector number alone,
 *   WITHOUT first picking a set. Built for scale (10k+ entries) by:
 *     - aggregating identical card+condition entries into one row (a count),
 *     - keeping the source of truth in a ref-held Map (O(1) updates, no giant
 *       array re-renders on every keystroke),
 *     - rendering only the most recent slice of rows,
 *     - resolving each number to a card once and caching the result,
 *     - saving everything in a single merged bulk request at the end.
 *
 * IMPORTS EXPLAINED:
 *   useMemo/useRef/useState — local state + the ref-held row Map
 *   useQuery                — load all sets once (to disambiguate by set total)
 *   Link                    — navigation back to the collection
 *   searchCards/getSets     — backend all-sets search + set list
 *   getCollection/bulkSave  — read existing collection, then merge-and-save
 *   conditions helpers      — condition keys, per-condition pricing, list <-> map
 *
 * USED BY: App.tsx route "/bulk"
 * DEPENDS ON: backend GET /api/search (must match collector numbers), POST .../bulk
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSets, searchCards } from '../api/cards'
import { bulkSave, getCollection, type BulkItem } from '../api/collection'
import { LoginScreen } from '../components/LoginScreen'
import { useToast } from '../components/Toast'
import { useUser } from '../context/UserContext'
import {
  baseCond, CONDS, condPrice, fromCondList, toCondList, type CondMap,
} from '../lib/conditions'
import type { Card } from '../types'

/** One aggregated bulk-entry row: a card+condition and how many were entered. */
interface BulkRow {
  aggKey: string                              // `${rawLower}|${condKey}` — the dedupe key
  raw: string                                 // what the user typed, e.g. "119/117"
  condKey: string                             // "NM" or "NM 1st Ed"
  qty: number                                 // how many copies entered
  card: Card | null                           // resolved card, once the lookup finishes
  status: 'resolving' | 'ok' | 'notfound'     // lookup state for this row
}

/** How many recent rows to actually render (the rest stay in memory). */
const RENDER_LIMIT = 80

export function BulkAddPage() {
  const { user } = useUser()
  const toast = useToast()
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets, enabled: !!user })

  // Source of truth for entries — a Map keeps inserts O(1) and avoids
  // re-rendering a 10k-element array on every keystroke.
  const rowsRef = useRef<Map<string, BulkRow>>(new Map())
  // Cache of raw-number -> resolved card so repeated numbers never re-hit the API.
  const cacheRef = useRef<Map<string, Card | null>>(new Map())
  // A counter we bump to trigger a re-render after mutating the ref-held Map.
  const [, setVersion] = useState(0)
  const bump = () => setVersion(v => v + 1)

  // Entry controls.
  const [num, setNum] = useState('')
  const [total, setTotal] = useState('')
  const [cond, setCond] = useState<(typeof CONDS)[number]>('NM')
  const [firstEd, setFirstEd] = useState(false)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  const numRef = useRef<HTMLInputElement>(null)
  const totalRef = useRef<HTMLInputElement>(null)

  if (!user) return <LoginScreen />

  /**
   * PURPOSE: Choose the single best card for a typed number from search hits.
   * @param hits   Cards returned by the backend search
   * @param n      Collector number part, lowercased ("119", "swsh158")
   * @param t      Optional set-total part ("117") used to disambiguate sets
   * @return       The best-matching card, or null
   */
  const pickMatch = (hits: Card[], n: string, t: string): Card | null => {
    let pool = hits.filter(h => h.number.toLowerCase() === n)
    if (pool.length === 0) pool = hits
    if (t && pool.length > 1) {
      const byTotal = pool.filter(h => {
        const s = sets.find(x => x.id === h.setId)
        return !!s && (String(s.total) === t || String(s.printedTotal) === t)
      })
      if (byTotal.length) pool = byTotal
    }
    return pool[0] ?? null
  }

  /**
   * PURPOSE: Resolve a row's raw number to a card (cached), then update the row.
   * @param raw     The raw entry, e.g. "119/117"
   * @param aggKey  The row's Map key to update when resolution finishes
   */
  const resolve = async (raw: string, aggKey: string) => {
    const key = raw.toLowerCase()
    const apply = (card: Card | null) => {
      const r = rowsRef.current.get(aggKey)
      if (!r) return
      r.card = card
      r.status = card ? 'ok' : 'notfound'
      bump()
    }
    if (cacheRef.current.has(key)) { apply(cacheRef.current.get(key) ?? null); return }
    const [nPart, tPart] = raw.includes('/') ? raw.split('/') : [raw, '']
    try {
      const hits = await searchCards(raw)
      const card = pickMatch(hits, nPart.trim().toLowerCase(), tPart.trim())
      cacheRef.current.set(key, card)
      apply(card)
    } catch {
      apply(null)
    }
  }

  /** PURPOSE: Commit the current number/total into the session (or bump its count). */
  const commit = () => {
    const n = num.trim()
    if (!n) return
    const t = total.trim()
    const raw = t ? `${n}/${t}` : n
    const condKey = firstEd ? `${cond} 1st Ed` : cond
    const aggKey = `${raw.toLowerCase()}|${condKey}`
    const map = rowsRef.current
    const existing = map.get(aggKey)
    if (existing) {
      existing.qty += step
      map.delete(aggKey)          // re-insert to move it to the most-recent end
      map.set(aggKey, existing)
    } else {
      const row: BulkRow = { aggKey, raw, condKey, qty: step, card: null, status: 'resolving' }
      map.set(aggKey, row)
      void resolve(raw, aggKey)
    }
    setNum('')
    setTotal('')
    bump()
    numRef.current?.focus()
  }

  /** PURPOSE: Remove one aggregated row from the session. */
  const removeRow = (aggKey: string) => {
    rowsRef.current.delete(aggKey)
    bump()
  }

  /** PURPOSE: Wipe the whole in-progress session (after a confirm). */
  const clearAll = () => {
    if (!rowsRef.current.size) return
    if (!confirm('Clear the entire bulk session? This does not touch your saved collection.')) return
    rowsRef.current.clear()
    bump()
  }

  /**
   * PURPOSE: Merge every resolved row into the existing collection and save once.
   *          bulkSave REPLACES each card it receives, so we read current
   *          conditions first and add the session counts on top — only the
   *          touched cards are sent, leaving the rest of the collection intact.
   */
  const save = async () => {
    const all = [...rowsRef.current.values()]
    const ok = all.filter(r => r.status === 'ok' && r.card)
    if (ok.length === 0) { toast('Nothing resolved to save yet.'); return }
    setSaving(true)
    try {
      const existing = await getCollection(user.id)
      const existingByCard = new Map(existing.map(e => [e.cardId, e]))
      // cardId -> merged working state
      const merged = new Map<string, { card: Card; map: CondMap; selectedCond: string }>()
      for (const r of ok) {
        const id = r.card!.id
        let m = merged.get(id)
        if (!m) {
          const prior = existingByCard.get(id)
          m = {
            card: r.card!,
            map: prior ? fromCondList(prior.conditions) : {},
            selectedCond: prior?.selectedCond ?? baseCond(r.condKey),
          }
          merged.set(id, m)
        }
        m.map[r.condKey] = (m.map[r.condKey] ?? 0) + r.qty
      }
      const items: BulkItem[] = [...merged.values()].map(m => ({
        cardId: m.card.id,
        conditions: toCondList(m.map, m.card),
        selectedCond: m.selectedCond,
      }))
      await bulkSave(user.id, items)
      const totalCards = ok.reduce((s, r) => s + r.qty, 0)
      toast(`Saved ${totalCards} cards across ${items.length} unique cards.`)
      rowsRef.current.clear()
      bump()
    } catch {
      toast('Save failed — nothing was stored.')
    } finally {
      setSaving(false)
    }
  }

  // Totals + the slice we actually render. Recomputed when `version` changes.
  const { rendered, totalQty, uniqueOk, totalValue, resolving, notfound, overflow } = useMemo(() => {
    const all = [...rowsRef.current.values()]
    let q = 0, val = 0, okN = 0, resN = 0, nfN = 0
    for (const r of all) {
      q += r.qty
      if (r.status === 'ok') { okN++; val += r.qty * condPrice(r.card!, r.condKey) }
      else if (r.status === 'resolving') resN++
      else nfN++
    }
    const recent = all.slice(-RENDER_LIMIT).reverse()   // newest first
    return {
      rendered: recent, totalQty: q, uniqueOk: okN, totalValue: val,
      resolving: resN, notfound: nfN, overflow: Math.max(0, all.length - RENDER_LIMIT),
    }
  }, [setVersion, num, total])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '20px 16px', color: '#e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>⚡ Bulk Add</h1>
        <Link to="/" style={{ color: '#93c5fd', fontSize: 14 }}>← Back to collection</Link>
        <span style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.7 }}>
          Type a number, press <b>/</b> for the set total, <b>Enter</b> to add.
        </span>
      </div>

      {/* Entry bar */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, padding: 12, marginBottom: 16,
      }}>
        <input
          ref={numRef}
          value={num}
          autoFocus
          placeholder="number (e.g. 119)"
          onChange={e => {
            const v = e.target.value
            if (v.includes('/')) {               // pasted/typed "119/117" — split + advance
              const [a, b] = v.split('/')
              setNum(a)
              setTotal(b ?? '')
              totalRef.current?.focus()
            } else setNum(v)
          }}
          onKeyDown={e => {
            if (e.key === '/') { e.preventDefault(); totalRef.current?.focus() }
            else if (e.key === 'Enter') commit()
          }}
          style={inputStyle(120)}
        />
        <span style={{ opacity: 0.5 }}>/</span>
        <input
          ref={totalRef}
          value={total}
          placeholder="set total (opt.)"
          onChange={e => setTotal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit() }}
          style={inputStyle(120)}
        />
        <select value={cond} onChange={e => setCond(e.target.value as (typeof CONDS)[number])} style={inputStyle(80)}>
          {CONDS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={firstEd} onChange={e => setFirstEd(e.target.checked)} /> 1st Ed
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          ×<input
            type="number" min={1} value={step}
            onChange={e => setStep(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={inputStyle(56)}
          />
        </label>
        <button onClick={commit} style={btnStyle('#2563eb')}>Add</button>
      </div>

      {/* Totals */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 14 }}>
        <span><b>{totalQty}</b> cards</span>
        <span><b>{uniqueOk}</b> unique</span>
        <span><b>${totalValue.toFixed(2)}</b> value</span>
        {resolving > 0 && <span style={{ color: '#fbbf24' }}>{resolving} resolving…</span>}
        {notfound > 0 && <span style={{ color: '#fca5a5' }}>{notfound} not found</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={clearAll} style={btnStyle('transparent', '#fca5a5')}>Clear session</button>
          <button onClick={save} disabled={saving || uniqueOk === 0} style={btnStyle('#16a34a')}>
            {saving ? 'Saving…' : 'Save to collection'}
          </button>
        </span>
      </div>

      {/* Recent rows */}
      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
        {rendered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.6 }}>
            No cards yet — start typing numbers above.
          </div>
        )}
        {rendered.map(r => (
          <div key={r.aggKey} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: r.status === 'notfound' ? 'rgba(239,68,68,0.08)' : 'transparent',
          }}>
            <span style={{ width: 90, fontFamily: 'monospace', opacity: 0.85 }}>#{r.raw}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.status === 'resolving' && <span style={{ opacity: 0.6 }}>resolving…</span>}
              {r.status === 'notfound' && <span style={{ color: '#fca5a5' }}>not found</span>}
              {r.status === 'ok' && r.card && r.card.name}
            </span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{r.condKey}</span>
            <span style={{ width: 48, textAlign: 'right' }}>×{r.qty}</span>
            <span style={{ width: 72, textAlign: 'right', opacity: 0.8 }}>
              {r.status === 'ok' && r.card ? `$${(r.qty * condPrice(r.card, r.condKey)).toFixed(2)}` : ''}
            </span>
            <button onClick={() => removeRow(r.aggKey)} style={{ ...btnStyle('transparent', '#9ca3af'), padding: '2px 8px' }}>✕</button>
          </div>
        ))}
        {overflow > 0 && (
          <div style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13, opacity: 0.6 }}>
            + {overflow} more entries (all included in totals and save)
          </div>
        )}
      </div>
    </div>
  )
}

/** PURPOSE: Shared inline style for the entry inputs. @param w pixel width */
function inputStyle(w: number): React.CSSProperties {
  return {
    width: w, padding: '8px 10px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)',
    color: '#e5e7eb', fontSize: 14,
  }
}

/** PURPOSE: Shared inline style for buttons. @param bg background @param fg text color */
function btnStyle(bg: string, fg = '#fff'): React.CSSProperties {
  return {
    padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)',
    background: bg, color: fg, fontSize: 14, cursor: 'pointer',
  }
}
