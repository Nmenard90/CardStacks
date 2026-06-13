/**
 * FILE: binders.ts — API calls for binders and their slots.
 * ENDPOINTS USED:
 *   GET    /api/binders/:userId                          — list (slots empty)
 *   POST   /api/binders/:userId                          — create
 *   GET    /api/binders/:userId/:binderId                — one binder + slots
 *   PUT    /api/binders/:userId/:binderId                — rename / set cover
 *   DELETE /api/binders/:userId/:binderId                — delete
 *   PUT    /api/binders/:userId/:binderId/slot/:slotIdx  — place/remove a card
 * USED BY: BinderShelfPage, BinderViewPage, RecentSidebar
 */
import { api } from './client'
import type { Binder, PocketSize } from '../types'

/** All of a user's binders. Slot lists come back empty here. */
export const listBinders = (userId: string) =>
  api.get<Binder[]>(`/api/binders/${userId}`).then(r => r.data)

/** Create a binder. pocketSize is "Four" | "Nine" | "Twelve". */
export const createBinder = (userId: string, name: string, pocketSize: PocketSize) =>
  api.post<Binder>(`/api/binders/${userId}`, { name, pocketSize }).then(r => r.data)

/** One binder with its full slots array. */
export const getBinder = (userId: string, binderId: string) =>
  api.get<Binder>(`/api/binders/${userId}/${binderId}`).then(r => r.data)

/** Rename a binder and/or set its cover image (data URL). */
export const updateBinder = (
  userId: string, binderId: string,
  patch: { name?: string; coverImage?: string },
) => api.put(`/api/binders/${userId}/${binderId}`, patch).then(r => r.data)

/** Delete a binder and all its slots. */
export const deleteBinder = (userId: string, binderId: string) =>
  api.delete(`/api/binders/${userId}/${binderId}`).then(r => r.data)

/** Place a card in a slot — or clear it by passing nulls. */
export const setSlot = (
  userId: string, binderId: string, slotIndex: number,
  card: { cardId?: string; cardName?: string; imageUrl?: string },
) =>
  api.put(`/api/binders/${userId}/${binderId}/slot/${slotIndex}`, {
    cardId: card.cardId ?? null,
    cardName: card.cardName ?? null,
    imageUrl: card.imageUrl ?? null,
  }).then(r => r.data)
