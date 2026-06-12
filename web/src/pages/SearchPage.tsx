import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchCards } from '../api/cards'
import { condColor } from '../components/ConditionBadge'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => searchCards(submitted),
    enabled: submitted.length >= 2,
  })

  const submit = () => {
    if (query.trim().length >= 2) setSubmitted(query.trim())
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-white mb-4">Search Cards</h1>

      <div className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Card name (e.g. Charizard)…"
          className="flex-1 bg-[#1c1c24] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20"
        />
        <button
          onClick={submit}
          className="px-5 py-2.5 bg-[#ffcb05] hover:bg-yellow-400 text-black font-semibold rounded-lg text-sm transition-colors"
        >
          Search
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-slate-500">
          <div className="w-5 h-5 border-2 border-slate-600 border-t-[#ffcb05] rounded-full animate-spin" />
          <span>Searching…</span>
        </div>
      )}

      {!isLoading && submitted && results.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <p>No results for "{submitted}"</p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <p className="text-xs text-slate-500 mb-3">{results.length} result{results.length !== 1 ? 's' : ''}</p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {results.map(card => {
              const prices = card.prices
              return (
                <div
                  key={card.id}
                  className="bg-[#1c1c24] border border-white/10 rounded-xl p-3 flex gap-3 hover:-translate-y-0.5 hover:border-white/20 transition-all"
                >
                  <img
                    src={card.images.small}
                    alt={card.name}
                    className="w-14 h-[78px] object-contain rounded shrink-0"
                  />
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{card.name}</div>
                    <div className="text-xs text-slate-500">#{card.number} · {card.setId}</div>
                    {card.rarity && <div className="text-xs text-slate-600">{card.rarity}</div>}
                    {prices && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        {(['nm', 'lp', 'mp', 'hp', 'dmg'] as const).map(cond => {
                          const v = prices[cond]
                          if (v == null) return null
                          return (
                            <div key={cond} className="flex justify-between text-xs">
                              <span style={{ color: condColor(cond.toUpperCase()) }}>{cond.toUpperCase()}</span>
                              <span className="text-white font-medium">${v.toFixed(2)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {!submitted && (
        <div className="text-center py-16 text-slate-600">
          <div className="text-5xl mb-3">🃏</div>
          <p>Search across all cached sets</p>
        </div>
      )}
    </div>
  )
}
