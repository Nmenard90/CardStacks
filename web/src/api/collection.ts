/**
 * FILE: collection.ts — API calls for a user's collection.
 * ENDPOINTS USED:
 *   GET  /api/collection/:userId          — all entries
 *   GET  /api/collection/:userId/stats    — totals across sets
 *   POST /api/collection/:userId/:cardId  — replace one card's conditions
 *   POST /api/collection/:userId/bulk     — replace many cards at once
 * USED BY: CollectionPage, AnalyzerPage
 */
import { api } from './client'
import type { CollectionEntry, CollectionStats, ConditionCount } from '../types'

/** One card update as the bulk endpoint expects it. */
export interface BulkItem {
  cardId: string
  conditions: ConditionCount[]
  selectedCond: string
}

/** Every collection entry for a user. */
export const getCollection = (userId: string) =>
  api.get<CollectionEntry[]>(`/api/collection/${userId}`).then(r => r.data)

/** Whole-collection stats (total cards, value, sets entered). */
export const getStats = (userId: string) =>
  api.get<CollectionStats>(`/api/collection/${userId}/stats`).then(r => r.data)

/** Replace one card's condition counts. Empty list clears the card. */
export const saveEntry = (
  userId: string, cardId: string,
  conditions: ConditionCount[], selectedCond: string,
) =>
  api.post<CollectionEntry>(
    `/api/collection/${userId}/${cardId}`, { conditions, selectedCond },
  ).then(r => r.data)

/** Replace many cards in one request — used by CSV import and Clear set. */
export const bulkSave = (userId: string, items: BulkItem[]) =>
  api.post(`/api/collection/${userId}/bulk`, items).then(r => r.data)
