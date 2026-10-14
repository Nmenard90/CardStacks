/**
 * API calls for share-link trading: share settings, the trade list, the
 * public share page, and offers with their message threads.
 * ENDPOINTS: /api/share/:slug (public), /api/trading/:userId/*
 * USED BY: TradePage, SharePage, HeaderNav (unread badge)
 */
import { api } from './client'
import type { CardOffer, OfferLine, CardOfferStatus, ShareSettings, SharedProfile, TradeListItem } from '../types'

/** The backend sends `{ error }` with a readable message on 4xx. */
export const tradingError = (e: unknown, fallback: string): string => {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data
  return data?.error || fallback
}

export const getSharedProfile = (slug: string) =>
  api.get<SharedProfile>(`/api/share/${slug}`).then(r => r.data)

export const getShareSettings = (userId: string) =>
  api.get<ShareSettings>(`/api/trading/${userId}/share`).then(r => r.data)
export const updateShareSettings = (userId: string, value: { enabled: boolean; collectionPublic: boolean; bio?: string }) =>
  api.put<ShareSettings>(`/api/trading/${userId}/share`, value).then(r => r.data)
export const regenerateShareLink = (userId: string) =>
  api.post<ShareSettings>(`/api/trading/${userId}/share/regenerate`).then(r => r.data)

export const getTradeList = (userId: string) =>
  api.get<TradeListItem[]>(`/api/trading/${userId}/list`).then(r => r.data)
export const saveTradeItem = (userId: string, value: { cardId: string; condition: string; quantity: number; askingPrice?: number; note?: string }) =>
  api.put<TradeListItem[]>(`/api/trading/${userId}/list`, value).then(r => r.data)
export const removeTradeItem = (userId: string, itemId: string) =>
  api.delete(`/api/trading/${userId}/list/${itemId}`).then(r => r.data)

export const getOffers = (userId: string) =>
  api.get<CardOffer[]>(`/api/trading/${userId}/offers`).then(r => r.data)
export const makeOffer = (userId: string, value: { slug: string; wants: OfferLine[]; gives: OfferLine[]; cashAmount?: number; message?: string }) =>
  api.post<CardOffer>(`/api/trading/${userId}/offers`, value).then(r => r.data)
export const getOffer = (userId: string, offerId: string) =>
  api.get<CardOffer>(`/api/trading/${userId}/offers/${offerId}`).then(r => r.data)
export const setOfferStatus = (userId: string, offerId: string, status: CardOfferStatus) =>
  api.put<CardOffer>(`/api/trading/${userId}/offers/${offerId}/status`, { status }).then(r => r.data)
export const postOfferMessage = (userId: string, offerId: string, body: string) =>
  api.post<CardOffer>(`/api/trading/${userId}/offers/${offerId}/messages`, { body }).then(r => r.data)
export const getUnreadOffers = (userId: string) =>
  api.get<{ count: number }>(`/api/trading/${userId}/unread`).then(r => r.data.count)
