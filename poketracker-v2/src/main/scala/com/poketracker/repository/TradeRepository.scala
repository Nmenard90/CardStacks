/**
 * TradeRepository — all database access for trade listings, offers, and ratings.
 *
 * HOW IT WORKS
 *   Same trait/Live/layer shape as UserRepository. The one wrinkle here:
 *   `offering`/`wants`/`cards` are stored as jsonb text, so every read
 *   path parses them back into `List[TradeCard]` via `rowToListing`. A
 *   row whose JSON fails to parse is silently dropped rather than
 *   crashing the whole query — acceptable because a single corrupt
 *   listing should never take down the trade feed.
 *
 * USED BY: TradeService
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

trait TradeRepository:

  /** String-equality location matching for now — a PostGIS radius query is the real fix. */
  def findListingsByLocation(
    location: String,
    game:     String,
    limit:    Int = 50
  ): Task[List[TradeListing]]

  def findListingById(id: String): Task[Option[TradeListing]]
  def findListingsByUser(userId: String): Task[List[TradeListing]]
  def createListing(listing: TradeListing): Task[Unit]
  def updateListingStatus(id: String, status: TradeStatus): Task[Unit]
  def findOffersByListing(listingId: String): Task[List[TradeOffer]]
  def createOffer(offer: TradeOffer): Task[Unit]
  def updateOfferStatus(id: String, status: OfferStatus): Task[Unit]
  def createRating(rating: TradeRating): Task[Unit]

  /** Positive +1, Neutral 0, Negative -2 — weighted so bad trades hurt more than good ones help. */
  def calculateReputation(userId: String): Task[Int]

  def createReport(report: UserReport): Task[Unit]

object TradeRepository:

  final class Live(xa: Transactor[Task]) extends TradeRepository:

    private def rowToListing(
      id: String, userId: String, game: String,
      offeringJson: String, wantsJson: Option[String],
      cashOk: Boolean, location: String,
      description: Option[String], status: String,
      createdAt: Instant, updatedAt: Instant
    ): Option[TradeListing] =
      for
        offering <- offeringJson.fromJson[List[TradeCard]].toOption
        wants     = wantsJson.flatMap(_.fromJson[List[TradeCard]].toOption)  // None = "make me an offer"
      yield TradeListing(
        id, userId, game, offering, wants, cashOk, location,
        description, TradeStatus.valueOf(status), createdAt, updatedAt
      )

    def findListingsByLocation(
      location: String, game: String, limit: Int = 50
    ): Task[List[TradeListing]] =
      sql"""
        SELECT id, user_id, game, offering, wants, cash_ok, location,
               description, status, created_at, updated_at
        FROM trade_listings
        WHERE location = $location
          AND game = $game
          AND status = 'Open'
        ORDER BY created_at DESC
        LIMIT $limit
      """
        .query[(String, String, String, String, Option[String], Boolean,
                String, Option[String], String, Instant, Instant)]
        .to[List]
        .map(_.flatMap(rowToListing.tupled))
        .transact(xa)

    def findListingById(id: String): Task[Option[TradeListing]] =
      sql"""
        SELECT id, user_id, game, offering, wants, cash_ok, location,
               description, status, created_at, updated_at
        FROM trade_listings WHERE id = $id
      """
        .query[(String, String, String, String, Option[String], Boolean,
                String, Option[String], String, Instant, Instant)]
        .option
        .map(_.flatMap(rowToListing.tupled))
        .transact(xa)

    def findListingsByUser(userId: String): Task[List[TradeListing]] =
      sql"""
        SELECT id, user_id, game, offering, wants, cash_ok, location,
               description, status, created_at, updated_at
        FROM trade_listings
        WHERE user_id = $userId
        ORDER BY created_at DESC
      """
        .query[(String, String, String, String, Option[String], Boolean,
                String, Option[String], String, Instant, Instant)]
        .to[List]
        .map(_.flatMap(rowToListing.tupled))
        .transact(xa)

    def createListing(listing: TradeListing): Task[Unit] =
      val offeringJson = listing.offering.toJson
      val wantsJson    = listing.wants.map(_.toJson)

      sql"""
        INSERT INTO trade_listings
          (id, user_id, game, offering, wants, cash_ok, location,
           description, status, created_at, updated_at)
        VALUES
          (${listing.id}, ${listing.userId}, ${listing.game},
           $offeringJson::jsonb, ${wantsJson.map(j => s"$j")}::jsonb,
           ${listing.cashOk}, ${listing.location}, ${listing.description},
           ${listing.status.toString}, ${listing.createdAt}, ${listing.updatedAt})
      """
        .update.run.void.transact(xa)

    def updateListingStatus(id: String, status: TradeStatus): Task[Unit] =
      sql"""
        UPDATE trade_listings
        SET status = ${status.toString}, updated_at = NOW()
        WHERE id = $id
      """
        .update.run.void.transact(xa)

    def findOffersByListing(listingId: String): Task[List[TradeOffer]] =
      sql"""
        SELECT id, listing_id, from_user_id, cards, cash_amount, message,
               status, created_at
        FROM trade_offers
        WHERE listing_id = $listingId
        ORDER BY created_at DESC
      """
        .query[(String, String, String, String, Option[Double], Option[String],
                String, Instant)]
        .to[List]
        .map(_.flatMap { case (id, listId, fromUser, cardsJson, cash, msg, status, createdAt) =>
          cardsJson.fromJson[List[TradeCard]].toOption.map { cards =>
            TradeOffer(id, listId, fromUser, cards, cash, msg,
                       OfferStatus.valueOf(status), createdAt)
          }
        })
        .transact(xa)

    def createOffer(offer: TradeOffer): Task[Unit] =
      val cardsJson = offer.cards.toJson

      sql"""
        INSERT INTO trade_offers
          (id, listing_id, from_user_id, cards, cash_amount, message, status, created_at)
        VALUES
          (${offer.id}, ${offer.listingId}, ${offer.fromUserId},
           $cardsJson::jsonb, ${offer.cashAmount}, ${offer.message},
           ${offer.status.toString}, ${offer.createdAt})
      """
        .update.run.void.transact(xa)

    def updateOfferStatus(id: String, status: OfferStatus): Task[Unit] =
      sql"""
        UPDATE trade_offers SET status = ${status.toString} WHERE id = $id
      """
        .update.run.void.transact(xa)

    def createRating(rating: TradeRating): Task[Unit] =
      sql"""
        INSERT INTO trade_ratings
          (id, trade_id, from_user_id, for_user_id, rating, comment, created_at)
        VALUES
          (${rating.id}, ${rating.tradeId}, ${rating.fromUserId},
           ${rating.forUserId}, ${rating.rating.toString},
           ${rating.comment}, ${rating.createdAt})
      """
        .update.run.void.transact(xa)

    def calculateReputation(userId: String): Task[Int] =
      sql"""
        SELECT
          COALESCE(SUM(CASE rating
            WHEN 'Positive' THEN 1
            WHEN 'Neutral'  THEN 0
            WHEN 'Negative' THEN -2
            ELSE 0
          END), 0)
        FROM trade_ratings
        WHERE for_user_id = $userId
      """
        .query[Int]
        .unique
        .transact(xa)

    def createReport(report: UserReport): Task[Unit] =
      sql"""
        INSERT INTO user_reports
          (id, reported_user_id, reported_by_id, reason, description, trade_id, created_at)
        VALUES
          (${report.id}, ${report.reportedUserId}, ${report.reportedById},
           ${report.reason.toString}, ${report.description},
           ${report.tradeId}, ${report.createdAt})
      """
        .update.run.void.transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, TradeRepository] =
    ZLayer.fromFunction(new Live(_))
