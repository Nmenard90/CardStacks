import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getBinder, updateSlot } from '../api/binders'
import { getCardsBySet } from '../api/cards'
import { getSets } from '../api/cards'
import { useUser } from '../context/UserContext'
import type { PocketSize, Card } from '../types'

const COLS: Record<PocketSize, number> = { Four: 2, Nine: 3, Twelve: 4 }
const ROWS: Record<PocketSize, number> = { Four: 2, Nine: 3, Twelve: 3 }

function slotsPerPage(size: PocketSize) {
  return COLS[size] * ROWS[size]
}

interface CardPickerProps {
  onPick: (card: Card | null) => void
  onClose: () => void
}

function CardPicker({ onPick, onClose }: CardPickerProps) {
  const [setId, setSetId] = useState('')
  const [search, setSearch] = useState('')

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const { data: cards = [] } = useQuery({
    queryKey: ['cards', setId],
    queryFn: () => getCardsBySet(setId),
    enabled: !!setId,
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return cards
    const q = search.toLowerCase()
    return cards.filter(c => c.name.toLowerCase().includes(q) || c.number.includes(q))
  }, [cards, search])

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 h-1/2 bg-[#1c1c24] border-t border-white/10 shadow-2xl flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <select
          value={setId}
          onChange={e => { setSetId(e.target.value); setSearch('') }}
          className="bg-[#13111e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
        >
          <option value="">Choose a set…</option>
          {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search cards…"
          className="bg-[#13111e] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none flex-1"
        />
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none px-2">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!setId ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">Select a set to browse cards</div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}>
            {/* Clear slot option */}
            <button
              onClick={() => onPick(null)}
              className="aspect-[2.5/3.5] rounded-lg border-2 border-dashed border-red-500/40 hover:border-red-500 flex items-center justify-center text-red-400 hover:text-red-300 text-xs transition-colors"
            >
              Clear
            </button>
            {filtered.map(card => (
              <button
                key={card.id}
                onClick={() => onPick(card)}
                className="aspect-[2.5/3.5] rounded-lg overflow-hidden border border-white/10 hover:border-indigo-500 transition-all hover:scale-105 hover:shadow-lg"
              >
                <img src={card.images.small} alt={card.name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function BinderViewPage() {
  const { binderId } = useParams<{ binderId: string }>()
  const navigate = useNavigate()
  const { user } = useUser()
  const qc = useQueryClient()

  const [page, setPage] = useState(0) // 0-indexed page pair
  const [pickerSlot, setPickerSlot] = useState<number | null>(null)

  const { data: binder, isLoading } = useQuery({
    queryKey: ['binder', binderId],
    queryFn: () => getBinder(user!.id, binderId!),
    enabled: !!user && !!binderId,
  })

  const slotMutation = useMutation({
    mutationFn: ({ slotIndex, card }: { slotIndex: number; card: Card | null }) =>
      updateSlot(user!.id, binderId!, slotIndex, card
        ? { cardId: card.id, cardName: card.name, imageUrl: card.images.small }
        : {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['binder', binderId] }),
  })

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] gap-4 text-slate-500">
        <span className="text-5xl">📚</span>
        <p>Sign in to view binders</p>
      </div>
    )
  }

  if (isLoading || !binder) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-52px)] gap-3 text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-600 border-t-[#ffcb05] rounded-full animate-spin" />
        <span>Loading binder…</span>
      </div>
    )
  }

  const size = binder.pocketSize
  const perPage = slotsPerPage(size)
  const totalSlots = binder.slots.length
  const totalPages = Math.ceil(totalSlots / perPage)
  const maxPagePairs = Math.ceil(totalPages / 2)

  // The current spread shows pages (page*2) and (page*2+1)
  const leftPageNum  = page * 2
  const rightPageNum = page * 2 + 1

  const getPageSlots = (pageNum: number) => {
    const start = pageNum * perPage
    return Array.from({ length: perPage }, (_, i) => {
      const slotIndex = start + i
      return binder.slots.find(s => s.slotIndex === slotIndex) ?? { slotIndex, cardId: undefined, cardName: undefined, imageUrl: undefined }
    })
  }

  const leftSlots  = leftPageNum  < totalPages ? getPageSlots(leftPageNum)  : []
  const rightSlots = rightPageNum < totalPages ? getPageSlots(rightPageNum) : []

  const cols = COLS[size]
  const rows = ROWS[size]

  const renderPage = (slots: typeof leftSlots, side: 'left' | 'right') => (
    <div
      className={`flex-1 bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border border-white/[0.07] p-4 relative ${
        side === 'left' ? 'rounded-l-xl border-r-0' : 'rounded-r-xl'
      }`}
      style={{
        boxShadow: side === 'left'
          ? 'inset -4px 0 8px rgba(0,0,0,0.4)'
          : 'inset 4px 0 8px rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="grid gap-2 h-full"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      >
        {slots.map(slot => (
          <button
            key={slot.slotIndex}
            onClick={() => setPickerSlot(slot.slotIndex)}
            className={`rounded-lg border-2 aspect-[2.5/3.5] overflow-hidden transition-all hover:scale-[1.04] hover:shadow-lg ${
              slot.cardId
                ? 'border-indigo-500/20 hover:border-indigo-500/60'
                : 'border-dashed border-indigo-500/20 hover:border-indigo-500/40 flex items-center justify-center'
            }`}
          >
            {slot.imageUrl ? (
              <img src={slot.imageUrl} alt={slot.cardName ?? ''} className="w-full h-full object-cover" />
            ) : (
              <span className="text-indigo-500/30 text-xl">+</span>
            )}
          </button>
        ))}
      </div>

      {/* Page number */}
      <div className={`absolute bottom-2 ${side === 'left' ? 'left-3' : 'right-3'} text-xs text-slate-600`}>
        {(side === 'left' ? leftPageNum : rightPageNum) + 1}
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Top bar */}
      <div className="bg-[#13111e] border-b border-white/[0.06] px-4 h-12 flex items-center gap-4 shrink-0">
        <button
          onClick={() => navigate('/binders')}
          className="text-slate-400 hover:text-white transition-colors text-sm"
        >
          ← Shelf
        </button>
        <span className="text-white font-semibold text-sm">{binder.name}</span>
        <span className="text-slate-500 text-xs">{binder.pocketSize}-pocket</span>
        <span className="ml-auto text-xs text-slate-500">
          Pages {leftPageNum + 1}–{Math.min(rightPageNum + 1, totalPages)}
        </span>
      </div>

      {/* Flipbook area */}
      <div className="flex-1 flex items-center justify-center gap-4 px-8 py-6 overflow-hidden">
        {/* Left arrow */}
        <button
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-lg disabled:opacity-20 transition-colors shrink-0"
        >
          ‹
        </button>

        {/* Spine + pages */}
        <div className="flex h-full max-h-[600px] max-w-4xl w-full">
          {/* Spine */}
          <div className="w-7 bg-gradient-to-b from-indigo-800 via-indigo-900 to-indigo-800 rounded-lg flex flex-col justify-evenly items-center py-4 shadow-lg shrink-0 z-10">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="w-5 h-5 rounded-full border-2 border-indigo-400/30"
                style={{ background: 'conic-gradient(from 0deg, #6366f1, #4338ca, #6366f1)' }}
              />
            ))}
          </div>

          {renderPage(leftSlots, 'left')}
          {rightSlots.length > 0 && renderPage(rightSlots, 'right')}
        </div>

        {/* Right arrow */}
        <button
          onClick={() => setPage(p => Math.min(maxPagePairs - 1, p + 1))}
          disabled={page >= maxPagePairs - 1}
          className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-lg disabled:opacity-20 transition-colors shrink-0"
        >
          ›
        </button>
      </div>

      {/* Card picker */}
      {pickerSlot !== null && (
        <CardPicker
          onPick={card => {
            slotMutation.mutate({ slotIndex: pickerSlot, card })
            setPickerSlot(null)
          }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  )
}
