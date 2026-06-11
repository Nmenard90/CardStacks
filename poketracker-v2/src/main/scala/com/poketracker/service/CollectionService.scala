/**
 * FILE: CollectionService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/CollectionService.scala
 *
 * PURPOSE:
 *   Business logic for managing a user's card collection.
 *   Handles adding/removing cards, updating quantities per condition,
 *   and calculating collection statistics.
 *
 * USED BY: CollectionRoutes
 * DEPENDS ON: CollectionRepository, CardRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.{CollectionRepository, CardRepository}
import zio.*
import java.time.Instant
import java.util.UUID

/**
 * TRAIT: CollectionService
 * PURPOSE: Interface for all collection business logic.
 */
trait CollectionService:

  /**
   * METHOD: getCollection
   * PURPOSE: Returns a user's entire collection.
   * @param userId  The user
   * @return        All collection entries for this user
   */
  def getCollection(userId: String): Task[List[CollectionEntry]]

  /**
   * METHOD: updateEntry
   * PURPOSE: Updates the quantities for a specific card in a user's collection.
   *          Creates the entry if it does not exist yet.
   *          Deletes the entry if all quantities are set to zero.
   *
   * @param userId      The user
   * @param cardId      The card
   * @param conditions  New list of condition/quantity pairs
   * @param selCond     Which condition is currently selected in the UI
   * @return            The updated entry, or None if it was deleted (all zero)
   */
  def updateEntry(
    userId:     String,
    cardId:     String,
    conditions: List[ConditionCount],
    selCond:    String
  ): Task[Option[CollectionEntry]]

  /**
   * METHOD: bulkUpdate
   * PURPOSE: Updates multiple collection entries at once.
   *          Used when importing a collection from CSV.
   *          More efficient than calling updateEntry repeatedly.
   *
   * @param userId   The user
   * @param updates  List of (cardId, conditions, selectedCond) tuples
   * @return         Unit
   */
  def bulkUpdate(
    userId:  String,
    updates: List[(String, List[ConditionCount], String)]
  ): Task[Unit]

  /**
   * METHOD: getStats
   * PURPOSE: Calculates summary statistics for a user's collection.
   *          Used for the stats bar at the top of the collection page.
   *
   * @param userId  The user
   * @return        CollectionStats with totals
   */
  def getStats(userId: String): Task[CollectionStats]

/**
 * CASE CLASS: CollectionStats
 * PURPOSE: Summary statistics for a user's collection.
 *          Returned by getStats and displayed in the UI stats bar.
 *
 * @param totalCards   Total number of individual cards owned (all conditions summed)
 * @param uniqueCards  Number of unique card IDs owned (ignoring quantity)
 * @param totalValue   Estimated total value in USD based on current prices
 * @param setsEntered  How many different sets the user has at least one card from
 */
final case class CollectionStats(
  totalCards:  Int,
  uniqueCards: Int,
  totalValue:  Double,
  setsEntered: Int
)

object CollectionStats:
  given zio.json.JsonEncoder[CollectionStats] = zio.json.DeriveJsonEncoder.gen

object CollectionService:

  final class Live(
    collectionRepo: CollectionRepository,
    cardRepo:       CardRepository
  ) extends CollectionService:

    def getCollection(userId: String): Task[List[CollectionEntry]] =
      collectionRepo.findByUser(userId)

    def updateEntry(
      userId:     String,
      cardId:     String,
      conditions: List[ConditionCount],
      selCond:    String
    ): Task[Option[CollectionEntry]] =
      // If all conditions have zero quantity, remove from collection entirely
      val hasQuantity = conditions.exists(_.quantity > 0)
      if !hasQuantity then
        collectionRepo.deleteEntry(userId, cardId).as(None)
      else
        for
          // Check if entry already exists to preserve its ID
          existing <- collectionRepo.findEntry(userId, cardId)
          id        = existing.map(_.id).getOrElse(UUID.randomUUID().toString)
          entry     = CollectionEntry(
                        id         = id,
                        userId     = userId,
                        cardId     = cardId,
                        conditions = conditions.filter(_.quantity > 0),
                        selectedCond = selCond,
                        updatedAt  = Instant.now()
                      )
          _        <- collectionRepo.upsertEntry(entry)
        yield Some(entry)

    def bulkUpdate(
      userId:  String,
      updates: List[(String, List[ConditionCount], String)]
    ): Task[Unit] =
      val entries = updates.map { case (cardId, conditions, selCond) =>
        CollectionEntry(
          id           = UUID.randomUUID().toString,
          userId       = userId,
          cardId       = cardId,
          conditions   = conditions.filter(_.quantity > 0),
          selectedCond = selCond,
          updatedAt    = Instant.now()
        )
      }.filter(_.conditions.nonEmpty) // Only save entries with at least one card
      collectionRepo.bulkUpsert(entries)

    def getStats(userId: String): Task[CollectionStats] =
      collectionRepo.findByUser(userId).map { entries =>
        val totalCards  = entries.map(_.totalQuantity).sum
        val uniqueCards = entries.size
        val totalValue  = entries.map(_.totalValue).sum
        // Count distinct set IDs by extracting the set part of each card ID.
        // Card IDs are in format "setId-number" e.g. "sv1-1", "base1-4"
        // We split on the last "-" to get the set ID.
        // Note: some set IDs contain "-" so we split on last occurrence only.
        val setsEntered = entries
          .map(e => e.cardId.reverse.dropWhile(_ != '-').drop(1).reverse)
          .toSet
          .size
        CollectionStats(totalCards, uniqueCards, totalValue, setsEntered)
      }

  val layer: ZLayer[CollectionRepository & CardRepository, Nothing, CollectionService] =
    ZLayer.fromFunction(new Live(_, _))