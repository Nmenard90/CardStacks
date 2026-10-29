/**
 * Card offers between two signed-in collectors — cash, cards, or both —
 * each with a message thread. They were made from the old share-link trade
 * page (now folded into the shop) and are answered from My Shop → Offers.
 * No money moves through the app; cash amounts are settled off-platform.
 *
 * USED BY: TradingRepository, TradingService, TradingRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/** One card line inside an offer, snapshotted when the offer is made so
 *  later price or catalog changes don't rewrite what was agreed. */
final case class OfferCard(
  cardId:      String,
  name:        String,
  imageSmall:  String,
  condition:   String,
  quantity:    Int,
  marketPrice: Option[Double]
)
object OfferCard:
  given JsonCodec[OfferCard] = DeriveJsonCodec.gen[OfferCard]

final case class OfferMessage(
  id:        String,
  senderId:  String,
  sender:    String,
  body:      String,
  createdAt: Instant
)
object OfferMessage:
  given JsonCodec[OfferMessage] = DeriveJsonCodec.gen[OfferMessage]

/** An offer as seen by one of its two participants. `role` is the viewer's
 *  side ("seller" or "buyer"); `otherUser` is the counterparty's username. */
final case class CardOffer(
  id:         String,
  role:       String,
  otherUser:  String,
  wants:      List[OfferCard],
  gives:      List[OfferCard],
  cashAmount: Option[Double],
  status:     String,
  unread:     Boolean,
  createdAt:  Instant,
  updatedAt:  Instant,
  messages:   List[OfferMessage]
)
object CardOffer:
  given JsonCodec[CardOffer] = DeriveJsonCodec.gen[CardOffer]

/** Allowed offer statuses — mirrors the CHECK constraint in migration 015. */
object OfferState:
  val Pending   = "Pending"
  val Accepted  = "Accepted"
  val Declined  = "Declined"
  val Withdrawn = "Withdrawn"
  val Cancelled = "Cancelled"
  val Completed = "Completed"
