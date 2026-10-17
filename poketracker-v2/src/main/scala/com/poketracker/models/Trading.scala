/**
 * Share-link trading: a user hand-picks cards into a trade list, shares one
 * link to it (optionally to their whole collection too), and signed-in
 * collectors make offers — cash, cards from their own collection, or both.
 * Every offer carries a message thread. No money moves through the app;
 * cash amounts are proposals settled off-platform.
 *
 * USED BY: TradingRepository, TradingService, TradingRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/** The owner's own view of their share settings. */
final case class ShareSettings(
  slug:             String,
  enabled:          Boolean,
  collectionPublic: Boolean,
  bio:              Option[String]
)
object ShareSettings:
  given JsonCodec[ShareSettings] = DeriveJsonCodec.gen[ShareSettings]

/** A card shown on a share page or trade list. Deliberately carries no
 *  purchase price / purchase date — those stay private to the owner. */
final case class TradeCardView(
  cardId:      String,
  name:        String,
  setId:       String,
  number:      String,
  rarity:      Option[String],
  artist:      Option[String],
  imageSmall:  String,
  imageLarge:  String,
  condition:   String,
  quantity:    Int,
  marketPrice: Option[Double]
)
object TradeCardView:
  given JsonCodec[TradeCardView] = DeriveJsonCodec.gen[TradeCardView]

final case class TradeListItem(
  id:          String,
  card:        TradeCardView,
  askingPrice: Option[Double],
  note:        Option[String],
  updatedAt:   Instant
)
object TradeListItem:
  given JsonCodec[TradeListItem] = DeriveJsonCodec.gen[TradeListItem]

/** What anyone with the link sees, for one game. `collection` is None
 *  unless the owner turned on collectionPublic. `games` lists every game the
 *  owner has something to show in, so the page can offer a game picker. */
final case class SharedProfile(
  username:    String,
  reputation:  Int,
  memberSince: Instant,
  bio:         Option[String],
  tradeList:   List[TradeListItem],
  collection:  Option[List[TradeCardView]],
  game:        String,
  games:       List[String]
)
object SharedProfile:
  given JsonCodec[SharedProfile] = DeriveJsonCodec.gen[SharedProfile]

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
