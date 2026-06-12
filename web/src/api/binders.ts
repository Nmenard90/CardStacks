import { api } from './client'
import type { Binder, PocketSize } from '../types'

export const getBinders = (userId: string) =>
  api.get<Binder[]>(`/api/binders/${userId}`).then(r => r.data)

export const getBinder = (userId: string, binderId: string) =>
  api.get<Binder>(`/api/binders/${userId}/${binderId}`).then(r => r.data)

export const createBinder = (userId: string, name: string, pocketSize: PocketSize) =>
  api.post<Binder>(`/api/binders/${userId}`, { name, pocketSize }).then(r => r.data)

export const updateBinder = (
  userId: string,
  binderId: string,
  patch: { name?: string; coverImage?: string },
) =>
  api.put(`/api/binders/${userId}/${binderId}`, patch).then(r => r.data)

export const deleteBinder = (userId: string, binderId: string) =>
  api.delete(`/api/binders/${userId}/${binderId}`).then(r => r.data)

export const updateSlot = (
  userId: string,
  binderId: string,
  slotIndex: number,
  slot: { cardId?: string; cardName?: string; imageUrl?: string },
) =>
  api
    .put(`/api/binders/${userId}/${binderId}/slot/${slotIndex}`, slot)
    .then(r => r.data)
