/**
 * shopSale — what to refresh after a shop sale takes cards out of the seller's collection (or puts them back):
 * the inbox, and everything that shows what they own (collection, stats, where cards are kept, their shop page).
 *
 * USED BY: pages/ShopRequestsPage.tsx, components/RequestedCards.tsx
 */
import type { QueryClient } from '@tanstack/react-query'

export function afterInventoryChange(qc: QueryClient, userId: string) {
  for (const key of ['shop-requests', 'owned', 'stats', 'card-locations']) qc.invalidateQueries({ queryKey: [key, userId] })
  qc.invalidateQueries({ queryKey: ['shop'] })
}
