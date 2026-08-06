/**
 * A user's owned cards — one CollectionEntry per (user, card) pair, with a
 * quantity per condition.
 *
 * USED BY: CollectionRepository, CollectionService, CollectionRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/** @param condition  "NM" | "LP" | "MP" | "HP" | "DMG", or e.g. "NM 1st Ed". */
final case class ConditionCount(
  condition:     String,
  quantity:      Int,
  price:         Option[Double],
  purchasePrice: Option[Double] = None,
  purchasedAt:   Option[String] = None
)

object ConditionCount:
  given JsonCodec[ConditionCount] = DeriveJsonCodec.gen[ConditionCount]

final case class CollectionEntry(
  id:           String,
  userId:       String,
  cardId:       String,
  conditions:   List[ConditionCount],
  selectedCond: String,
  updatedAt:    Instant,
  drawerId:     Option[String] = None
):

  def totalQuantity: Int =
    conditions.map(_.quantity).sum

  /** Only counts conditions that have a price on file. */
  def totalValue: Double =
    conditions.flatMap(c => c.price.map(_ * c.quantity)).sum

object CollectionEntry:
  given JsonCodec[CollectionEntry] = DeriveJsonCodec.gen[CollectionEntry]

/**
 * A CollectionEntry with the full card already attached, so the frontend
 * can render name/image/price without a request per card.
 *
 * Response-only (GET /api/collection/:userId/owned) — hence JsonEncoder,
 * not a full JsonCodec; nothing ever decodes one back.
 */
final case class OwnedCard(
  cardId:       String,
  conditions:   List[ConditionCount],
  selectedCond: String,
  updatedAt:    Instant,
  card:         Card,
  drawerId:     Option[String] = None
)

object OwnedCard:
  given zio.json.JsonEncoder[OwnedCard] = zio.json.DeriveJsonEncoder.gen[OwnedCard]
