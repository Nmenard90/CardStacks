/**
 * FILE: RipTracker.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/RipTracker.scala
 *
 * PURPOSE:
 *   Data model for the Rip Tracker / Rip-or-Hold feature: sealed products,
 *   their guaranteed contents and pull-rate odds, and the box/pack-opening
 *   sessions users run against them.
 *
 *   This file is schema-and-models only — no repositories, services, routes,
 *   pull-rate math, or seed data. Those are separate, later pieces of work
 *   that read these types; this file (and Migration 004 in sql/schema.sql)
 *   is the frozen contract they build against.
 *
 * DATA INTEGRITY RULE THIS MODEL EXISTS TO SUPPORT:
 *   Every card/product value the Rip-or-Hold engine outputs must come from
 *   real TCGTracking market data. A missing price is surfaced as "price not
 *   found," never estimated/multiplied/interpolated. Nothing in this file
 *   stores a price directly (prices come from CardPrices/CardVariant) — it
 *   only stores the structure (what's guaranteed, what the odds are) that
 *   the EV engine later combines with real prices.
 *
 * IMPORTS:
 *   zio.json.* — JsonCodec/DeriveJsonCodec for automatic JSON conversion
 *   java.time.Instant — JVM standard type for a point in time (UTC timestamp)
 *
 * USED BY: (future) RipTrackerRepository, RipTrackerService, RipRoutes,
 *   the rip-or-hold EV engine
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * CASE CLASS: SealedProduct
 *
 * PURPOSE:
 *   One purchasable sealed product — a booster box, ETB, blister, tin, or
 *   premium collection — tied to a set.
 *
 * @param id                      UUID primary key.
 * @param name                    Display name, e.g. "Surging Sparks Booster Box".
 * @param setId                   Which set this product belongs to.
 * @param kind                    Free-text product kind: "booster_box", "etb",
 *                                "blister", "tin", "premium_collection", etc.
 *                                Not an enum on purpose — new product kinds
 *                                ship faster than a schema/enum migration would.
 * @param packCount               How many booster packs this product contains.
 * @param hasGuarantee            Whether this product's packs are constrained to
 *                                deliver a specific guaranteed pull (rare — most
 *                                English booster boxes are ungoverned and this is
 *                                false). See ProductGuarantee: rows there only
 *                                exist when this is true. The EV engine must
 *                                check this flag explicitly, never infer a
 *                                guarantee from the presence/absence of rows.
 * @param currentSealedPrice      Current real market price for the sealed product
 *                                itself, if known.
 * @param sealedPriceSource       Where currentSealedPrice came from, e.g.
 *                                "TCGTracking sealed listing".
 * @param sealedPriceUpdatedAt    When currentSealedPrice was last refreshed.
 * @param createdAt/updatedAt     Row bookkeeping timestamps.
 */
final case class SealedProduct(
  id:                   String,
  name:                 String,
  setId:                String,
  kind:                 String,
  packCount:            Int,
  hasGuarantee:         Boolean,
  currentSealedPrice:   Option[Double],
  sealedPriceSource:    Option[String],
  sealedPriceUpdatedAt: Option[Instant],
  createdAt:            Instant,
  updatedAt:            Instant
)

object SealedProduct:
  given JsonCodec[SealedProduct] = DeriveJsonCodec.gen[SealedProduct]

/**
 * CASE CLASS: PackSlot
 *
 * PURPOSE:
 *   One slot in a pack's structure — e.g. "1 Rare-or-better slot". Stored as
 *   part of PackTemplate.slots (a JSONB array), not its own table — a pack's
 *   slot structure is always read as a whole, never queried by individual slot.
 *
 * @param rarity  Which rarity tier this slot draws from, e.g. "Rare Holo".
 *                Matches the free-text rarity strings already used on Card.
 * @param count   How many cards this slot contributes to the pack.
 */
final case class PackSlot(rarity: String, count: Int)

object PackSlot:
  given JsonCodec[PackSlot] = DeriveJsonCodec.gen[PackSlot]

/**
 * CASE CLASS: PackTemplate
 *
 * PURPOSE:
 *   The slot structure of one pack for a sealed product. Usually one
 *   template per product; a product can have more than one when it genuinely
 *   has pack variants.
 *
 * @param id               UUID primary key.
 * @param sealedProductId  Which product this template describes a pack of.
 * @param name             Template name, e.g. "Standard Pack" (default) —
 *                         distinguishes variants when a product has more than one.
 * @param slots            The pack's slot structure.
 * @param createdAt        Row bookkeeping timestamp.
 */
final case class PackTemplate(
  id:              String,
  sealedProductId: String,
  name:            String,
  slots:           List[PackSlot],
  createdAt:       Instant
)

object PackTemplate:
  given JsonCodec[PackTemplate] = DeriveJsonCodec.gen[PackTemplate]

/**
 * CASE CLASS: ProductInsert
 *
 * PURPOSE:
 *   A guaranteed non-pack item that comes with a sealed product — a promo
 *   card, code card, player's guide. Distinct from ProductGuarantee, which
 *   is about what's guaranteed to come out of the PACKS themselves.
 *
 * @param id               UUID primary key.
 * @param sealedProductId  Which product this insert comes with.
 * @param cardId           The card this insert is, if it's a priced card.
 *                         None for non-card inserts (player's guide, code card) —
 *                         description explains what it is in that case.
 * @param description      What this insert is, when it isn't a catalog card.
 * @param guaranteed       Whether this insert is guaranteed present (true for
 *                         nearly all inserts — the field exists for the rare
 *                         case of a chase/random extra that isn't guaranteed).
 * @param quantity         How many of this insert come with the product.
 */
final case class ProductInsert(
  id:              String,
  sealedProductId: String,
  cardId:          Option[String],
  description:     Option[String],
  guaranteed:       Boolean,
  quantity:        Int
)

object ProductInsert:
  given JsonCodec[ProductInsert] = DeriveJsonCodec.gen[ProductInsert]

/**
 * CASE CLASS: ProductGuarantee
 *
 * PURPOSE:
 *   What's guaranteed to come out of the PACKS of a product, for products
 *   where SealedProduct.hasGuarantee is true. Ungoverned products (most
 *   English booster boxes, hasGuarantee=false) have zero rows here — that
 *   absence, plus the explicit flag, is what the EV engine checks before
 *   applying any "guaranteed pull" logic. Never inferred from row presence
 *   alone, since a product could legitimately have no guarantee rows yet
 *   simply because they haven't been curated (see Agent 2 seed work).
 *
 * @param id               UUID primary key.
 * @param sealedProductId  Which product this guarantee applies to.
 * @param rarity           Guarantee by rarity tier, e.g. "at least one Rare
 *                         Holo". Mutually exclusive with cardId — exactly one
 *                         of the two is set.
 * @param cardId           Guarantee of a specific card. Mutually exclusive
 *                         with rarity.
 * @param quantity         How many of the guaranteed rarity/card.
 */
final case class ProductGuarantee(
  id:              String,
  sealedProductId: String,
  rarity:          Option[String],
  cardId:          Option[String],
  quantity:        Int
)

object ProductGuarantee:
  given JsonCodec[ProductGuarantee] = DeriveJsonCodec.gen[ProductGuarantee]

/**
 * CASE CLASS: PullRate
 *
 * PURPOSE:
 *   The odds table entry: how likely one card is to appear in a single pack
 *   of a given product. This is the input the Monte Carlo / EV engine
 *   samples from — it is never derived or estimated here.
 *
 * @param id                   UUID primary key.
 * @param cardId               The card this rate is for.
 * @param sealedProductId      Which product this rate applies to. Scoped to
 *                             the product (not just the set) because the same
 *                             card's rate can differ between, say, a booster
 *                             box and an ETB from the same set.
 * @param perPackProbability   Probability this card appears in one pack of
 *                             this product, e.g. 0.00390625 for a 1-in-256 pull.
 * @param source               "published" (official/printed odds) or
 *                             "community" (crowd-sourced pull counting) —
 *                             never conflated; the engine/UI must be able to
 *                             tell them apart.
 * @param sampleSize           How many packs a community figure is based on.
 *                             None for published rates, or when genuinely
 *                             unknown — never guessed.
 * @param createdAt            Row bookkeeping timestamp.
 */
final case class PullRate(
  id:                 String,
  cardId:             String,
  sealedProductId:    String,
  perPackProbability: Double,
  source:             String,
  sampleSize:         Option[Int],
  createdAt:          Instant
)

object PullRate:
  given JsonCodec[PullRate] = DeriveJsonCodec.gen[PullRate]

/**
 * ENUM: RipSessionStatus
 * PURPOSE: Lifecycle of a rip session. Enum (not raw String) so the compiler
 *          rejects any value that isn't one of these two.
 */
enum RipSessionStatus:
  case InProgress, Completed

object RipSessionStatus:
  given JsonCodec[RipSessionStatus] = JsonCodec.string.transform(
    {
      case "in_progress" => RipSessionStatus.InProgress
      case "completed"   => RipSessionStatus.Completed
      case other         => throw IllegalArgumentException(s"Unknown RipSessionStatus: $other")
    },
    {
      case RipSessionStatus.InProgress => "in_progress"
      case RipSessionStatus.Completed  => "completed"
    }
  )

/**
 * CASE CLASS: RipSession
 *
 * PURPOSE:
 *   One box/pack-opening session for one user against one sealed product.
 *
 * @param id               UUID primary key.
 * @param userId           Who's running this rip.
 * @param sealedProductId  Which product is being opened.
 * @param status           Lifecycle state.
 * @param createdAt        When the session was started.
 */
final case class RipSession(
  id:              String,
  userId:          String,
  sealedProductId: String,
  status:          RipSessionStatus,
  createdAt:       Instant
)

object RipSession:
  given JsonCodec[RipSession] = DeriveJsonCodec.gen[RipSession]

/**
 * CASE CLASS: RipPack
 *
 * PURPOSE:
 *   One pack within a rip session. Auto-generated from the product's
 *   packCount when the session is created (rip-session API, later work).
 *
 * @param id            UUID primary key.
 * @param ripSessionId  Which session this pack belongs to.
 * @param packIndex     0-based position of this pack within the session.
 */
final case class RipPack(
  id:           String,
  ripSessionId: String,
  packIndex:    Int
)

object RipPack:
  given JsonCodec[RipPack] = DeriveJsonCodec.gen[RipPack]

/**
 * CASE CLASS: Pull
 *
 * PURPOSE:
 *   One scanned card from one pack — the per-card provenance record tying a
 *   card to exactly which pack/session it came from, and which collection
 *   entry it landed in.
 *
 * @param id                  UUID primary key.
 * @param ripPackId           Which pack this card was pulled from.
 * @param cardId              The card that was pulled.
 * @param condition           Condition it was logged in, e.g. "NM".
 * @param collectionEntryId   Provenance link to the collection_entries row
 *                            this pull added to. None until the rip-session
 *                            API (later work) writes it.
 * @param createdAt           When this pull was recorded.
 */
final case class Pull(
  id:                String,
  ripPackId:         String,
  cardId:            String,
  condition:         String,
  collectionEntryId: Option[String],
  createdAt:         Instant
)

object Pull:
  given JsonCodec[Pull] = DeriveJsonCodec.gen[Pull]
