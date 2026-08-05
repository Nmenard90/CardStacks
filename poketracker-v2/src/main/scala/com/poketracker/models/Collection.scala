/**
 * FILE: Collection.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/Collection.scala
 *
 * PURPOSE:
 *   Represents a user's owned cards — the core feature of the tracker.
 *   A CollectionEntry is one row in the user's collection:
 *   "User X owns 2 copies of card Y, both in NM condition."
 *
 * IMPORTS:
 *   zio.json.* — JSON conversion
 *   java.time.Instant — UTC timestamps
 *
 * USED BY: CollectionRepository, CollectionService, CollectionRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * CASE CLASS: ConditionCount
 *
 * PURPOSE:
 *   How many copies of a card a user owns in a specific condition,
 *   and what price was recorded for that condition at time of entry.
 *
 * @param condition     One of: NM, LP, MP, HP, DMG, or "NM 1st Ed" etc.
 * @param quantity      How many copies in this condition. Always >= 1.
 * @param price         The market price at time this entry was recorded.
 *                      Option because price data may not exist for all cards.
 * @param purchasePrice What the user says they paid for these copies.
 *                      Optional and self-reported — never required.
 * @param purchasedAt   ISO date string for when the purchase was logged.
 */
final case class ConditionCount(
  condition:     String,
  quantity:      Int,
  price:         Option[Double],
  purchasePrice: Option[Double] = None,
  purchasedAt:   Option[String] = None
)

object ConditionCount:
  given JsonCodec[ConditionCount] = DeriveJsonCodec.gen[ConditionCount]

/**
 * CASE CLASS: CollectionEntry
 *
 * PURPOSE:
 *   One card in a user's collection, with per-condition quantities.
 *   A user can own multiple copies of the same card in different conditions.
 *
 * @param id            UUID primary key.
 * @param userId        The user who owns this card. Foreign key → users.id
 * @param cardId        Which card this is. Foreign key → cards.id
 * @param conditions    List of condition/quantity pairs.
 *                      e.g. [ConditionCount("NM", 2, Some(12.50)),
 *                             ConditionCount("LP", 1, Some(10.62))]
 * @param selectedCond  The condition currently selected in the UI.
 *                      Persisted so the UI remembers your last selection.
 * @param updatedAt     When this entry was last modified.
 */
final case class CollectionEntry(
  id:           String,
  userId:       String,
  cardId:       String,
  conditions:   List[ConditionCount],
  selectedCond: String,
  updatedAt:    Instant,
  // Which physical storage drawer this card lives in, if the user has
  // assigned one. None = unassigned. Defaulted so every existing
  // construction site (save/import flows that have nothing to do with
  // physical storage) keeps compiling unchanged.
  drawerId:     Option[String] = None
):
  /**
   * METHOD: totalQuantity
   *
   * PURPOSE:
   *   The total number of copies owned across all conditions.
   *   Used for set completion stats and the quantity display on each card.
   *
   * @return Total copies owned. 0 if conditions list is empty.
   */
  def totalQuantity: Int = conditions.map(_.quantity).sum

  /**
   * METHOD: totalValue
   *
   * PURPOSE:
   *   The total market value of all copies in this entry.
   *   Calculated as sum of (quantity * price) for each condition.
   *   Only counts conditions where we have price data.
   *
   * @return Total value in USD. 0.0 if no price data exists.
   */
  def totalValue: Double =
    conditions.flatMap(c => c.price.map(_ * c.quantity)).sum

object CollectionEntry:
  given JsonCodec[CollectionEntry] = DeriveJsonCodec.gen[CollectionEntry]

/**
 * CASE CLASS: OwnedCard
 *
 * PURPOSE:
 *   A collection entry enriched with full card details.
 *   Returned by GET /api/collection/:userId/owned so the frontend can render
 *   every owned card (name, image, prices) without additional per-card requests.
 *
 * @param cardId       The card's ID — same value as card.id, kept at top level
 *                     so the frontend can key lists by it without drilling in.
 * @param conditions   Per-condition ownership counts.
 * @param selectedCond The condition tab the user last had active for this card.
 * @param updatedAt    When the entry was last modified.
 * @param card         Full card details (name, set, number, images, prices).
 */
final case class OwnedCard(
  cardId:       String,
  conditions:   List[ConditionCount],
  selectedCond: String,
  updatedAt:    java.time.Instant,
  card:         Card,
  drawerId:     Option[String] = None
)

object OwnedCard:
  given zio.json.JsonEncoder[OwnedCard] = zio.json.DeriveJsonEncoder.gen[OwnedCard]
