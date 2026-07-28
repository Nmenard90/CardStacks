// ─── Cards & Sets ────────────────────────────────────────────────────────────

export interface SetImages {
  symbol: string
  logo: string
}

export interface CardSet {
  id: string
  name: string
  series: string
  printedTotal: number
  total: number
  releaseDate: string
  images: SetImages
  ptcgoCode?: string
}

export interface CardImage {
  small: string
  large: string
}

export interface CardPrices {
  nm?: number
  lp?: number
  mp?: number
  hp?: number
  dmg?: number
}

/** One price snapshot from GET /api/cards/id/:cardId/price-history. */
export interface PriceHistoryPoint {
  recordedAt: string
  nm?: number
  lp?: number
  mp?: number
  hp?: number
  dmg?: number
}

export interface Card {
  id: string
  setId: string
  name: string
  number: string
  rarity?: string
  artist?: string
  images: CardImage
  prices?: CardPrices
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserRole = 'Collector' | 'Vendor' | 'Admin'

export interface User {
  id: string
  username: string
  email: string
  role: UserRole
  reputation: number
  location?: string
  createdAt: string
}

// ─── Collection ───────────────────────────────────────────────────────────────

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'

export interface ConditionCount {
  condition: string
  quantity: number
  price?: number
  /** What the user says they paid for this condition's copies, if logged. */
  purchasePrice?: number
  /** ISO date string for when the purchase was logged. */
  purchasedAt?: string
}

export interface CollectionEntry {
  id: string
  userId: string
  cardId: string
  conditions: ConditionCount[]
  selectedCond: string
  updatedAt: string
}

export interface CollectionStats {
  totalCards: number
  uniqueCards: number
  totalValue: number
  setsEntered: number
}

export interface OwnedCard {
  cardId: string
  conditions: ConditionCount[]
  selectedCond: string
  updatedAt: string
  card: Card
}

// ─── Binders ─────────────────────────────────────────────────────────────────

export type PocketSize = 'Four' | 'Nine' | 'Twelve'

export interface BinderSlot {
  slotIndex: number
  cardId?: string
  cardName?: string
  imageUrl?: string
}

export interface Binder {
  id: string
  userId: string
  name: string
  pocketSize: PocketSize
  coverImage?: string
  slots: BinderSlot[]
  createdAt: string
  updatedAt: string
}

// ─── Trades ──────────────────────────────────────────────────────────────────

export type TradeStatus = 'Open' | 'Pending' | 'Completed' | 'Cancelled'
export type OfferStatus = 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn'
export type RatingValue = 'Positive' | 'Neutral' | 'Negative'

export interface TradeCard {
  cardId: string
  cardName: string
  imageUrl: string
  condition: string
  price?: number
}

export interface TradeListing {
  id: string
  userId: string
  game: string
  offering: TradeCard[]
  wants?: TradeCard[]
  cashOk: boolean
  location: string
  description?: string
  status: TradeStatus
  createdAt: string
  updatedAt: string
}

export interface TradeOffer {
  id: string
  listingId: string
  fromUserId: string
  cards: TradeCard[]
  cashAmount?: number
  message?: string
  status: OfferStatus
  createdAt: string
}


// ─── Convention Mode ─────────────────────────────────────────────────────────

export type PaymentType = 'cash' | 'card' | 'trade' | 'trade_credit' | 'unknown'
export type ReportConfidence = 'local' | 'unverified' | 'event_verified' | 'trusted'

export interface ConventionPriceReport {
  id: string
  cardId: string
  cardName: string
  setName?: string
  imageUrl?: string
  condition: Condition
  askingPrice?: number
  paidPrice: number
  paymentType: PaymentType
  eventName?: string
  boothNumber?: string
  note?: string
  confidence: ReportConfidence
  createdAt: string
  userId?: string
}

export interface VendorNote {
  id: string
  eventName: string
  boothNumber: string
  note: string
  createdAt: string
}
