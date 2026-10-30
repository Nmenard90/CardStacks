/**
 * RequestedCards — one shop request as a pull list: the cards grouped by set (oldest set first, then card number) so
 * each box is opened once, how many cards there are and how many are found, and the total at today's prices. Each card
 * shows its picture, price and where it's kept (box › compartment, binder page and pocket, or display case), a Found
 * button, and its condition, which the seller confirms or changes with the copy in hand (the price follows).
 *
 * HOW IT WORKS
 *   A request records card id, name, number, condition and quantity, plus what the pull list adds (pulled, and the
 *   buyer's original pick once the condition changed). The picture, set and price come from the seller's own
 *   collection (the shop only lists owned cards); the places come from /card-locations. Both are shared, cached
 *   queries, so a page of requests asks once. A card the seller no longer owns falls back to the recorded text.
 *   Found and condition changes show at once (written into the cached inbox) and are saved one card at a time; a
 *   failed save puts the inbox back as the server has it and says so.
 *
 * USED BY: pages/ShopRequestsPage.tsx
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSets } from '../api/cards'
import { getOwnedCards } from '../api/collection'
import { getCardLocations, type CardLocation } from '../api/rooms'
import { updateShopRequestItem, type ShopRequest, type ShopRequestItem } from '../api/shop'
import { CONDS, COND_COLORS, condPrice } from '../lib/conditions'
import type { OwnedCard } from '../types'
import type { usePreview } from './CardPreview'
import { CardThumb } from './CardThumb'

/** Pockets per binder page, by pocket size (same grids as the binder page and the 3D room). */
const POCKETS_PER_PAGE: Record<string, number> = { Four: 4, Nine: 9, Twelve: 12 }

const money = (n: number) => `$${n.toFixed(2)}`

/** Card numbers in reading order: 2 before 10, "TG05" after "TG4". */
const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** "Base Set Box › Holos", "Trade Binder · page 3, pocket 4", "Grail Cabinet (display)". */
function placeLabel(l: CardLocation): string {
  if (l.kind === 'box') return l.part ? `${l.container} › ${l.part}` : l.container
  if (l.kind === 'binder') {
    const per = POCKETS_PER_PAGE[l.pocketSize ?? 'Nine'] ?? 9
    const slot = l.slotIndex ?? 0
    return `${l.container} · page ${Math.floor(slot / per) + 1}, pocket ${(slot % per) + 1}`
  }
  return `${l.container} (display)`
}

const ICON: Record<CardLocation['kind'], string> = { box: '📦', binder: '📒', display: '🖼' }

/**
 * @param requestId the request these cards belong to
 * @param items     the request's cards
 * @param userId    the seller (the signed-in owner)
 * @param preview   the page's zoom (usePreview): hovering or tapping a card's picture shows it big
 */
export function RequestedCards({ requestId, items, userId, preview }: { requestId: string; items: ShopRequestItem[]; userId: string; preview?: ReturnType<typeof usePreview> }) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const { data: owned = [] } = useQuery({ queryKey: ['owned', userId], queryFn: () => getOwnedCards(userId), enabled: !!userId })
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const ids = [...new Set(items.map(i => i.cardId))].sort()
  const { data: places = [], isLoading: placesLoading } = useQuery({
    queryKey: ['card-locations', userId, ids.join(',')],
    queryFn: () => getCardLocations(userId, ids),
    enabled: !!userId && ids.length > 0,
  })
  const byId = new Map<string, OwnedCard>(owned.map(o => [o.cardId, o]))
  const setInfo = new Map(sets.map(s => [s.id, s]))

  /** Shows the change at once (same rule as the server's), then saves it; a failed save reloads the inbox as stored. */
  const change = async (index: number, edit: { pulled?: boolean; condition?: string }) => {
    const key = ['shop-requests', userId]
    const local = (item: ShopRequestItem): ShopRequestItem => {
      if (!edit.condition) return { ...item, ...edit }
      const asked = item.askedCondition ?? item.condition
      const condition = edit.condition + item.condition.slice(item.condition.split(' ')[0].length) // keeps " 1st Edition"
      return { ...item, ...edit, condition, askedCondition: condition === asked ? undefined : asked }
    }
    qc.setQueryData<ShopRequest[]>(key, rs => rs?.map(r => r.id !== requestId ? r : { ...r, items: r.items.map((it, n) => n === index ? local(it) : it) }))
    setError('')
    try { await updateShopRequestItem(userId, requestId, index, edit) }
    catch { setError("Couldn't save that. Check your connection and try again."); qc.invalidateQueries({ queryKey: key }) }
  }

  const priceOf = (item: ShopRequestItem) => { const card = byId.get(item.cardId)?.card; return card ? condPrice(card, item.condition) : 0 }
  const count = items.reduce((n, item) => n + item.qty, 0)
  const found = items.reduce((n, item) => n + (item.pulled ? item.qty : 0), 0)
  const total = items.reduce((sum, item) => sum + priceOf(item) * item.qty, 0)
  const unpriced = items.reduce((n, item) => n + (priceOf(item) > 0 ? 0 : item.qty), 0)

  // Grouped by set, oldest set first (the order boxes and binders usually follow), card number within a set.
  // Cards no longer in the collection have no set to go by and come last.
  const groups = new Map<string, { index: number; item: ShopRequestItem }[]>()
  items.forEach((item, index) => {
    const setId = byId.get(item.cardId)?.card.setId ?? ''
    groups.set(setId, [...(groups.get(setId) ?? []), { index, item }])
  })
  const released = (setId: string) => setInfo.get(setId)?.releaseDate ?? '9999'
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    Number(!a) - Number(!b) || released(a).localeCompare(released(b)) || a.localeCompare(b))

  const row = ({ index, item }: { index: number; item: ShopRequestItem }) => {
    const card = byId.get(item.cardId)?.card
    const each = priceOf(item)
    const here = places.filter(p => p.cardId === item.cardId)
    // The copies in the requested condition first; a binder pocket with no stored copy has no condition to compare.
    const cond = item.condition.split(' ')[0]
    here.sort((a, b) => Number(b.condition?.split(' ')[0] === cond) - Number(a.condition?.split(' ')[0] === cond))
    return (
      <li key={index} className={'req-card' + (item.pulled ? ' req-card--found' : '')}>
        {card ? <CardThumb card={card} showPrice={false} preview={preview} className="req-card__thumb" /> : <div className="thumb-placeholder req-card__thumb">🃏</div>}
        <div className="req-card__body">
          <div className="req-card__title"><b>{item.qty}× {item.name}</b> <span>#{item.number}</span></div>
          <div className="req-card__meta">
            {card ? setInfo.get(card.setId)?.name ?? card.setId : 'No longer in your collection'} · {item.condition}
            {each > 0 && <> · {money(each)}{item.qty > 1 && <> each ({money(each * item.qty)})</>}</>}
          </div>
          <ul className="req-card__places" aria-label={`Where ${item.name} is kept`}>
            {placesLoading ? <li className="req-card__place--none">Finding where it's kept…</li>
              : here.length === 0 ? <li className="req-card__place--none">Not in a box, binder or display case yet</li>
              : here.map((p, k) => (
                <li key={k} className={p.condition && p.condition.split(' ')[0] !== cond ? 'req-card__place--other' : undefined}>
                  <span aria-hidden="true">{ICON[p.kind]}</span> {placeLabel(p)}
                  {p.condition && <> · {p.quantity}× {p.condition}</>}
                </li>
              ))}
          </ul>
          <div className="req-card__conds" role="group" aria-label={`Condition of ${item.name}`}>
            {CONDS.map(c => (
              <button key={c} type="button" className="req-cond" aria-pressed={c === cond} style={{ '--cond': COND_COLORS[c] } as React.CSSProperties}
                onClick={() => { if (c !== cond) change(index, { condition: c }) }}>{c}</button>
            ))}
            {item.askedCondition && <span className="req-card__asked">Buyer picked {item.askedCondition}</span>}
          </div>
        </div>
        <button type="button" className="req-found" aria-pressed={!!item.pulled} onClick={() => change(index, { pulled: !item.pulled })}>
          <span aria-hidden="true">{item.pulled ? '✓' : ''}</span>{item.pulled ? 'Found' : 'Find'}
        </button>
      </li>
    )
  }

  return (
    <div className="req-cards">
      <p className="req-cards__summary">
        <b>{found} of {count}</b> card{count === 1 ? '' : 's'} found · Total <b>{money(total)}</b>
        {unpriced > 0 && <span> ({unpriced} without a price)</span>}
      </p>
      {error && <p className="req-cards__error" role="alert">{error}</p>}
      {ordered.map(([setId, rows]) => (
        <section key={setId || 'none'} className="req-set">
          <h4 className="req-set__name">
            {setId ? setInfo.get(setId)?.name ?? setId : 'No longer in your collection'}
            <span> · {rows.reduce((n, r) => n + r.item.qty, 0)}</span>
          </h4>
          <ul className="req-cards__list">{[...rows].sort((a, b) => byNumber(a.item.number, b.item.number)).map(row)}</ul>
        </section>
      ))}
    </div>
  )
}
