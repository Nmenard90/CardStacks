import { api } from './client'
import type { CollectionEntry, CollectionStats, ConditionCount } from '../types'

export const getCollection = (userId: string) =>
  api.get<CollectionEntry[]>(`/api/collection/${userId}`).then(r => r.data)

export const getCollectionStats = (userId: string) =>
  api.get<CollectionStats>(`/api/collection/${userId}/stats`).then(r => r.data)

export const updateCollectionEntry = (
  userId: string,
  cardId: string,
  conditions: ConditionCount[],
  selectedCond: string,
) =>
  api
    .post<CollectionEntry | { deleted: boolean }>(
      `/api/collection/${userId}/${cardId}`,
      { conditions, selectedCond },
    )
    .then(r => r.data)

export const bulkUpdateCollection = (
  userId: string,
  items: { cardId: string; conditions: ConditionCount[]; selectedCond: string }[],
) =>
  api
    .post(`/api/collection/${userId}/bulk`, items)
    .then(r => r.data)
