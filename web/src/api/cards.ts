/**
 * API calls for sets and cards.
 * ENDPOINTS: /api/sets, /api/cards/:setId, /api/cards/browse, /api/search, /api/cards/id/:id/price-history
 * USED BY: CollectionPage, BinderViewPage, AnalyzerPage
 */
import { api } from './client'
import type { Card, CardSet, PriceHistoryPoint } from '../types'

export const getSets = () =>
  api.get<CardSet[]>('/api/sets').then(r => r.data)

export const getCards = (setId: string) =>
  api.get<Card[]>(`/api/cards/${setId}`).then(r => r.data)

/** Name or collector-number search across every set. Backend caps at 60 results. */
export const searchCards = (q: string) =>
  api.get<Card[]>('/api/search', { params: { q } }).then(r => r.data)

export type BrowseSort = 'name' | 'price' | 'number' | 'artist' | 'set'

export interface BrowseResult { cards: Card[]; total: number }

/** Cross-set catalog browse (Explore's "All Sets" mode) — paginated and
 *  sorted server-side, since the full catalog is too large to fetch at once. */
export const browseCards = (params: { sort: BrowseSort; dir: 'asc' | 'desc'; page: number; pageSize: number }) =>
  api.get<BrowseResult>('/api/cards/browse', { params }).then(r => r.data)

/** No backfill — only populated from whenever this card's prices started
 *  being tracked, so history may be short or empty. */
export const getPriceHistory = (cardId: string) =>
  api.get<PriceHistoryPoint[]>(`/api/cards/id/${cardId}/price-history`).then(r => r.data)
