/**
 * RequestedCards — the cards in one shop request, as the seller needs them: picture, set, today's price, and where
 * each one is kept (box › compartment, binder page and pocket, or display case), so a request can be answered without
 * hunting for the cards.
 *
 * HOW IT WORKS
 *   A request only records card id, name, number, condition and quantity. The picture, set and price come from the
 *   seller's own collection (the shop only lists owned cards); the places come from /card-locations. Both are shared,
 *   cached queries, so a page of requests asks once. A card the seller no longer owns falls back to the recorded text.
 *
 * USED BY: pages/ShopRequestsPage.tsx
 */
import { useQuery } from '@tanstack/react-query'
import { getSets } from '../api/cards'
import { getOwnedCards } from '../api/collection'
import { getCardLocations, type CardLocation } from '../api/rooms'
import type { ShopRequestItem } from '../api/shop'
import { condPrice } from '../lib/conditions'
import type { OwnedCard } from '../types'
import { CardThumb } from './CardThumb'

/** Pockets per binder page, by pocket size (same grids as the binder page and the 3D room). */
const POCKETS_PER_PAGE: Record<string, number> = { Four: 4, Nine: 9, Twelve: 12 }

const money = (n: number) => `$${n.toFixed(2)}`

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
 * @param items   the request's cards
 * @param userId  the seller (the signed-in owner)
 */
export function RequestedCards({ items, userId }: { items: ShopRequestItem[]; userId: string }) {
  const { data: owned = [] } = useQuery({ queryKey: ['owned', userId], queryFn: () => getOwnedCards(userId), enabled: !!userId })
  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: getSets })
  const ids = [...new Set(items.map(i => i.cardId))].sort()
  const { data: places = [], isLoading: placesLoading } = useQuery({
    queryKey: ['card-locations', userId, ids.join(',')],
    queryFn: () => getCardLocations(userId, ids),
    enabled: !!userId && ids.length > 0,
  })
  const byId = new Map<string, OwnedCard>(owned.map(o => [o.cardId, o]))
  const setName = new Map(sets.map(s => [s.id, s.name]))

  const priceOf = (item: ShopRequestItem) => { const card = byId.get(item.cardId)?.card; return card ? condPrice(card, item.condition) : 0 }
  const total = items.reduce((sum, item) => sum + priceOf(item) * item.qty, 0)
  const rows = items.map((item, n) => {
    const card = byId.get(item.cardId)?.card
    const each = priceOf(item)
    const here = places.filter(p => p.cardId === item.cardId)
    // The copies in the requested condition first; a binder pocket with no stored copy has no condition to compare.
    const cond = item.condition.split(' ')[0]
    here.sort((a, b) => Number(b.condition?.split(' ')[0] === cond) - Number(a.condition?.split(' ')[0] === cond))
    return (
      <li key={n} className="req-card">
        {card ? <CardThumb card={card} showPrice={false} className="req-card__thumb" /> : <div className="thumb-placeholder req-card__thumb">🃏</div>}
        <div className="req-card__body">
          <div className="req-card__title"><b>{item.qty}× {item.name}</b> <span>#{item.number}</span></div>
          <div className="req-card__meta">
            {card ? setName.get(card.setId) ?? card.setId : 'No longer in your collection'} · {item.condition}
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
        </div>
      </li>
    )
  })

  return (
    <div className="req-cards">
      <ul className="req-cards__list">{rows}</ul>
      {total > 0 && <p className="req-cards__total">About <b>{money(total)}</b> at today's prices</p>}
    </div>
  )
}
