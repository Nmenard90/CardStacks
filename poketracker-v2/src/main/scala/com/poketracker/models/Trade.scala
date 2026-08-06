/**
 * Peer-to-peer trade system: a Listing posts cards, receives Offers,
 * and ends Completed or Cancelled.
 *
 * USED BY: TradeRepository, TradeService, TradeRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

enum TradeStatus:
  case Open, Pending, Completed, Cancelled

object TradeStatus:
  given JsonCodec[TradeStatus] = JsonCodec.string.transform(
    s => TradeStatus.valueOf(s),
    t => t.toString
  )

enum OfferStatus:
  case Pending, Accepted, Declined, Withdrawn

object OfferStatus:
  given JsonCodec[OfferStatus] = JsonCodec.string.transform(
    s => OfferStatus.valueOf(s),
    o => o.toString
  )

/** A card offered or requested in a trade, priced at time of listing for the fairness analyzer. */
final case class TradeCard(
  cardId:    String,
  cardName:  String,
  imageUrl:  String,
  condition: String,
  price:     Option[Double]
)

object TradeCard:
  given JsonCodec[TradeCard] = DeriveJsonCodec.gen[TradeCard]

/** @param wants  None means "make me an offer" — no specific ask. */
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

  /** Cards with no price on file are skipped, not counted as $0. */
  def offeringValue: Double =
    offering.flatMap(_.price).sum

  def wantsValue: Double =
    wants.getOrElse(Nil).flatMap(_.price).sum

object TradeListing:
  given JsonCodec[TradeListing] = DeriveJsonCodec.gen[TradeListing]

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

  def totalValue: Double =
    cards.flatMap(_.price).sum + cashAmount.getOrElse(0.0)

object TradeOffer:
  given JsonCodec[TradeOffer] = DeriveJsonCodec.gen[TradeOffer]
