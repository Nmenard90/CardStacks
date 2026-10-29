/**
 * API calls for a user's public shop page, shop settings, and request inbox.
 * ENDPOINTS: GET /api/shop/:slug, POST /api/shop/:slug/requests (public, no login),
 *            GET|PUT /api/collection/:userId/shop-settings,
 *            GET /api/collection/:userId/shop-requests,
 *            POST /api/collection/:userId/shop-requests/:id (owner only)
 *            GET /api/shop/:slug/photo/:cardId/:side?cond= (public picture),
 *            PUT|DELETE /api/collection/:userId/shop-photos/:cardId/:side?cond= (owner only)
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

export type PhotoSide = 'front' | 'back'

/** Says a photo exists; `version` changes each time it is replaced (so the picture can be cached). */
export interface ShopPhotoRef {
  cardId: string
  condition: string
  side: PhotoSide
  version: number
}

/** What the public page receives: the Messenger link, the cards (private fields already removed), and which photos exist. */
export interface ShopView {
  messengerUrl: string
  cards: OwnedCard[]
  displayName: string
  bio: string
  photos: ShopPhotoRef[]
}

/** The owner's switch for their shop. enabled=false means nobody can see it. */
export interface ShopSettings {
  slug: string
  enabled: boolean
  messengerUrl: string
  displayName: string
  bio: string
}

export const getShop = (slug: string) =>
  api.get<ShopView>(`/api/shop/${encodeURIComponent(slug)}`).then(r => r.data)

/** The shop an old share link (/s/<slug>) now leads to; rejects when there's none open. */
export const shopForShareLink = (shareSlug: string) =>
  api.get<{ slug: string }>(`/api/shop/from-share/${encodeURIComponent(shareSlug)}`).then(r => r.data.slug)

export const sendShopRequest = (slug: string, input: ShopRequestInput) =>
  api.post<{ ok: boolean }>(`/api/shop/${encodeURIComponent(slug)}/requests`, input).then(r => r.data)

/** Where a seller photo's picture lives — usable straight in an <img src>. */
export const shopPhotoUrl = (slug: string, p: ShopPhotoRef) =>
  `${api.defaults.baseURL ?? ''}/api/shop/${encodeURIComponent(slug)}/photo/${encodeURIComponent(p.cardId)}/${p.side}` +
  `?cond=${encodeURIComponent(p.condition)}&v=${p.version}`

/** Owner only: adds or replaces one photo (a JPEG, 1.5 MB max). */
export const uploadShopPhoto = (userId: string, cardId: string, condition: string, side: PhotoSide, jpeg: Blob) =>
  api.put(`/api/collection/${userId}/shop-photos/${encodeURIComponent(cardId)}/${side}`, jpeg,
    { params: { cond: condition }, headers: { 'Content-Type': 'image/jpeg' } }).then(r => r.data)

export const deleteShopPhoto = (userId: string, cardId: string, condition: string, side: PhotoSide) =>
  api.delete(`/api/collection/${userId}/shop-photos/${encodeURIComponent(cardId)}/${side}`, { params: { cond: condition } }).then(r => r.data)

export const getShopSettings = (userId: string) =>
  api.get<ShopSettings>(`/api/collection/${userId}/shop-settings`).then(r => r.data)

export const saveShopSettings = (userId: string, settings: ShopSettings) =>
  api.put<ShopSettings>(`/api/collection/${userId}/shop-settings`, settings).then(r => r.data)

export const getShopRequests = (userId: string) =>
  api.get<ShopRequest[]>(`/api/collection/${userId}/shop-requests`).then(r => r.data)

export const setShopRequestStatus = (userId: string, id: string, status: ShopRequestStatus) =>
  api.post(`/api/collection/${userId}/shop-requests/${id}`, { status }).then(r => r.data)
