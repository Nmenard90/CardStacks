import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSets, getCardsBySet } from '../api/cards'
import { getCollection, getCollectionStats, updateCollectionEntry } from '../api/collection'
import { useUser } from '../context/UserContext'
import { CardItem } from '../components/CardItem'
import type { CardSet, ConditionCount } from '../types'

type SortKey = 'number' | 'name' | 'value' | 'quantity'

export function CollectionPage() {
  const { user } = useUser()
  const qc = useQueryClient()

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [setSearch, setSetSearch] = useState('')
  const [setDropdownOpen, setSetDropdownOpen] = useState(false)
  const [cardSearch, setCardSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('number')
  const [ownedOnly, setOwnedOnly] = useState(false)

  const { data: sets = [] } = useQuery({
    queryKey: ['sets'],
    queryFn: getSets,
  })

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['cards', selectedSetId],
    queryFn: () => getCardsBySet(selectedSetId!),
    enabled: !!selectedSetId,
  })

  const { data: collection = [] } = useQuery({
    queryKey: ['collection', user?.id],
    queryFn: () => getCollection(user!.id),
    enabled: !!user,
  })

  const { data: stats } = useQuery({
    queryKey: ['collectionStats', user?.id],
    queryFn: () => getCollectionStats(user!.id),
    enabled: !!user,
  })

  const updateMutation = useMutation({
    mutationFn: ({ cardId, conditions, selectedCond }: { cardId: string; conditions: ConditionCount[]; selectedCond: string }) =>
      updateCollectionEntry(user!.id, cardId, conditions, selectedCond),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collection', user?.id] })
      qc.invalidateQueries({ queryKey: ['collectionStats', user?.id] })
    },
  })

  const entryMap = useMemo(() => {
    const map = new Map(collection.map(e => [e.cardId, e]))
    return map
  }, [collection])

  const filteredCards = useMemo(() => {
    let list = [...cards]

    if (ownedOnly) list = list.filter(c => entryMap.has(c.id))
    if (cardSearch.trim()) {
      const q = cardSearch.toLowerCase()
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.number.includes(q))
    }

    list.sort((a, b) => {
      if (sortKey === 'number') return a.number.localeCompare(b.number, undefined, { numeric: true })
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'value') {
        const av = a.prices?.nm ?? 0
        const bv = b.prices?.nm ?? 0
        return bv - av
      }
      if (sortKey === 'quantity') {
        const aq = entryMap.get(a.id)?.conditions.reduce((s, c) => s + c.quantity, 0) ?? 0
        const bq = entryMap.get(b.id)?.conditions.reduce((s, c) => s + c.quantity, 0) ?? 0
        return bq - aq
      }
      return 0
    })

    return list
  }, [cards, cardSearch, sortKey, ownedOnly, entryMap])

  // Group sets by series for the dropdown
  const setsBySeries = useMemo(() => {
    const groups = new Map<string, CardSet[]>()
    const filtered = setSearch
      ? sets.filter(s => s.name.toLowerCase().includes(setSearch.toLowerCase()))
      : sets
    for (const s of filtered) {
      const list = groups.get(s.series) ?? []
      list.push(s)
      groups.set(s.series, list)
    }
    return groups
  }, [sets, setSearch])

  const selectedSet = sets.find(s => s.id === selectedSetId)

  const ownedCards = cards.filter(c => entryMap.has(c.id)).length
  const setCompletion = cards.length > 0 ? Math.round((ownedCards / cards.length) * 100) : 0

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Stats bar */}
      {user && stats && (
        <div className="bg-[#13111e] border-b border-white/[0.06] px-4 py-2 flex gap-6 text-xs text-slate-400 overflow-x-auto shrink-0">
          <span>Total Cards: <strong className="text-white">{stats.totalCards}</strong></span>
          <span>Unique: <strong className="text-white">{stats.uniqueCards}</strong></span>
          <span>Value: <strong className="text-[#ffcb05]">${stats.totalValue.toFixed(2)}</strong></span>
          <span>Sets: <strong className="text-white">{stats.setsEntered}</strong></span>
          {selectedSet && cards.length > 0 && (
            <>
              <span className="border-l border-white/10 pl-6">
                Set: <strong className="text-white">{ownedCards}/{cards.length}</strong>
              </span>
              <span>
                Complete: <strong className="text-[#ffcb05]">{setCompletion}%</strong>
              </span>
            </>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-[#13111e]/60 border-b border-white/[0.06] px-4 py-2 flex items-center gap-3 shrink-0 flex-wrap">
        {/* Set selector */}
        <div className="relative">
          <button
            onClick={() => setSetDropdownOpen(v => !v)}
            className="flex items-center gap-2 bg-[#1c1c24] border border-white/10 rounded-lg px-3 py-2 text-sm text-white hover:border-white/20 transition-colors min-w-[200px] text-left"
          >
            {selectedSet ? (
              <>
                <img src={selectedSet.images.symbol} alt="" className="w-5 h-5 object-contain" />
                <span className="truncate flex-1">{selectedSet.name}</span>
              </>
            ) : (
              <span className="text-slate-500">Select a set…</span>
            )}
            <span className="text-slate-500 ml-auto">▾</span>
          </button>

          {setDropdownOpen && (
            <div className="absolute top-full mt-1 left-0 w-72 bg-[#1c1c24] border border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden">
              <div className="p-2 border-b border-white/10">
                <input
                  autoFocus
                  value={setSearch}
                  onChange={e => setSetSearch(e.target.value)}
                  placeholder="Search sets…"
                  className="w-full bg-[#13111e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none"
                />
              </div>
              <div className="overflow-y-auto max-h-72">
                {Array.from(setsBySeries.entries()).map(([series, seriesSets]) => (
                  <div key={series}>
                    <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-black/20">
                      {series}
                    </div>
                    {seriesSets.map(s => (
                      <button
                        key={s.id}
                        onClick={() => { setSelectedSetId(s.id); setSetDropdownOpen(false); setSetSearch('') }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 transition-colors ${
                          s.id === selectedSetId ? 'text-[#ffcb05]' : 'text-white'
                        }`}
                      >
                        <img src={s.images.symbol} alt="" className="w-5 h-5 object-contain shrink-0" />
                        <span className="flex-1 text-left truncate">{s.name}</span>
                        <span className="text-slate-600 text-xs">{s.total}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {setsBySeries.size === 0 && (
                  <div className="px-4 py-6 text-center text-slate-500 text-sm">No sets found</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Card search */}
        <input
          value={cardSearch}
          onChange={e => setCardSearch(e.target.value)}
          placeholder="Search cards…"
          className="bg-[#1c1c24] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 w-48"
        />

        {/* Sort */}
        <div className="flex items-center gap-1 text-xs">
          {(['number', 'name', 'value', 'quantity'] as SortKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`px-2.5 py-1.5 rounded-lg capitalize transition-colors ${
                sortKey === k ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'
              }`}
            >
              {k === 'number' ? '#' : k}
            </button>
          ))}
        </div>

        {/* Owned only toggle */}
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer ml-auto select-none">
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={e => setOwnedOnly(e.target.checked)}
            className="accent-[#ffcb05]"
          />
          Owned only
        </label>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!selectedSetId ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <span className="text-5xl">🃏</span>
            <p className="text-lg">Select a set to get started</p>
          </div>
        ) : cardsLoading ? (
          <div className="flex items-center justify-center h-full gap-3 text-slate-500">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-[#ffcb05] rounded-full animate-spin" />
            <span>Loading cards…</span>
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <span className="text-4xl">🔍</span>
            <p>No cards match your filter</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
            {filteredCards.map(card => (
              <CardItem
                key={card.id}
                card={card}
                entry={entryMap.get(card.id)}
                onUpdate={(conditions, selectedCond) => {
                  if (!user) return
                  updateMutation.mutate({ cardId: card.id, conditions, selectedCond })
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
