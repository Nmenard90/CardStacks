import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSets, getCardsBySet } from '../api/cards'
import { getCollection, getCollectionStats, updateCollectionEntry } from '../api/collection'
import { useUser } from '../context/UserContext'
import { condColor } from '../components/ConditionBadge'
import type { Card, CardSet, ConditionCount } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const
type Condition = typeof CONDITIONS[number]

type SortKey = 'number' | 'name' | 'value' | 'quantity'

interface RecentCard {
  card: Card
  condition: Condition
  qty: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Strips leading zeros so "001" matches card number "1"
const normalizeNum = (n: string) => n.split('/')[0].trim().replace(/^0+/, '') || '0'

const condMult: Record<Condition, number> = { NM: 1, LP: 0.85, MP: 0.70, HP: 0.50, DMG: 0.30 }

function cardConditionValue(card: Card, cond: Condition): number {
  const nm = card.prices?.nm ?? 0
  return +(nm * condMult[cond]).toFixed(2)
}

// ─── Set Selector ─────────────────────────────────────────────────────────────

function SetSelector({
  sets, selectedId, onSelect,
}: { sets: CardSet[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q ? sets.filter(s => s.name.toLowerCase().includes(q)) : sets
    const map = new Map<string, CardSet[]>()
    for (const s of filtered) {
      const list = map.get(s.series) ?? []
      list.push(s)
      map.set(s.series, list)
    }
    return map
  }, [sets, search])

  const selected = sets.find(s => s.id === selectedId)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 bg-[#1c1c24] border border-white/10 rounded-lg px-3 py-2 text-sm text-white hover:border-white/20 min-w-[220px] text-left"
      >
        {selected ? (
          <>
            <img src={selected.images.symbol} alt="" className="w-5 h-5 object-contain shrink-0" />
            <span className="truncate flex-1">{selected.name}</span>
          </>
        ) : (
          <span className="text-slate-500 flex-1">Select a set…</span>
        )}
        <span className="text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-80 bg-[#1c1c24] border border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden">
          <div className="p-2 border-b border-white/10">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sets…"
              className="w-full bg-[#13111e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto max-h-80">
            {Array.from(grouped.entries()).map(([series, list]) => (
              <div key={series}>
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider bg-black/20">{series}</div>
                {list.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { onSelect(s.id); setOpen(false); setSearch('') }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 transition-colors ${s.id === selectedId ? 'text-[#ffcb05]' : 'text-white'}`}
                  >
                    <img src={s.images.symbol} alt="" className="w-5 h-5 object-contain shrink-0" />
                    <span className="flex-1 text-left truncate">{s.name}</span>
                    <span className="text-slate-600 text-xs">{s.total}</span>
                  </button>
                ))}
              </div>
            ))}
            {grouped.size === 0 && <div className="px-4 py-6 text-center text-slate-500 text-sm">No sets found</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Card Grid Item ────────────────────────────────────────────────────────────

function CardGridItem({
  card, conditions, onUpdate,
}: {
  card: Card
  conditions: ConditionCount[]
  onUpdate: (conds: ConditionCount[], sel: string) => void
}) {
  const [activeCond, setActiveCond] = useState<Condition>('NM')
  const [hover, setHover] = useState(false)

  const getQty = (c: Condition) => conditions.find(x => x.condition === c)?.quantity ?? 0
  const totalOwned = conditions.reduce((s, c) => s + c.quantity, 0)

  const dominantCond = [...CONDITIONS]
    .filter(c => getQty(c) > 0)
    .sort((a, b) => getQty(b) - getQty(a))[0]

  const borderColor = dominantCond ? condColor(dominantCond) : undefined

  const adjust = (cond: Condition, delta: number) => {
    const next: ConditionCount[] = CONDITIONS.map(c => ({
      condition: c,
      quantity: Math.max(0, getQty(c) + (c === cond ? delta : 0)),
      price: card.prices?.[c.toLowerCase() as keyof typeof card.prices] ?? undefined,
    }))
    onUpdate(next, activeCond)
  }

  const price = card.prices?.[activeCond.toLowerCase() as keyof typeof card.prices]

  return (
    <div
      className="relative bg-[#1c1c24] rounded-xl border transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderColor: totalOwned > 0 ? (borderColor ?? '#6366f144') : '#ffffff14' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && card.images.large && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 pointer-events-none">
          <img src={card.images.large} alt={card.name} className="w-40 rounded-lg shadow-2xl border border-white/20" />
        </div>
      )}

      <div className="p-3 flex gap-3">
        <img src={card.images.small} alt={card.name} className="w-14 h-[78px] object-contain rounded shrink-0" />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate leading-tight">{card.name}</div>
          <div className="text-xs text-slate-500">#{card.number}{card.rarity ? ` · ${card.rarity}` : ''}</div>
          {card.artist && <div className="text-xs text-slate-600 truncate">{card.artist}</div>}
          {price != null && <div className="text-sm font-bold text-[#ffcb05] mt-auto">${price.toFixed(2)}</div>}
        </div>
      </div>

      <div className="px-3 pb-1.5 flex flex-wrap gap-1">
        {CONDITIONS.map(c => {
          const qty = getQty(c)
          const col = condColor(c)
          const active = activeCond === c
          return (
            <button
              key={c}
              onClick={() => setActiveCond(c)}
              style={active || qty > 0 ? { borderColor: col, color: col } : undefined}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${active || qty > 0 ? 'bg-white/5' : 'border-white/10 text-slate-600 hover:text-slate-400'}`}
            >
              {c}{qty > 0 ? ` ${qty}` : ''}
            </button>
          )
        })}
      </div>

      <div className="px-3 pb-3 flex items-center gap-2">
        <button onClick={() => adjust(activeCond, -1)} className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-white text-lg leading-none flex items-center justify-center transition-colors">−</button>
        <span className="text-sm font-bold text-white w-5 text-center">{getQty(activeCond)}</span>
        <button onClick={() => adjust(activeCond, 1)} className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-white text-lg leading-none flex items-center justify-center transition-colors">+</button>
        {totalOwned > 0 && <span className="ml-auto text-xs text-slate-500">{totalOwned} owned</span>}
      </div>
    </div>
  )
}

// ─── Recently Added Sidebar ───────────────────────────────────────────────────

function RecentSidebar({
  recent, onClear, open,
}: { recent: RecentCard[]; onClear: () => void; open: boolean }) {
  const totalValue = recent.reduce((s, r) => s + cardConditionValue(r.card, r.condition) * r.qty, 0)

  if (!open) return null

  return (
    <div className="w-72 shrink-0 bg-[#13111e] border-l border-white/[0.06] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
        <span className="text-xs font-semibold text-slate-300">Recently Added ({recent.length})</span>
        {recent.length > 0 && (
          <button onClick={onClear} className="text-xs text-slate-500 hover:text-red-400 transition-colors">Clear</button>
        )}
      </div>

      {recent.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-600 text-sm">
          <span className="text-3xl">📥</span>
          <span>Quick-add cards below</span>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
            {recent.map((r, i) => {
              const val = cardConditionValue(r.card, r.condition)
              return (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                  <img src={r.card.images.small} alt={r.card.name} className="w-9 h-[50px] object-contain rounded shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{r.card.name}</div>
                    <div className="text-[10px] text-slate-500">#{r.card.number}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-semibold" style={{ color: condColor(r.condition) }}>{r.condition}</span>
                      <span className="text-[10px] text-slate-500">×{r.qty}</span>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-[#ffcb05] shrink-0">${(val * r.qty).toFixed(2)}</div>
                </div>
              )
            })}
          </div>
          <div className="px-3 py-2 border-t border-white/[0.06] flex justify-between items-center">
            <span className="text-xs text-slate-500">Total</span>
            <span className="text-sm font-bold text-[#ffcb05]">${totalValue.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function CollectionPage() {
  const { user } = useUser()
  const qc = useQueryClient()

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [cardSearch, setCardSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('number')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [recent, setRecent] = useState<RecentCard[]>([])

  // Quick-add input state
  const [quickNum, setQuickNum] = useState('')
  const [quickCond, setQuickCond] = useState<Condition>('NM')
  const [quickFeedback, setQuickFeedback] = useState<'ok' | 'err' | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })

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

  const entryMap = useMemo(() => new Map(collection.map(e => [e.cardId, e])), [collection])

  const getConditions = useCallback((cardId: string): ConditionCount[] => {
    return entryMap.get(cardId)?.conditions ?? []
  }, [entryMap])

  const handleUpdate = useCallback((cardId: string, conditions: ConditionCount[], sel: string) => {
    if (!user) return
    updateMutation.mutate({ cardId, conditions, selectedCond: sel })
  }, [user, updateMutation])

  // ── Quick add ────────────────────────────────────────────────────────────────

  const handleQuickAdd = () => {
    if (!user) { setQuickFeedback('err'); setTimeout(() => setQuickFeedback(null), 1500); return }
    if (!selectedSetId || cards.length === 0) { setQuickFeedback('err'); setTimeout(() => setQuickFeedback(null), 1500); return }

    const typed = normalizeNum(quickNum)
    const card = cards.find(c => normalizeNum(c.number) === typed)

    if (!card) {
      setQuickFeedback('err')
      setTimeout(() => setQuickFeedback(null), 1500)
      return
    }

    const existing = entryMap.get(card.id)?.conditions ?? []
    const next: ConditionCount[] = CONDITIONS.map(c => ({
      condition: c,
      quantity: (existing.find(x => x.condition === c)?.quantity ?? 0) + (c === quickCond ? 1 : 0),
      price: card.prices?.[c.toLowerCase() as keyof typeof card.prices] ?? undefined,
    }))
    updateMutation.mutate({ cardId: card.id, conditions: next, selectedCond: quickCond })

    setRecent(prev => {
      const existing = prev.find(r => r.card.id === card.id && r.condition === quickCond)
      if (existing) return prev.map(r => r === existing ? { ...r, qty: r.qty + 1 } : r)
      return [{ card, condition: quickCond, qty: 1 }, ...prev].slice(0, 100)
    })

    setQuickFeedback('ok')
    setTimeout(() => setQuickFeedback(null), 800)
    setQuickNum('')
    quickRef.current?.focus()
    if (!sidebarOpen) setSidebarOpen(true)
  }

  // ── Filtered / sorted cards ──────────────────────────────────────────────────

  const filteredCards = useMemo(() => {
    let list = [...cards]
    if (ownedOnly) list = list.filter(c => entryMap.has(c.id))
    if (cardSearch.trim()) {
      const q = cardSearch.toLowerCase()
      list = list.filter(c => c.name.toLowerCase().includes(q) || normalizeNum(c.number).startsWith(normalizeNum(q)))
    }
    list.sort((a, b) => {
      if (sortKey === 'number') return parseInt(normalizeNum(a.number)) - parseInt(normalizeNum(b.number))
      if (sortKey === 'name')   return a.name.localeCompare(b.name)
      if (sortKey === 'value')  return (b.prices?.nm ?? 0) - (a.prices?.nm ?? 0)
      if (sortKey === 'quantity') {
        const aq = entryMap.get(a.id)?.conditions.reduce((s, c) => s + c.quantity, 0) ?? 0
        const bq = entryMap.get(b.id)?.conditions.reduce((s, c) => s + c.quantity, 0) ?? 0
        return bq - aq
      }
      return 0
    })
    return list
  }, [cards, cardSearch, sortKey, ownedOnly, entryMap])

  const ownedCount = cards.filter(c => entryMap.has(c.id)).length
  const pct = cards.length > 0 ? Math.round((ownedCount / cards.length) * 100) : 0

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">

      {/* Stats bar */}
      {user && stats && (
        <div className="bg-[#13111e] border-b border-white/[0.06] px-4 py-1.5 flex gap-5 text-xs text-slate-400 overflow-x-auto shrink-0">
          <span>Cards: <strong className="text-white">{stats.totalCards}</strong></span>
          <span>Unique: <strong className="text-white">{stats.uniqueCards}</strong></span>
          <span>Value: <strong className="text-[#ffcb05]">${stats.totalValue.toFixed(2)}</strong></span>
          <span>Sets: <strong className="text-white">{stats.setsEntered}</strong></span>
          {selectedSetId && cards.length > 0 && <>
            <span className="border-l border-white/10 pl-5">Set: <strong className="text-white">{ownedCount}/{cards.length}</strong></span>
            <span>Complete: <strong className="text-[#ffcb05]">{pct}%</strong></span>
          </>}
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-[#13111e]/70 border-b border-white/[0.06] px-3 py-2 flex items-center gap-2 shrink-0 flex-wrap">
        <SetSelector sets={sets} selectedId={selectedSetId} onSelect={setSelectedSetId} />

        <input
          value={cardSearch}
          onChange={e => setCardSearch(e.target.value)}
          placeholder="Search cards…"
          className="bg-[#1c1c24] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 w-40"
        />

        <div className="flex items-center gap-0.5 text-xs">
          {(['number', 'name', 'value', 'quantity'] as SortKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`px-2.5 py-1.5 rounded-lg transition-colors ${sortKey === k ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`}
            >
              {k === 'number' ? '#' : k}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input type="checkbox" checked={ownedOnly} onChange={e => setOwnedOnly(e.target.checked)} className="accent-[#ffcb05]" />
          Owned only
        </label>

        {/* Quick add */}
        {selectedSetId && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className={`flex items-center gap-1.5 border rounded-lg px-2 py-1.5 transition-colors ${
              quickFeedback === 'ok'  ? 'border-green-500/60 bg-green-500/10' :
              quickFeedback === 'err' ? 'border-red-500/60 bg-red-500/10' :
              'border-white/10 bg-[#1c1c24]'
            }`}>
              <span className="text-xs text-slate-500">#</span>
              <input
                ref={quickRef}
                value={quickNum}
                onChange={e => setQuickNum(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleQuickAdd()}
                placeholder="Card number"
                className="bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none w-24"
              />
              <select
                value={quickCond}
                onChange={e => setQuickCond(e.target.value as Condition)}
                className="bg-transparent text-xs font-semibold focus:outline-none"
                style={{ color: condColor(quickCond) }}
              >
                {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button
              onClick={handleQuickAdd}
              className="px-3 py-1.5 bg-[#ffcb05] hover:bg-yellow-400 text-black text-xs font-bold rounded-lg transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors border ${sidebarOpen ? 'border-[#ffcb05]/40 text-[#ffcb05]' : 'border-white/10 text-slate-400 hover:text-white'}`}
            >
              {sidebarOpen ? '▶ Hide' : '◀ Recent'}
            </button>
          </div>
        )}
      </div>

      {/* Body: card grid + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Card grid */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!selectedSetId ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
              <span className="text-5xl">🃏</span>
              <p className="text-lg">Select a set to get started</p>
              {!user && <p className="text-sm text-slate-600">Sign in to track your collection</p>}
            </div>
          ) : cardsLoading ? (
            <div className="flex items-center justify-center h-full gap-3 text-slate-500">
              <div className="w-6 h-6 border-2 border-slate-600 border-t-[#ffcb05] rounded-full animate-spin" />
              <span>Loading cards…</span>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
              <span className="text-4xl">🔍</span>
              <p>No cards match</p>
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
              {filteredCards.map(card => (
                <CardGridItem
                  key={card.id}
                  card={card}
                  conditions={getConditions(card.id)}
                  onUpdate={(conds, sel) => handleUpdate(card.id, conds, sel)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <RecentSidebar recent={recent} onClear={() => setRecent([])} open={sidebarOpen && !!selectedSetId} />
      </div>
    </div>
  )
}
