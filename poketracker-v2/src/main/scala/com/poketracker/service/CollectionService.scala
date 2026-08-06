/**
 * CollectionService — adding/removing owned cards, per-condition
 * quantities, collection statistics.
 *
 * HOW IT WORKS
 *   Thin rules layer over two repositories: CollectionRepository for the
 *   owned-card rows, CardRepository for card/price lookups used in
 *   getStats. updateEntry auto-deletes a row once every condition hits
 *   zero, so "owns zero copies" is represented by absence, not a zero row.
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

trait CollectionService:

  def getCollection(userId: String): Task[List[CollectionEntry]]

  /**
   * Creates the entry if missing, deletes it if every condition's
   * quantity is now zero.
   * @return The updated entry, or None if it was deleted.
   */
  def updateEntry(
    userId:     String,
    cardId:     String,
    conditions: List[ConditionCount],
    selCond:    String
  ): Task[Option[CollectionEntry]]

  /** Bulk equivalent of updateEntry — used by CSV import, one transaction instead of N. */
  def bulkUpdate(
    userId:  String,
    updates: List[(String, List[ConditionCount], String)]
  ): Task[Unit]

  def getStats(userId: String): Task[CollectionStats]

  /** Every owned card, enriched with card/price data, for the My Collection page. */
  def getOwnedCards(userId: String): Task[List[OwnedCard]]

/**
 * Computed summary, not a stored entity — lives here rather than in
 * models/ since nothing persists it.
 */
final case class CollectionStats(
  totalCards:  Int,
  uniqueCards: Int,
  totalValue:  Double,
  setsEntered: Int
)

object CollectionStats:
  // Encoder only — this type is only ever sent to the frontend, never read back.
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
      val hasQuantity = conditions.exists(_.quantity > 0)

      if !hasQuantity then
        collectionRepo.deleteEntry(userId, cardId).as(None)
      else
        for
          existing <- collectionRepo.findEntry(userId, cardId)
          // Reuse the existing row's ID so this is an update, not a duplicate.
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
      }.filter(_.conditions.nonEmpty)
      collectionRepo.bulkUpsert(entries)

    def getOwnedCards(userId: String): Task[List[OwnedCard]] =
      collectionRepo.findByUserWithCards(userId)

    def getStats(userId: String): Task[CollectionStats] =
      collectionRepo.findByUser(userId).map { entries =>
        val totalCards  = entries.map(_.totalQuantity).sum
        val uniqueCards = entries.size
        val totalValue  = entries.map(_.totalValue).sum

        // Card IDs are "setId-number" and setId itself can contain dashes,
        // so this takes everything before the LAST dash rather than the first.
        val setsEntered = entries
          .map(e => e.cardId.reverse.dropWhile(_ != '-').drop(1).reverse)
          .toSet
          .size

        CollectionStats(totalCards, uniqueCards, totalValue, setsEntered)
      }

  val layer: ZLayer[CollectionRepository & CardRepository, Nothing, CollectionService] =
    ZLayer.fromFunction(new Live(_, _))
