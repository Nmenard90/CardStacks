/**
 * API calls for physical storage (boxes → drawers → card assignment).
 * ENDPOINTS: /api/storage/:userId/boxes[...], /api/storage/boxes|drawers/:id, /api/storage/:userId/assign[...]
 * USED BY: OwnedPage (Shelf view)
 */
import { api } from './client'
import type { AssignResult, OwnedCard, StorageBox, StorageDrawer } from '../types'

/** Drawers come pre-attached to each box. */
export const listBoxes = (userId: string) =>
  api.get<StorageBox[]>(`/api/storage/${userId}/boxes`).then(r => r.data)

export const createBox = (userId: string, name: string, boxType = 'custom', capacity = 0, color = '#B99B67') =>
  api.post<StorageBox>(`/api/storage/${userId}/boxes`, { name, boxType, capacity, color }).then(r => r.data)

/** Partial update — only fields present in `patch` change. */
export const updateBox = (boxId: string, patch: { name?: string; position?: number }) =>
  api.put(`/api/storage/boxes/${boxId}`, patch).then(r => r.data)

/** Cascades to its drawers; cards inside become unassigned, not deleted. */
export const deleteBox = (boxId: string) =>
  api.delete(`/api/storage/boxes/${boxId}`).then(r => r.data)

export const createDrawer = (boxId: string, name: string) =>
  api.post<StorageDrawer>(`/api/storage/boxes/${boxId}/drawers`, { name }).then(r => r.data)

export const updateDrawer = (drawerId: string, patch: { name?: string; position?: number }) =>
  api.put(`/api/storage/drawers/${drawerId}`, patch).then(r => r.data)

/** Cards inside become unassigned, not deleted. */
export const deleteDrawer = (drawerId: string) =>
  api.delete(`/api/storage/drawers/${drawerId}`).then(r => r.data)

export const getDrawerCards = (drawerId: string) =>
  api.get<OwnedCard[]>(`/api/storage/drawers/${drawerId}/cards`).then(r => r.data)

export const getUnassignedCards = (userId: string) =>
  api.get<OwnedCard[]>(`/api/storage/${userId}/unassigned`).then(r => r.data)

/** Batched — one request for N cards instead of N requests. */
export const assignCards = (userId: string, cardIds: string[], drawerId: string) =>
  api.post<AssignResult>(`/api/storage/${userId}/assign`, { cardIds, drawerId }).then(r => r.data)

export const unassignCard = (userId: string, cardId: string) =>
  api.delete(`/api/storage/${userId}/assign/${cardId}`).then(r => r.data)
