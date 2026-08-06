/**
 * API calls for sets and cards.
 * ENDPOINTS: /api/sets, /api/cards/:setId, /api/search, /api/cards/id/:id/price-history
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

/** No backfill — only populated from whenever this card's prices started
 *  being tracked, so history may be short or empty. */
export const getPriceHistory = (cardId: string) =>
  api.get<PriceHistoryPoint[]>(`/api/cards/id/${cardId}/price-history`).then(r => r.data)
