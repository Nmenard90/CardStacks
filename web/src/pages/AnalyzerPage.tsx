import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchCards, getSets, getCardsBySet } from '../api/cards'
import type { Card } from '../types'

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
const COND_MULT: Record<string, number> = { NM: 1.0, LP: 0.85, MP: 0.70, HP: 0.50, DMG: 0.30 }

interface TradeCard {
  card: Card
  condition: string
}

interface TradeCardPickerProps {
  open: boolean
  onClose: () => void
  onPick: (card: Card) => void
}

function TradeCardPicker({ open, onClose, onPick }: TradeCardPickerProps) {
  const [query, setQuery] = useState('')
  const [setId, setSetId] = useState('')

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const { data: setCards = [] } = useQuery({
    queryKey: ['cards', setId],
    queryFn: () => getCardsBySet(setId),
    enabled: !!setId,
  })
  const { data: searchResults = [] } = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchCards(query),
    enabled: query.length >= 2,
  })

  const results = query.length >= 2 ? searchResults : setCards

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#1c1c24] border border-white/10 rounded-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); if (e.target.value.length >= 2) setSetId('') }}
            placeholder="Search by card name…"
            className="flex-1 bg-[#13111e] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <select
            value={setId}
            onChange={e => { setSetId(e.target.value); setQuery('') }}
            className="bg-[#13111e] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">All sets…</option>
            {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
            {results.map(card => (
              <button
                key={card.id}
                onClick={() => { onPick(card); onClose() }}
                className="group flex flex-col gap-1 p-1.5 rounded-lg hover:bg-white/5 transition-colors text-left"
              >
                <img src={card.images.small} alt={card.name} className="w-full rounded aspect-[2.5/3.5] object-cover" />
                <span className="text-[10px] text-slate-400 truncate group-hover:text-white leading-tight">{card.name}</span>
                {card.prices?.nm != null && (
                  <span className="text-[10px] text-[#ffcb05]">${card.prices.nm.toFixed(2)}</span>
                )}
              </button>
            ))}
            {results.length === 0 && (query.length >= 2 || setId) && (
              <div className="col-span-full text-center py-8 text-slate-500 text-sm">No cards found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function cardValue(tc: TradeCard): number {
  const base = tc.card.prices?.nm ?? 0
  return base * (COND_MULT[tc.condition] ?? 1)
}

export function AnalyzerPage() {
  const [giving, setGiving] = useState<TradeCard[]>([])
  const [getting, setGetting] = useState<TradeCard[]>([])
  const [pickerTarget, setPickerTarget] = useState<'give' | 'get' | null>(null)

  const givingTotal  = useMemo(() => giving.reduce((s, c) => s + cardValue(c), 0), [giving])
  const gettingTotal = useMemo(() => getting.reduce((s, c) => s + cardValue(c), 0), [getting])
  const diff         = gettingTotal - givingTotal
  const pct          = givingTotal > 0 ? Math.abs(diff / givingTotal) * 100 : 0

  const verdict = useMemo(() => {
    if (giving.length === 0 && getting.length === 0)
      return { label: 'Add cards to analyze', color: '#6366f1', icon: '⚖️', desc: 'Add cards to both sides to see if a trade is fair.' }
    if (Math.abs(diff) < 0.5 || pct < 3)
      return { label: 'Fair Trade', color: '#22c55e', icon: '✅', desc: 'Both sides are roughly equal in value.' }
    if (diff < 0)
      return { label: `You're Overpaying`, color: '#ef4444', icon: '⚠️', desc: `You're giving ${pct.toFixed(0)}% more than you're getting.` }
    return { label: `You're Getting a Deal`, color: '#3b82f6', icon: '🎉', desc: `You're receiving ${pct.toFixed(0)}% more than you're giving.` }
  }, [diff, pct, giving.length, getting.length])

  const renderSide = (_cards: TradeCard[], side: 'give' | 'get') => {
    const list = side === 'give' ? giving : getting
    const setList = side === 'give' ? setGiving : setGetting
    const total = side === 'give' ? givingTotal : gettingTotal

    return (
      <div className="flex-1 bg-[#1c1c24] rounded-xl border border-white/10 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300">{side === 'give' ? '🔴 You Give' : '🟢 You Get'}</h2>
          <span className="text-sm font-bold text-[#ffcb05]">${total.toFixed(2)}</span>
        </div>

        {list.map((tc, i) => (
          <div key={tc.card.id + i} className="flex items-center gap-3 bg-[#13111e] rounded-lg p-2">
            <img src={tc.card.images.small} alt={tc.card.name} className="w-10 h-14 object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{tc.card.name}</div>
              <div className="text-xs text-slate-500 truncate">{tc.card.setId}</div>
              <div className="flex gap-1 mt-1">
                {CONDITIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => {
                      const updated = [...list]
                      updated[i] = { ...tc, condition: c }
                      setList(updated)
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                      tc.condition === c
                        ? 'bg-white/10 border-white/30 text-white'
                        : 'border-white/10 text-slate-500 hover:text-white'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-[#ffcb05] font-bold">${cardValue(tc).toFixed(2)}</div>
              <button
                onClick={() => setList(list.filter((_, j) => j !== i))}
                className="text-slate-600 hover:text-red-400 text-sm mt-1 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => setPickerTarget(side)}
          className="w-full py-2 border border-dashed border-white/10 hover:border-white/20 rounded-lg text-xs text-slate-500 hover:text-white transition-colors"
        >
          + Add a card
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Verdict banner */}
      <div
        className="rounded-xl p-5 border text-center"
        style={{ borderColor: `${verdict.color}33`, backgroundColor: `${verdict.color}11` }}
      >
        <div className="text-3xl mb-1">{verdict.icon}</div>
        <div className="text-lg font-bold" style={{ color: verdict.color }}>{verdict.label}</div>
        <div className="text-sm text-slate-400 mt-1">{verdict.desc}</div>
        {giving.length > 0 && getting.length > 0 && (
          <div className="flex justify-center gap-8 mt-3 text-sm">
            <span>You give: <strong className="text-white">${givingTotal.toFixed(2)}</strong></span>
            <span>You get: <strong className="text-white">${gettingTotal.toFixed(2)}</strong></span>
            <span>Difference: <strong style={{ color: diff >= 0 ? '#22c55e' : '#ef4444' }}>{diff >= 0 ? '+' : ''}{diff.toFixed(2)}</strong></span>
          </div>
        )}
      </div>

      {/* Two sides */}
      <div className="flex gap-4 items-start">
        {renderSide(giving, 'give')}

        <div className="w-10 h-10 rounded-full bg-[#1c1c24] border border-white/10 flex items-center justify-center text-slate-400 shrink-0 mt-16 text-lg">
          ⇄
        </div>

        {renderSide(getting, 'get')}
      </div>

      <TradeCardPicker
        open={!!pickerTarget}
        onClose={() => setPickerTarget(null)}
        onPick={card => {
          if (pickerTarget === 'give') setGiving(prev => [...prev, { card, condition: 'NM' }])
          else if (pickerTarget === 'get') setGetting(prev => [...prev, { card, condition: 'NM' }])
        }}
      />
    </div>
  )
}
