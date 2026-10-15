/**
 * A user's owned cards — one CollectionEntry per (user, card) pair, with a
 * quantity per condition.
 *
 * USED BY: CollectionRepository, CollectionService, CollectionRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * A condition key's parts. Keys are "<COND>[ 1st Ed][ · <print>]", e.g.
 * "NM", "LP 1st Ed", "NM · reverse", "NM 1st Ed · holo". No print suffix
 * means the card's default print ("standard" in inventory_lots).
 * The print is a card_variant_prices.variant key (reverse, pokeball, ...).
 */
final case class ConditionKey(condition: String, edition: String, variant: String):
  def firstEdition: Boolean = edition == "first_edition"

object ConditionKey:
  val PrintSeparator = " · "
  val Standard       = "standard"

  def parse(key: String): ConditionKey =
    val (left, print) = key.indexOf(PrintSeparator) match
      case -1 => (key, "")
      case i  => (key.substring(0, i), key.substring(i + PrintSeparator.length).trim.toLowerCase)
    val firstEd = left.endsWith(" 1st Ed")
    ConditionKey(
      condition = left.stripSuffix(" 1st Ed").trim,
      edition   = if firstEd then "first_edition" else "unlimited",
      variant   = if print.isEmpty then Standard else print
    )

/** @param condition  A condition key — see ConditionKey ("NM", "NM 1st Ed", "NM · reverse"). */
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
