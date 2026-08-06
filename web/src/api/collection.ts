/**
 * API calls for a user's collection.
 * ENDPOINTS: /api/collection/:userId[/stats|/owned|/bulk|/:cardId]
 * USED BY: CollectionPage, AnalyzerPage
 */
import { api } from './client'
import type { CollectionEntry, CollectionStats, ConditionCount, OwnedCard } from '../types'

/** Shape the bulk endpoint expects. */
export interface BulkItem {
  cardId: string
  conditions: ConditionCount[]
  selectedCond: string
}

export const getCollection = (userId: string) =>
  api.get<CollectionEntry[]>(`/api/collection/${userId}`).then(r => r.data)

export const getStats = (userId: string) =>
  api.get<CollectionStats>(`/api/collection/${userId}/stats`).then(r => r.data)

/** Empty conditions list deletes the entry server-side. */
export const saveEntry = (
  userId: string, cardId: string,
  conditions: ConditionCount[], selectedCond: string,
) =>
  api.post<CollectionEntry>(
    `/api/collection/${userId}/${cardId}`, { conditions, selectedCond },
  ).then(r => r.data)

/** Used by CSV import and "clear set" — one round trip instead of N. */
export const bulkSave = (userId: string, items: BulkItem[]) =>
  api.post(`/api/collection/${userId}/bulk`, items).then(r => r.data)

/** Enriched with card name/image/price — avoids N+1 lookups on the owned-cards view. */
export const getOwnedCards = (userId: string) =>
  api.get<OwnedCard[]>(`/api/collection/${userId}/owned`).then(r => r.data)
