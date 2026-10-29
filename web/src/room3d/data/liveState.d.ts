/** Types for liveState.js, as used from useLiveRoom.ts. RoomState is the room's own (JS) contract — see contracts.js. */
import type { Binder, Card } from '../../types'
export type RoomState = Record<string, unknown> & { meta: Record<string, unknown> }
export function setIdOf(cardId: string): string | null
export function unknownPocketCards(binders: Pick<Binder, 'slots'>[], known: Record<string, unknown>): string[]
export function buildLiveState(input: {
  userId: string
  spaces: unknown[]; boxes: unknown[]; binders: Binder[]; lots: unknown[]; allocations: unknown[]
  cards: Card[]
  ownedCopies: number
  priceOf: (card: Card, lot: { condition: string; edition: string; variantKey: string }) => { price: number | null; printLabel: string | null }
}): RoomState
