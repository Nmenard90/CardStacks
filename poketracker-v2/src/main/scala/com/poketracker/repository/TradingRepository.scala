/**
 * TradingRepository — database access for card offers and their message
 * threads (migration 015). Offers were made from the old share-link trade
 * page, which has been folded into the shop; this keeps them readable and
 * answerable from My Shop. No authorization decisions live here beyond
 * scoping every query to the user it's given — the service decides who may
 * do what.
 *
 * USED BY: TradingService
 */

package com.poketracker.repository

import cats.syntax.all.*
import com.poketracker.models.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*
import zio.json.*
import java.time.Instant

trait TradingRepository:
  /** Offers where the user is either side, newest activity first, no messages. */
  def listOffers(userId: String, game: String): Task[List[CardOffer]]
  /** One offer with its full message thread, only if the user is a participant. */
  def findOffer(offerId: String, userId: String): Task[Option[CardOffer]]
  /** (sellerId, buyerId, status) */
  def offerParties(offerId: String): Task[Option[(String, String, String)]]
  /** Moves the offer from `from` to `to` only if it is still in `from`;
   *  false when someone else changed it first. */
  def setStatus(offerId: String, from: String, to: String, actorId: String): Task[Boolean]
  def addMessage(offerId: String, senderId: String, body: String): Task[Unit]
  def markRead(offerId: String, userId: String): Task[Unit]
  def unreadCount(userId: String, game: String): Task[Int]

object TradingRepository:

  final class Live(xa: Transactor[Task]) extends TradingRepository:

    // ── offers ──────────────────────────────────────────────────────────────

    private type OfferRow = (String, String, String, String, String, Option[Double], String,
                             Option[Instant], Option[Instant], Instant, Instant, String, String)

    private val offerSelect = fr"""SELECT o.id, o.seller_id, o.buyer_id, o.wants::text, o.gives::text, o.cash_amount,
        o.status, o.seller_read_at, o.buyer_read_at, o.created_at, o.updated_at, s.username, b.username
      FROM card_offers o
      JOIN users s ON s.id = o.seller_id
      JOIN users b ON b.id = o.buyer_id"""

    private def toOffer(viewerId: String, messages: List[OfferMessage])(r: OfferRow): CardOffer =
      val (id, sellerId, _, wantsJson, givesJson, cash, status, sellerRead, buyerRead, created, updated, sellerName, buyerName) = r
      val isSeller = viewerId == sellerId
      val readAt = if isSeller then sellerRead else buyerRead
      CardOffer(
        id         = id,
        role       = if isSeller then "seller" else "buyer",
        otherUser  = if isSeller then buyerName else sellerName,
        wants      = wantsJson.fromJson[List[OfferCard]].getOrElse(Nil),
        gives      = givesJson.fromJson[List[OfferCard]].getOrElse(Nil),
        cashAmount = cash,
        status     = status,
        unread     = readAt.forall(_.isBefore(updated)),
        createdAt  = created,
        updatedAt  = updated,
        messages   = messages
      )

    def listOffers(userId: String, game: String): Task[List[CardOffer]] =
      (offerSelect ++ fr"WHERE (o.seller_id = $userId OR o.buyer_id = $userId) AND o.game_id = $game ORDER BY o.updated_at DESC LIMIT 200")
        .query[OfferRow].to[List].map(_.map(toOffer(userId, Nil))).transact(xa)

    def findOffer(offerId: String, userId: String): Task[Option[CardOffer]] =
      (for
        row  <- (offerSelect ++ fr"WHERE o.id = $offerId AND (o.seller_id = $userId OR o.buyer_id = $userId)")
                  .query[OfferRow].option
        msgs <- row.fold(List.empty[OfferMessage].pure[ConnectionIO]) { _ =>
                  sql"""SELECT m.id, m.sender_id, u.username, m.body, m.created_at
                        FROM offer_messages m JOIN users u ON u.id = m.sender_id
                        WHERE m.offer_id = $offerId ORDER BY m.created_at"""
                    .query[(String, String, String, String, Instant)].to[List]
                    .map(_.map(OfferMessage.apply.tupled))
                }
      yield row.map(toOffer(userId, msgs))).transact(xa)

    def offerParties(offerId: String): Task[Option[(String, String, String)]] =
      sql"SELECT seller_id, buyer_id, status FROM card_offers WHERE id = $offerId"
        .query[(String, String, String)].option.transact(xa)

    /** Bumps updated_at (so the other side sees it as unread) and marks it
     *  read for the actor, who obviously already knows. */
    private def touch(offerId: String, actorId: String): ConnectionIO[Int] =
      sql"""UPDATE card_offers SET updated_at = NOW(),
              seller_read_at = CASE WHEN seller_id = $actorId THEN NOW() ELSE seller_read_at END,
              buyer_read_at  = CASE WHEN buyer_id  = $actorId THEN NOW() ELSE buyer_read_at  END
            WHERE id = $offerId""".update.run

    def setStatus(offerId: String, from: String, to: String, actorId: String): Task[Boolean] =
      sql"UPDATE card_offers SET status = $to WHERE id = $offerId AND status = $from".update.run
        .flatMap(n => if n == 1 then touch(offerId, actorId).as(true) else false.pure[ConnectionIO])
        .transact(xa)

    def addMessage(offerId: String, senderId: String, body: String): Task[Unit] =
      (sql"INSERT INTO offer_messages (offer_id, sender_id, body) VALUES ($offerId, $senderId, $body)".update.run *>
        touch(offerId, senderId)).void.transact(xa)

    def markRead(offerId: String, userId: String): Task[Unit] =
      sql"""UPDATE card_offers SET
              seller_read_at = CASE WHEN seller_id = $userId THEN NOW() ELSE seller_read_at END,
              buyer_read_at  = CASE WHEN buyer_id  = $userId THEN NOW() ELSE buyer_read_at  END
            WHERE id = $offerId""".update.run.void.transact(xa)

    def unreadCount(userId: String, game: String): Task[Int] =
      sql"""SELECT COUNT(*)::int FROM card_offers
            WHERE game_id = $game AND (
                  (seller_id = $userId AND (seller_read_at IS NULL OR seller_read_at < updated_at))
               OR (buyer_id  = $userId AND (buyer_read_at  IS NULL OR buyer_read_at  < updated_at)))"""
        .query[Int].unique.transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, TradingRepository] =
    ZLayer.fromFunction(new Live(_))
