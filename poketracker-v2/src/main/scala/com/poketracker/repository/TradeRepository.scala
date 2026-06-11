/**
 * FILE: TradeRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/TradeRepository.scala
 *
 * PURPOSE:
 *   Handles all database operations for trade listings, offers, and ratings.
 *   This is the data layer for the peer-to-peer trading system.
 *
 * USED BY: TradeService
 * DEPENDS ON: Doobie, ZIO, Trade model, Reputation model
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

/**
 * TRAIT: TradeRepository
 * PURPOSE: Interface for all trade data access operations.
 */
trait TradeRepository:

  /**
   * METHOD: findListingsByLocation
   * PURPOSE: Fetches open trade listings near a given location.
   *          Location matching is currently string-based (same city).
   *          Future: replace with PostGIS geographic distance queries.
   * @param location  City-level location string e.g. "Austin, TX"
   * @param game      Which card game to filter by e.g. "pokemon"
   * @param limit     Maximum results to return
   * @return          Open listings in the same location, newest first
   */
  def findListingsByLocation(
    location: String,
    game:     String,
    limit:    Int = 50
  ): Task[List[TradeListing]]

  /**
   * METHOD: findListingById
   * PURPOSE: Fetches a single listing with full details.
   * @param id  The listing UUID
   * @return    Some(listing) if found and not deleted, None otherwise
   */
  def findListingById(id: String): Task[Option[TradeListing]]

  /**
   * METHOD: findListingsByUser
   * PURPOSE: Fetches all listings created by a user.
   *          Used for "My Listings" view in the UI.
   * @param userId  The user
   * @return        All listings by this user, newest first
   */
  def findListingsByUser(userId: String): Task[List[TradeListing]]

  /**
   * METHOD: createListing
   * PURPOSE: Creates a new trade listing.
   * @param listing  The listing to create
   * @return         Unit
   */
  def createListing(listing: TradeListing): Task[Unit]

  /**
   * METHOD: updateListingStatus
   * PURPOSE: Changes the status of a listing (Open/Pending/Completed/Cancelled).
   * @param id      The listing to update
   * @param status  The new status
   * @return        Unit
   */
  def updateListingStatus(id: String, status: TradeStatus): Task[Unit]

  /**
   * METHOD: findOffersByListing
   * PURPOSE: Fetches all offers submitted for a listing.
   *          Used by the listing owner to review offers.
   * @param listingId  The listing to get offers for
   * @return           All offers for this listing, newest first
   */
  def findOffersByListing(listingId: String): Task[List[TradeOffer]]

  /**
   * METHOD: createOffer
   * PURPOSE: Submits a new trade offer.
   * @param offer  The offer to create
   * @return       Unit
   */
  def createOffer(offer: TradeOffer): Task[Unit]

  /**
   * METHOD: updateOfferStatus
   * PURPOSE: Changes the status of an offer (Accepted/Declined/Withdrawn).
   * @param id      The offer to update
   * @param status  The new status
   * @return        Unit
   */
  def updateOfferStatus(id: String, status: OfferStatus): Task[Unit]

  /**
   * METHOD: createRating
   * PURPOSE: Saves a trade rating after a completed trade.
   * @param rating  The rating to save
   * @return        Unit
   */
  def createRating(rating: TradeRating): Task[Unit]

  /**
   * METHOD: calculateReputation
   * PURPOSE: Computes a user's reputation score from their trade ratings.
   *          Score = (positive ratings * 1) + (neutral ratings * 0) + (negative ratings * -2)
   *          Negative trades hurt more than positive ones help — discourages bad behavior.
   * @param userId  The user to calculate for
   * @return        The calculated reputation score
   */
  def calculateReputation(userId: String): Task[Int]

  /**
   * METHOD: createReport
   * PURPOSE: Files a report against a user.
   * @param report  The report to save
   * @return        Unit
   */
  def createReport(report: UserReport): Task[Unit]

object TradeRepository:

  final class Live(xa: Transactor[Task]) extends TradeRepository:

    // Helper: parse a row into a TradeListing, returns None if JSON is invalid
    private def rowToListing(
      id: String, userId: String, game: String,
      offeringJson: String, wantsJson: Option[String],
      cashOk: Boolean, location: String,
      description: Option[String], status: String,
      createdAt: Instant, updatedAt: Instant
    ): Option[TradeListing] =
      for
        offering <- offeringJson.fromJson[List[TradeCard]].toOption
        // wantsJson is optional — None means "make me an offer"
        wants     = wantsJson.flatMap(_.fromJson[List[TradeCard]].toOption)
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
      // Score formula: positive=+1, neutral=0, negative=-2
      // Weighting negatives more heavily discourages bad behavior.
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
