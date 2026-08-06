/**
 * Data shapes for Rip Tracker (box-opening EV): sealed products, what's
 * guaranteed inside them, per-card pull odds, and the sessions users run.
 * Schema only — no DB code, no math, no routes.
 *
 * Every dollar figure this feeds into the EV math must come from real
 * market data; nothing here stores a price directly. A missing price is
 * "not found," never guessed.
 *
 * USED BY: (future) RipTrackerRepository, RipTrackerService, RipRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * A purchasable sealed product (booster box, ETB, blister, tin, ...) tied to a set.
 *
 * @param kind          Free-text category ("booster_box", "etb", ...) —
 *                      not an enum, so a new product kind never needs a migration.
 * @param hasGuarantee  Whether this product's packs guarantee something
 *                      specific. Rare — most English booster boxes are not.
 *                      ProductGuarantee rows only exist when this is true.
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

/** One guaranteed slot in a pack, e.g. "1 card Rare Holo or better." */
final case class PackSlot(rarity: String, count: Int)

object PackSlot:
  given JsonCodec[PackSlot] = DeriveJsonCodec.gen[PackSlot]

/** Usually one per product; more than one only for products with genuine pack variants. */
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
 * A guaranteed extra that ships WITH a product but isn't inside the packs
 * — a promo card, code card, player's guide. (ProductGuarantee below is
 * about what's inside the packs.)
 *
 * @param cardId  None for non-card inserts (player's guide) — description covers those instead.
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
 * What's guaranteed inside the packs — only populated when
 * SealedProduct.hasGuarantee is true; most products have zero rows here,
 * which is expected.
 *
 * @param rarity/cardId  Exactly one of these two is set, never both.
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
 * One row of the odds table. Real, sourced data the simulation reads
 * from — never derived here.
 *
 * @param sealedProductId  Tied to the product, not just the set — the
 *                         same card's odds can differ between a booster
 *                         box and an ETB from the same set.
 * @param source           "published" or "community" — always kept distinguishable.
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

final case class RipSession(
  id:              String,
  userId:          String,
  sealedProductId: String,
  status:          RipSessionStatus,
  createdAt:       Instant
)

object RipSession:
  given JsonCodec[RipSession] = DeriveJsonCodec.gen[RipSession]

/** One pack within a session — a session opening 36 packs gets 36 of these rows. */
final case class RipPack(
  id:           String,
  ripSessionId: String,
  packIndex:    Int
)

object RipPack:
  given JsonCodec[RipPack] = DeriveJsonCodec.gen[RipPack]

/** One scanned card, tying it to the exact pack/session and the collection row it landed in. */
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
