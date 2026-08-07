/**
 * API calls for binders and their slots.
 * ENDPOINTS: /api/binders/:userId[/:binderId[/slot/:slotIdx]]
 * USED BY: ShelfPage, BinderViewPage, RecentSidebar
 */
import { api } from './client'
import type { Binder, PocketSize } from '../types'

/** Slot lists come back empty — full slots are fetched per-binder via getBinder. */
export const listBinders = (userId: string) =>
  api.get<Binder[]>(`/api/binders/${userId}`).then(r => r.data)

export const createBinder = (userId: string, name: string, pocketSize: PocketSize) =>
  api.post<Binder>(`/api/binders/${userId}`, { name, pocketSize }).then(r => r.data)

export const getBinder = (userId: string, binderId: string) =>
  api.get<Binder>(`/api/binders/${userId}/${binderId}`).then(r => r.data)

/** Partial update — only the fields present in `patch` change. */
export const updateBinder = (
  userId: string, binderId: string,
  patch: { name?: string; coverImage?: string; pocketSize?: PocketSize },
) => api.put(`/api/binders/${userId}/${binderId}`, patch).then(r => r.data)

export const deleteBinder = (userId: string, binderId: string) =>
  api.delete(`/api/binders/${userId}/${binderId}`).then(r => r.data)

/** Sends explicit nulls (not omitted fields) to clear a slot — the backend
 *  distinguishes "clear this" from "field not sent." */
export const setSlot = (
  userId: string, binderId: string, slotIndex: number,
  card: { cardId?: string; cardName?: string; imageUrl?: string },
) =>
  api.put(`/api/binders/${userId}/${binderId}/slot/${slotIndex}`, {
    cardId: card.cardId ?? null,
    cardName: card.cardName ?? null,
    imageUrl: card.imageUrl ?? null,
  }).then(r => r.data)
