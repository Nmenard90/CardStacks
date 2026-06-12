import { useState } from 'react'
import type { Card, CollectionEntry, ConditionCount } from '../types'
import { condColor } from './ConditionBadge'

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const

interface Props {
  card: Card
  entry?: CollectionEntry
  onUpdate: (conditions: ConditionCount[], selectedCond: string) => void
}

export function CardItem({ card, entry, onUpdate }: Props) {
  const [activeCond, setActiveCond] = useState(entry?.selectedCond ?? 'NM')
  const [hovering, setHovering] = useState(false)

  const getQty = (cond: string) =>
    entry?.conditions.find(c => c.condition === cond)?.quantity ?? 0

  const totalOwned = entry?.conditions.reduce((s, c) => s + c.quantity, 0) ?? 0

  const dominantCond = entry?.conditions
    .filter(c => c.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity)[0]?.condition

  const borderColor = dominantCond ? condColor(dominantCond) : undefined

  const adjustQty = (cond: string, delta: number) => {
    const conditions: ConditionCount[] = CONDITIONS.map(c => ({
      condition: c,
      quantity: Math.max(0, getQty(c) + (c === cond ? delta : 0)),
      price: card.prices?.[c.toLowerCase() as keyof typeof card.prices] ?? undefined,
    }))
    onUpdate(conditions, activeCond)
  }

  const price = card.prices?.[activeCond.toLowerCase() as keyof typeof card.prices]

  return (
    <div
      className="relative bg-[#1c1c24] rounded-xl border transition-all duration-150 hover:-translate-y-1 hover:shadow-xl group"
      style={{ borderColor: totalOwned > 0 ? (borderColor ?? '#6366f144') : '#ffffff14' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Large image preview on hover */}
      {hovering && card.images.large && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 pointer-events-none">
          <img
            src={card.images.large}
            alt={card.name}
            className="w-40 rounded-lg shadow-2xl border border-white/20"
          />
        </div>
      )}

      <div className="p-3 flex gap-3">
        {/* Thumbnail */}
        <img
          src={card.images.small}
          alt={card.name}
          className="w-16 h-[88px] object-contain rounded shrink-0"
        />

        {/* Info */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{card.name}</div>
          <div className="text-xs text-slate-500">#{card.number} · {card.rarity ?? '—'}</div>
          {card.artist && <div className="text-xs text-slate-600 truncate">{card.artist}</div>}
          {price != null && (
            <div className="text-sm font-bold text-[#ffcb05]">${price.toFixed(2)}</div>
          )}
        </div>
      </div>

      {/* Condition row */}
      <div className="px-3 pb-2 flex flex-wrap gap-1">
        {CONDITIONS.map(cond => {
          const qty = getQty(cond)
          const color = condColor(cond)
          const isActive = activeCond === cond
          return (
            <button
              key={cond}
              onClick={() => setActiveCond(cond)}
              style={isActive || qty > 0 ? { borderColor: color, color: color } : undefined}
              className={`px-2 py-0.5 rounded text-xs font-semibold border transition-all ${
                isActive || qty > 0 ? 'bg-white/5' : 'border-white/10 text-slate-600 hover:text-slate-400'
              }`}
            >
              {cond}{qty > 0 ? ` ${qty}` : ''}
            </button>
          )
        })}
      </div>

      {/* Qty controls (active condition) */}
      <div className="px-3 pb-3 flex items-center gap-2">
        <button
          onClick={() => adjustQty(activeCond, -1)}
          className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-lg leading-none transition-colors"
        >
          −
        </button>
        <span className="text-sm font-bold text-white w-6 text-center">{getQty(activeCond)}</span>
        <button
          onClick={() => adjustQty(activeCond, 1)}
          className="w-7 h-7 rounded bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-lg leading-none transition-colors"
        >
          +
        </button>
        {totalOwned > 0 && (
          <span className="ml-auto text-xs text-slate-500">{totalOwned} owned</span>
        )}
      </div>
    </div>
  )
}
