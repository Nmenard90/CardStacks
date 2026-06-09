/**
 * FILE: Trade.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/Trade.scala
 *
 * PURPOSE:
 *   Represents the peer-to-peer trade system.
 *   A Trade starts as a Listing (someone posts cards they want to trade),
 *   receives Offers from other users, and ends as Completed or Cancelled.
 *
 * IMPORTS:
 *   zio.json.* — JSON conversion
 *   java.time.Instant — UTC timestamps
 *
 * USED BY: TradeRepository, TradeService, TradeRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * ENUM: TradeStatus
 *
 * PURPOSE:
 *   The lifecycle of a trade listing.
 *
 *   Open      — listing is visible and accepting offers
 *   Pending   — an offer has been accepted, waiting for meetup confirmation
 *   Completed — both parties confirmed the trade happened
 *   Cancelled — listing was withdrawn or the trade fell through
 */
enum TradeStatus:
  case Open, Pending, Completed, Cancelled

object TradeStatus:
  given JsonCodec[TradeStatus] = JsonCodec.string.transform(
    s => TradeStatus.valueOf(s),
    t => t.toString
  )

/**
 * ENUM: OfferStatus
 *
 * PURPOSE:
 *   The lifecycle of a trade offer.
 *
 *   Pending  — submitted, waiting for listing owner to respond
 *   Accepted — listing owner wants to proceed with this offer
 *   Declined — listing owner passed on this offer
 *   Withdrawn — the person who made the offer cancelled it
 */
enum OfferStatus:
  case Pending, Accepted, Declined, Withdrawn

object OfferStatus:
  given JsonCodec[OfferStatus] = JsonCodec.string.transform(
    s => OfferStatus.valueOf(s),
    o => o.toString
  )

/**
 * CASE CLASS: TradeCard
 *
 * PURPOSE:
 *   A card being offered or requested in a trade, with its condition
 *   and the market price at time of the trade (for the analyzer verdict).
 *
 * @param cardId     Which card. Foreign key → cards.id
 * @param cardName   Cached name for display.
 * @param imageUrl   Cached image URL for display.
 * @param condition  The condition of this specific copy being traded.
 * @param price      Market price at time of listing. Used for fairness analysis.
 *                   Option because some cards have no price data.
 */
final case class TradeCard(
  cardId:    String,
  cardName:  String,
  imageUrl:  String,
  condition: String,
  price:     Option[Double]
)

object TradeCard:
  given JsonCodec[TradeCard] = DeriveJsonCodec.gen[TradeCard]

/**
 * CASE CLASS: TradeListing
 *
 * PURPOSE:
 *   A card (or cards) posted by a user who wants to trade them.
 *   Other users can see this listing and submit offers.
 *
 * @param id           UUID primary key.
 * @param userId       Who is offering these cards. Foreign key → users.id
 * @param game         Which card game. "pokemon" initially, extensible to others.
 *                     This field makes the trade system work for any TCG.
 * @param offering     The cards being offered in this listing.
 * @param wants        What the lister wants in return.
 *                     None means "make me an offer" — any reasonable trade considered.
 * @param cashOk       Whether the lister would accept cash instead of cards.
 * @param location     City-level location for proximity matching.
 *                     e.g. "Austin, TX"
 * @param description  Optional free-text notes from the lister.
 *                     e.g. "Cards are from my personal collection, stored in sleeves"
 * @param status       Current state of this listing.
 * @param createdAt    When this listing was posted.
 * @param updatedAt    When this listing was last changed.
 */
final case class TradeListing(
  id:          String,
  userId:      String,
  game:        String,
  offering:    List[TradeCard],
  wants:       Option[List[TradeCard]],
  cashOk:      Boolean,
  location:    String,
  description: Option[String],
  status:      TradeStatus,
  createdAt:   Instant,
  updatedAt:   Instant
):
  /**
   * METHOD: offeringValue
   * PURPOSE: Total market value of all cards being offered.
   *          Used by the trade analyzer to calculate fairness.
   * @return Total in USD, 0.0 if no price data
   */
  def offeringValue: Double =
    offering.flatMap(_.price).sum

  /**
   * METHOD: wantsValue
   * PURPOSE: Total market value of all cards the lister wants in return.
   * @return Total in USD, 0.0 if no price data or no specific wants
   */
  def wantsValue: Double =
    wants.getOrElse(Nil).flatMap(_.price).sum

object TradeListing:
  given JsonCodec[TradeListing] = DeriveJsonCodec.gen[TradeListing]

/**
 * CASE CLASS: TradeOffer
 *
 * PURPOSE:
 *   An offer submitted by a user in response to a TradeListing.
 *   The listing owner reviews offers and accepts or declines them.
 *
 * @param id          UUID primary key.
 * @param listingId   Which listing this is responding to. Foreign key → trade_listings.id
 * @param fromUserId  Who made this offer. Foreign key → users.id
 * @param cards       The cards being offered in exchange.
 * @param cashAmount  Optional cash component of the offer in USD.
 *                    None means cards only, Some(10.00) means cards + $10.
 * @param message     Optional message to the listing owner.
 *                    e.g. "Cards are all NM, bought from official store"
 * @param status      Current state of this offer.
 * @param createdAt   When this offer was submitted.
 */
final case class TradeOffer(
  id:          String,
  listingId:   String,
  fromUserId:  String,
  cards:       List[TradeCard],
  cashAmount:  Option[Double],
  message:     Option[String],
  status:      OfferStatus,
  createdAt:   Instant
):
  /**
   * METHOD: totalValue
   * PURPOSE: Total value of this offer (cards + cash).
   *          Used by the trade analyzer to calculate fairness vs the listing.
   * @return Total in USD
   */
  def totalValue: Double =
    cards.flatMap(_.price).sum + cashAmount.getOrElse(0.0)

object TradeOffer:
  given JsonCodec[TradeOffer] = DeriveJsonCodec.gen[TradeOffer]
