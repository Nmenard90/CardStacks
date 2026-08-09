/**
 * Header set picker: button showing the current set's symbol + name,
 * opening a searchable dropdown grouped by series (newest first), each
 * row with symbol and card count.
 *
 * USED BY: CollectionPage
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CardSet } from '../types'

/** Sentinel id meaning "search across every set" instead of one specific set. */
export const ALL_SETS = '__all__'

interface Props {
  sets: CardSet[]
  selectedId: string | null
  onSelect: (setId: string) => void
}

export function SetSelector({ sets, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  // Click-outside-to-close.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const selected = sets.find(s => s.id === selectedId)

  const groups = useMemo(() => {
    const ql = q.toLowerCase().trim()
    const filtered = ql
      ? sets.filter(s => s.name.toLowerCase().includes(ql) || s.series.toLowerCase().includes(ql))
      : sets

    // Grouped by a map first rather than by walking a release-date-sorted
    // list and merging consecutive same-series entries — a series' sets
    // aren't guaranteed contiguous by release date (e.g. the "Other" bucket
    // spans years), so that approach could produce two separate groups for
    // one series, both keyed by the same series name.
    const bySeries = new Map<string, CardSet[]>()
    for (const s of filtered) {
      const existing = bySeries.get(s.series)
      if (existing) existing.push(s)
      else bySeries.set(s.series, [s])
    }

    const out = Array.from(bySeries, ([series, setsInSeries]) => ({
      series,
      sets: setsInSeries.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)),
    }))
    // Newest series first, using each group's newest set as its release date.
    out.sort((a, b) => b.sets[0].releaseDate.localeCompare(a.sets[0].releaseDate))
    return out
  }, [sets, q])

  return (
    <div className="set-selector" ref={wrap}>
      <div
        className={'set-selector-btn' + (open ? ' open' : '')}
        onClick={() => setOpen(o => !o)}
      >
        {selectedId === ALL_SETS
          ? <div className="set-sym-placeholder">🗂</div>
          : selected?.images.symbol
            ? <img className="set-sym" src={selected.images.symbol} alt="" />
            : <div className="set-sym-placeholder" />}
        <span>
          {selectedId === ALL_SETS
            ? 'All Sets'
            : selected
              ? selected.name
              : sets.length === 0 ? 'Loading…' : 'Choose a set'}
        </span>
        <span className="chevron">▼</span>
      </div>

      <div className={'set-dropdown' + (open ? ' open' : '')}>
        <div className="set-search-wrap">
          <input
            type="text" placeholder="Search sets…" autoComplete="off"
            value={q} onChange={e => setQ(e.target.value)}
            onClick={e => e.stopPropagation()}  // don't trigger the outside-click close
          />
        </div>
        <div>
          <div
            className={'set-option' + (selectedId === ALL_SETS ? ' selected' : '')}
            onClick={() => { onSelect(ALL_SETS); setOpen(false); setQ('') }}
          >
            <div style={{ width: 22, textAlign: 'center' }}>🗂</div>
            <span className="so-name">All Sets</span>
            <span className="so-count">search everywhere</span>
          </div>

          {groups.map(g => (
            <div key={g.series}>
              <div className="set-group-label">{g.series}</div>
              {g.sets.map(s => (
                <div
                  key={s.id}
                  className={'set-option' + (s.id === selectedId ? ' selected' : '')}
                  onClick={() => { onSelect(s.id); setOpen(false); setQ('') }}
                >
                  {s.images.symbol ? <img src={s.images.symbol} alt="" /> : <div style={{ width: 22 }} />}
                  <span className="so-name">{s.name}</span>
                  <span className="so-count">{s.total} cards</span>
                </div>
              ))}
            </div>
          ))}

          {groups.length === 0 && <div className="sb-empty">No sets match.</div>}
        </div>
      </div>
    </div>
  )
}
