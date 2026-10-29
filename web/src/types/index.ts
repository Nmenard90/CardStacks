/**
 * types/index.ts — every data shape exchanged with the backend, in one
 * file. Mirrors the Scala case classes in
 * poketracker-v2/src/main/scala/com/poketracker/models/ field-for-field;
 * keep the two in sync when either side changes.
 */

// ─── Cards & Sets ────────────────────────────────────────────────────────────

export interface SetImages {
  symbol: string
  logo: string
}

export interface CardSet {
  id: string
  name: string
  series: string
  printedTotal: number   // denominator printed on cards, e.g. 165 for "4/165"
  total: number           // real count including secret rares — always >= printedTotal
  releaseDate: string
  images: SetImages
  ptcgoCode?: string
}

export interface CardImage {
  small: string
  large: string
}

/** Every field optional — a card may have no pricing data for a given condition. */
export interface CardPrices {
  nm?: number
  lp?: number
  mp?: number
  hp?: number
  dmg?: number
}

export interface PriceHistoryPoint {
  recordedAt: string
  nm?: number
  lp?: number
  mp?: number
  hp?: number
  dmg?: number
}

/** One priced print variant ("Holofoil", "Reverse Holofoil", etc.) — see
 *  lib/conditions.ts for how CardTile picks between these and CardPrices. */
export interface CardVariant {
  name: string
  prices: CardPrices
}

/** Leaves out the backend's attacks/abilities block — the UI doesn't show it. */
export interface Card {
  id: string
  setId: string
  name: string
  number: string           // text, not numeric — some are letter-prefixed (e.g. "TG01")
  rarity?: string           // absent on some cards, e.g. plain Energy
  artist?: string
  images: CardImage
  prices?: CardPrices
  variants?: CardVariant[]
  /** Absent = TCGplayer market price. 'cardmarket' when TCGplayer
   *  has no market price and a fallback filled it in. */
  priceSource?: 'cardmarket'
}

// ─── Users ───────────────────────────────────────────────────────────────────

export type UserRole = 'Collector' | 'Vendor' | 'Admin'

export interface User {
  id: string
  supabaseUserId: string
  username: string
  email: string
  role: UserRole
  reputation: number
  location?: string     // city-level only, never a precise address
  isAnonymous: boolean   // true for a "try the demo" account — cleared after 24h
  createdAt: string
}

// ─── Collection ───────────────────────────────────────────────────────────────

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'

export interface ConditionCount {
  condition: string      // usually a Condition value, but may carry a " 1st Ed" suffix
  quantity: number
  price?: number           // market price at the time this was recorded
  purchasePrice?: number   // self-reported, what the user says they paid
  purchasedAt?: string
}

export interface CollectionEntry {
  id: string
  userId: string
  cardId: string
  conditions: ConditionCount[]
  selectedCond: string   // which condition tab the UI last had active, persisted per-card
  updatedAt: string
}

export interface CollectionStats {
  totalCards: number
  uniqueCards: number
  totalValue: number
  setsEntered: number
}

/** CollectionEntry with the full Card attached, so the owned view can
 *  render every card without a per-card follow-up request. */
export interface OwnedCard {
  cardId: string
  conditions: ConditionCount[]
  selectedCond: string
  updatedAt: string
  card: Card
  drawerId?: string
}

// ─── Physical storage (boxes -> drawers -> cards) ──────────────────────────────

export interface StorageDrawer {
  id: string
  boxId: string
  name: string
  position: number
  cardCount: number   // computed by the backend on read, not stored — never stale
  /** Set this compartment auto-files new copies into, if any. */
  autoSetId?: string | null
  createdAt: string
  updatedAt: string
}

export interface StorageBox {
  id: string
  userId: string
  name: string
  kind?: 'box' | 'display_case'
  boxType?: string
  capacity?: number
  color?: string
  position: number
  spaceId?: string
  storageUnitId?: string
  shelfIndex?: number
  stackIndex?: number
  stackLevel?: number
  drawers: StorageDrawer[]
  createdAt: string
  updatedAt: string
}

/** @param warning Informational only, never blocking — e.g. flags that a
 *  set is now split across boxes, which is a legitimate thing to do. */
export interface AssignResult {
  assigned: number
  warning?: string
}

export type ProtectionType = 'raw' | 'sleeved' | 'double_sleeved' | 'toploader' | 'magnetic_holder' | 'graded_slab'
export type SpaceType = 'collection_room' | 'archive' | 'trade_station' | 'showcase' | 'custom'
export type StorageUnitType = 'shelf' | 'rack' | 'cabinet' | 'closet' | 'custom'
export type DisplayCaseType = 'wall_case' | 'lit_cabinet' | 'museum_vitrine' | 'floating_shelf' | 'pedestal' | 'custom'
export interface StorageUnit { id:string; spaceId:string; name:string; unitType:StorageUnitType; preset:string; color:string; shelfCount:number; positionsPerShelf:number; maxStackHeight:number; position:number; config:string; createdAt:string; updatedAt:string }
export interface DisplaySlot { id:string; displayCaseId:string; shelfIndex:number; slotIndex:number; label?:string }
export interface DisplayCase { id:string; spaceId:string; name:string; caseType:DisplayCaseType; preset:string; frameColor:string; lightColor:string; lightEnabled:boolean; shelfCount:number; slotsPerShelf:number; position:number; config:string; slots:DisplaySlot[]; createdAt:string; updatedAt:string }
export interface CollectionSpace { id:string; userId:string; name:string; spaceType:SpaceType; isDefault:boolean; position:number; storageUnits:StorageUnit[]; displayCases:DisplayCase[]; createdAt:string; updatedAt:string }
export interface InventoryLot { id:string; userId:string; cardId:string; variantKey:string; edition:string; language:string; condition:string; quantity:number; allocated:number; createdAt:string; updatedAt:string }
export interface CardAllocation { id:string; lotId:string; drawerId?:string; binderSlotId?:string; displaySlotId?:string; quantity:number; protection?:ProtectionType; notes?:string; createdAt:string; updatedAt:string }

// ─── Binders ─────────────────────────────────────────────────────────────────

export type PocketSize = 'Four' | 'Nine' | 'Twelve'

export interface BinderSlot {
  slotIndex: number   // position counting across ALL pages, not per-page
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
  spaceId?: string
  storageUnitId?: string
  shelfIndex?: number
  shelfPosition?: number
  slots: BinderSlot[]
  createdAt: string
  updatedAt: string
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
  askingPrice?: number   // set only when it differs from what was actually paid
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

// ─── Card offers (see backend models/Trading.scala) ─────────────────────────

export interface OfferCard {
  cardId: string
  name: string
  imageSmall: string
  condition: string
  quantity: number
  marketPrice?: number
}

export interface OfferMessage {
  id: string
  senderId: string
  sender: string
  body: string
  createdAt: string
}

export type CardOfferStatus = 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn' | 'Cancelled' | 'Completed'

export interface CardOffer {
  id: string
  role: 'seller' | 'buyer'   // the viewer's side
  otherUser: string
  wants: OfferCard[]         // cards the buyer wants from the seller
  gives: OfferCard[]         // cards the buyer puts up
  cashAmount?: number        // buyer pays seller, settled off-platform
  status: CardOfferStatus
  unread: boolean
  createdAt: string
  updatedAt: string
  messages: OfferMessage[]
}

// ─── Games (see backend models/Game.scala) ──────────────────────────────────

/** A card game the app supports. Each game is its own world: collection,
 *  Spaces, boxes, binders and trades are separate per game. */
export interface Game {
  id: string               // 'pokemon', 'pokemon-jp', 'mtg', ...
  name: string             // 'Pokémon (Japanese)'
  shortName: string        // 'Pokémon JP'
  source: string           // 'pokemontcg' | 'tcgtracking'
  category: number
  enabled: boolean
  position: number
  printPreference: string[]
  hasFirstEdition: boolean
}
