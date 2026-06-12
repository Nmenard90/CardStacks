const COND_COLORS: Record<string, string> = {
  NM:  '#22c55e',
  LP:  '#84cc16',
  MP:  '#eab308',
  HP:  '#f97316',
  DMG: '#ef4444',
}

export const condColor = (cond: string) => COND_COLORS[cond] ?? '#6366f1'

interface Props {
  condition: string
  count?: number
  selected?: boolean
  onClick?: () => void
  size?: 'sm' | 'md'
}

export function ConditionBadge({ condition, count, selected, onClick, size = 'md' }: Props) {
  const color = condColor(condition)
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'

  return (
    <button
      onClick={onClick}
      style={selected ? { borderColor: color, color: color, backgroundColor: `${color}22` } : undefined}
      className={`${pad} rounded font-semibold border transition-all ${
        selected
          ? ''
          : 'border-white/10 text-slate-400 hover:border-white/30 hover:text-white'
      }`}
    >
      {condition}{count !== undefined ? ` ${count}` : ''}
    </button>
  )
}
