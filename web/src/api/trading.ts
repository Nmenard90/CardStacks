/**
 * API calls for card offers and their message threads (My Shop → Offers).
 * New offers aren't made here any more: the share-link trade page was folded
 * into the shop, where buyers send buy/trade requests (api/shop).
 * ENDPOINTS: /api/trading/:userId/offers…, /api/trading/:userId/unread
 * USED BY: components/OfferInbox, pages/ShopRequestsPage, HeaderNav (badge)
 */
import { api } from './client'
import type { CardOffer, CardOfferStatus } from '../types'

/** The backend sends `{ error }` with a readable message on 4xx. */
export const tradingError = (e: unknown, fallback: string): string => {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error || fallback
}

export const getOffers = (userId: string) =>
  api.get<CardOffer[]>(`/api/trading/${userId}/offers`).then(r => r.data)
export const getOffer = (userId: string, offerId: string) =>
  api.get<CardOffer>(`/api/trading/${userId}/offers/${offerId}`).then(r => r.data)
export const setOfferStatus = (userId: string, offerId: string, status: CardOfferStatus) =>
  api.put<CardOffer>(`/api/trading/${userId}/offers/${offerId}/status`, { status }).then(r => r.data)
export const postOfferMessage = (userId: string, offerId: string, body: string) =>
  api.post<CardOffer>(`/api/trading/${userId}/offers/${offerId}/messages`, { body }).then(r => r.data)
export const getUnreadOffers = (userId: string) =>
  api.get<{ count: number }>(`/api/trading/${userId}/unread`).then(r => r.data.count)
