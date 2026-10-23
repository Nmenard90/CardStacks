/**
 * API calls for a user's public shop page, shop settings, and request inbox.
 * ENDPOINTS: GET /api/shop/:slug, POST /api/shop/:slug/requests (public, no login),
 *            GET|PUT /api/collection/:userId/shop-settings,
 *            GET /api/collection/:userId/shop-requests,
 *            POST /api/collection/:userId/shop-requests/:id (owner only)
 * USED BY: ShopPage, ShopRequestsPage
 */
import { api } from './client'
import type { OwnedCard } from '../types'

export interface ShopRequestItem {
  cardId: string
  name: string
  number: string
  condition: string
  qty: number
}

export interface ShopRequestInput {
  buyerName: string
  buyerContact: string
  message: string
  items: ShopRequestItem[]
}

export type ShopRequestStatus = 'new' | 'answered' | 'done'

export interface ShopRequest extends ShopRequestInput {
  id: string
  kind: 'buy' | 'chat'
  status: ShopRequestStatus
  createdAt: string
}

/** What the public page receives: the Messenger link plus the cards, private fields already removed. */
export interface ShopView {
  messengerUrl: string
  cards: OwnedCard[]
}

/** The owner's switch for their shop. enabled=false means nobody can see it. */
export interface ShopSettings {
  slug: string
  enabled: boolean
  messengerUrl: string
}

export const getShop = (slug: string) =>
  api.get<ShopView>(`/api/shop/${encodeURIComponent(slug)}`).then(r => r.data)

export const sendShopRequest = (slug: string, input: ShopRequestInput) =>
  api.post<{ ok: boolean }>(`/api/shop/${encodeURIComponent(slug)}/requests`, input).then(r => r.data)

export const getShopSettings = (userId: string) =>
  api.get<ShopSettings>(`/api/collection/${userId}/shop-settings`).then(r => r.data)

export const saveShopSettings = (userId: string, settings: ShopSettings) =>
  api.put<ShopSettings>(`/api/collection/${userId}/shop-settings`, settings).then(r => r.data)

export const getShopRequests = (userId: string) =>
  api.get<ShopRequest[]>(`/api/collection/${userId}/shop-requests`).then(r => r.data)

export const setShopRequestStatus = (userId: string, id: string, status: ShopRequestStatus) =>
  api.post(`/api/collection/${userId}/shop-requests/${id}`, { status }).then(r => r.data)
