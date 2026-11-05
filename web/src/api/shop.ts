/**
 * API calls for a user's public shop page, shop settings, request inbox, and the request chat.
 * ENDPOINTS: GET /api/shop/:slug (public),
 *            POST /api/collection/:userId/shop-orders/:slug[/photo-ask] (signed-in buyer: send a request / ask for photos),
 *            GET /api/collection/:userId/shop-sent[/:id] (the buyer's sent requests; one with photos and chat),
 *            POST /api/collection/:userId/shop-sent/:id/messages (buyer writes in the chat),
 *            GET|POST /api/collection/:userId/shop-requests/:id/messages (seller reads / writes in the chat),
 *            GET|PUT /api/collection/:userId/shop-settings,
 *            GET /api/collection/:userId/shop-requests,
 *            POST /api/collection/:userId/shop-requests/:id (owner only)
 *            POST /api/collection/:userId/shop-requests/:id/items/:index (owner only; the pull list)
 *            POST /api/collection/:userId/shop-requests/:id/sell|put-back (owner only; takes sold cards out, puts them back)
 *            GET /api/shop/:slug/photo/:cardId/:side?cond= (public picture),
 *            PUT|DELETE /api/collection/:userId/shop-photos/:cardId/:side?cond= (owner only)
 * USED BY: ShopPage, ShopRequestsPage, ShopRequestStatusPage, RequestedCards
 */
import { api } from './client'
import type { OwnedCard } from '../types'

export interface ShopRequestItem {
  cardId: string
  name: string
  number: string
  condition: string
  qty: number
  /** The buyer asked to see photos of this copy. */
  photos?: boolean
  /** Pull list (seller only): found in the boxes. */
  pulled?: boolean
  /** Pull list: what the buyer picked, once the seller changed `condition` to the copy's real one. */
  askedCondition?: string
  /** Pull list: how many were found, when only some of `qty` were. */
  foundQty?: number
  /** How many copies the sale took out of the seller's collection. */
  sold?: number
}

/** Copies found on the pull list: none until marked found, then all of `qty` unless fewer were found. */
export const foundCount = (item: ShopRequestItem) => item.pulled ? Math.min(item.qty, Math.max(0, item.foundQty ?? item.qty)) : 0

/** A card the sale couldn't fully take out: the collection had fewer copies than were found. */
export interface SaleShortfall { name: string; number: string; condition: string; wanted: number; taken: number }

export interface SaleResult { request: ShopRequest; taken: number; short: SaleShortfall[] }

export type ShopRequestStatus = 'new' | 'answered' | 'done'

/** A request in the seller's inbox. `buyerUserId` is set when a signed-in buyer sent it (it has a chat); older ones
 *  only have the contact the buyer typed. `unread` = the buyer wrote since the seller last opened the chat. */
export interface ShopRequest {
  id: string
  buyerName: string
  buyerContact: string
  message: string
  items: ShopRequestItem[]
  kind: 'buy' | 'chat' | 'photos'
  status: ShopRequestStatus
  createdAt: string
  buyerUserId?: string
  unread?: boolean
}

/** One chat message on a request. */
export interface ShopMessage {
  id: string
  fromSeller: boolean
  body: string
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

/** A signed-in buyer sends a request (cards and/or a note or trade offer) to the shop at `slug`; returns its id. */
export const sendShopOrder = (userId: string, slug: string, order: { message: string; items: ShopRequestItem[] }) =>
  api.post<{ ok: boolean; id: string }>(`/api/collection/${userId}/shop-orders/${encodeURIComponent(slug)}`, order).then(r => r.data)

/** "📷 Ask for photos" on one card tile (the condition shown); asking twice is harmless. Returns the request's id. */
export const askForPhotos = (userId: string, slug: string, card: { cardId: string; name: string; number: string; condition: string }) =>
  api.post<{ ok: boolean; id: string }>(`/api/collection/${userId}/shop-orders/${encodeURIComponent(slug)}/photo-ask`, card).then(r => r.data)

/** One card of a request as its buyer sees it: the condition the seller confirmed (and the buyer's pick, if different). */
export interface BuyerRequestItem {
  cardId: string
  name: string
  number: string
  condition: string
  qty: number
  photos: boolean
  askedCondition?: string
}

/** A request the signed-in user sent to someone's shop: which shop, its cards, whether the seller has answered, the
 *  seller's photos of those cards and the chat (both empty in the list), `unread` = the seller wrote since you looked. */
export interface BuyerRequestView {
  id: string
  shopSlug: string
  shopName: string
  kind: 'buy' | 'chat' | 'photos'
  status: ShopRequestStatus
  createdAt: string
  message: string
  items: BuyerRequestItem[]
  photos: ShopPhotoRef[]
  messages: ShopMessage[]
  unread: boolean
}

/** Requests you sent to other shops, newest first. */
export const getSentRequests = (userId: string) =>
  api.get<BuyerRequestView[]>(`/api/collection/${userId}/shop-sent`).then(r => r.data)

/** One request you sent, with the seller's photos and the chat (opening it marks the chat read). */
export const getSentRequest = (userId: string, id: string) =>
  api.get<BuyerRequestView>(`/api/collection/${userId}/shop-sent/${encodeURIComponent(id)}`).then(r => r.data)

/** Buyer writes in a request's chat; returns the whole chat. */
export const postBuyerMessage = (userId: string, id: string, body: string) =>
  api.post<ShopMessage[]>(`/api/collection/${userId}/shop-sent/${encodeURIComponent(id)}/messages`, { body }).then(r => r.data)

/** Seller reads a request's chat (marks it read). */
export const getRequestMessages = (userId: string, id: string) =>
  api.get<ShopMessage[]>(`/api/collection/${userId}/shop-requests/${encodeURIComponent(id)}/messages`).then(r => r.data)

/** Seller writes in a request's chat; returns the whole chat. */
export const postSellerMessage = (userId: string, id: string, body: string) =>
  api.post<ShopMessage[]>(`/api/collection/${userId}/shop-requests/${encodeURIComponent(id)}/messages`, { body }).then(r => r.data)

/** Where a seller photo's picture lives — usable straight in an <img src>. */
export const shopPhotoUrl = (slug: string, p: ShopPhotoRef) =>
  `${api.defaults.baseURL ?? ''}/api/shop/${encodeURIComponent(slug)}/photo/${encodeURIComponent(p.cardId)}/${p.side}` +
  `?cond=${encodeURIComponent(p.condition)}&v=${p.version}`

/** Owner only: which photos you have (from your collection, shop or not). */
export const getMyPhotos = (userId: string) =>
  api.get<ShopPhotoRef[]>(`/api/collection/${userId}/shop-photos`).then(r => r.data)

/** Owner only: one of your own photos, as a picture to show (signed in, so not a plain <img src>). */
export const getMyPhoto = (userId: string, cardId: string, condition: string, side: PhotoSide) =>
  api.get<Blob>(`/api/collection/${userId}/shop-photos/${encodeURIComponent(cardId)}/${side}`,
    { params: { cond: condition }, responseType: 'blob' }).then(r => r.data)

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

/** Pull list: marks the request's card at `index` found (or not, or how many of it) and/or sets its real condition ("LP"). Returns the saved card. */
export const updateShopRequestItem = (userId: string, id: string, index: number, change: { pulled?: boolean; foundQty?: number; condition?: string }) =>
  api.post<ShopRequestItem>(`/api/collection/${userId}/shop-requests/${id}/items/${index}`, change).then(r => r.data)

/** Completes a sale: the found cards (only those, never twice) come out of the seller's collection and the request is done. */
export const sellShopRequest = (userId: string, id: string) =>
  api.post<SaleResult>(`/api/collection/${userId}/shop-requests/${id}/sell`, {}).then(r => r.data)

/** A refund or a sale that fell through: puts the card at `index` (every sold card, without one) back in the collection. */
export const putBackShopRequest = (userId: string, id: string, index?: number) =>
  api.post<ShopRequest>(`/api/collection/${userId}/shop-requests/${id}/put-back`, index === undefined ? {} : { index }).then(r => r.data)
