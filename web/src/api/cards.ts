/**
 * FILE: cards.ts — API calls for sets and cards.
 * ENDPOINTS USED:
 *   GET /api/sets               — all sets
 *   GET /api/cards/:setId       — cards in a set, with prices
 *   GET /api/search?q=…         — search cards by name (max 60)
 * USED BY: CollectionPage, BinderViewPage, AnalyzerPage
 */
import { api } from './client'
import type { Card, CardSet } from '../types'

/** All sets known to the backend. */
export const getSets = () =>
  api.get<CardSet[]>('/api/sets').then(r => r.data)

/** All cards in one set, prices included. */
export const getCards = (setId: string) =>
  api.get<Card[]>(`/api/cards/${setId}`).then(r => r.data)

/** Name or collector-number search across every set. Backend caps results at 60. */
export const searchCards = (q: string) =>
  api.get<Card[]>('/api/search', { params: { q } }).then(r => r.data)
