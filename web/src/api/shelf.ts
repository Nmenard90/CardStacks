/**
 * API calls for the unified shelf (storage boxes + binders, one ordering).
 * ENDPOINTS: /api/shelf/:userId, /api/shelf/:userId/reorder
 * USED BY: ShelfPage
 */
import { api } from './client'
import type { ShelfEntry } from '../types'

export const getShelf = (userId: string) =>
  api.get<ShelfEntry[]>(`/api/shelf/${userId}`).then(r => r.data)

/** Whole new order in one request — kind/refId/position for every item. */
export const reorderShelf = (userId: string, items: { kind: string; refId: string; position: number }[]) =>
  api.put(`/api/shelf/${userId}/reorder`, { items }).then(r => r.data)
