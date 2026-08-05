/**
 * FILE: StorageRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/StorageRepository.scala
 *
 * PURPOSE:
 *   All database operations for physical storage (boxes, drawers, and
 *   which drawer an owned card is assigned to). A card's location lives on
 *   collection_entries.drawer_id (see schema.sql migration 006) rather than
 *   a separate join table — there's one row per (user, card) already, and
 *   v1 tracks one location per card, not per physical copy.
 *
 * USED BY: StorageService
 * DEPENDS ON: Doobie, ZIO, Storage model, Collection model (for OwnedCard)
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

trait StorageRepository:

  /** All boxes for a user, each with its drawers (and each drawer's live card count), ordered by position. */
  def findBoxesByUser(userId: String): Task[List[StorageBox]]

  /** Creates a new box at the end of the user's stack. */
  def createBox(userId: String, name: String): Task[StorageBox]

  def renameBox(id: String, name: String): Task[Unit]
  def reorderBox(id: String, position: Int): Task[Unit]

  /** Deletes a box and its drawers. Cards in those drawers get drawer_id = NULL, not deleted. */
  def deleteBox(id: String): Task[Unit]

  /** Creates a new drawer at the end of a box. */
  def createDrawer(boxId: String, name: String): Task[StorageDrawer]

  def renameDrawer(id: String, name: String): Task[Unit]
  def reorderDrawer(id: String, position: Int): Task[Unit]

  /** Deletes a drawer. Cards in it get drawer_id = NULL, not deleted. */
  def deleteDrawer(id: String): Task[Unit]

  /** Every owned card currently assigned to a drawer. */
  def findDrawerCards(drawerId: String): Task[List[OwnedCard]]

  /** Every owned card with no drawer assigned yet. */
  def findUnassignedCards(userId: String): Task[List[OwnedCard]]

  /**
   * Assigns the given cards (owned by userId) to a drawer.
   * @return number of cards actually assigned, and — separately, since this
   *         is a pure read — whether any OTHER owned card from the same
   *         set(s) is already in a different drawer.
   */
  def assignCards(userId: String, cardIds: List[String], drawerId: String): Task[Int]

  /**
   * Counts, across the given cards' sets, how many OTHER owned cards from
   * those same sets already sit in a drawer other than `drawerId`. Used by
   * the service layer to build the "this set is split across boxes"
   * warning — informational only, never blocks the assignment.
   */
  def countOtherDrawerCardsInSameSets(userId: String, cardIds: List[String], drawerId: String): Task[Int]

  /** Clears a card's drawer assignment (moves it back to "unassigned"). */
  def unassignCard(userId: String, cardId: String): Task[Unit]

object StorageRepository:

  final class Live(xa: Transactor[Task]) extends StorageRepository:

    def findBoxesByUser(userId: String): Task[List[StorageBox]] =
      val boxesQuery =
        sql"""
          SELECT id, user_id, name, position, created_at, updated_at
          FROM storage_boxes
          WHERE user_id = $userId
          ORDER BY position, created_at
        """
          .query[(String, String, String, Int, Instant, Instant)]
          .to[List]

      val drawersQuery =
        sql"""
          SELECT d.id, d.box_id, d.name, d.position, COUNT(ce.card_id), d.created_at, d.updated_at
          FROM storage_drawers d
          JOIN storage_boxes b ON b.id = d.box_id
          LEFT JOIN collection_entries ce ON ce.drawer_id = d.id
          WHERE b.user_id = $userId
          GROUP BY d.id
          ORDER BY d.box_id, d.position, d.created_at
        """
          .query[(String, String, String, Int, Int, Instant, Instant)]
          .to[List]

      (for
        boxes   <- boxesQuery
        drawers <- drawersQuery
      yield
        val drawersByBox = drawers
          .map { case (id, boxId, name, pos, count, createdAt, updatedAt) =>
            StorageDrawer(id, boxId, name, pos, count, createdAt, updatedAt)
          }
          .groupBy(_.boxId)
        boxes.map { case (id, uid, name, pos, createdAt, updatedAt) =>
          StorageBox(id, uid, name, pos, drawersByBox.getOrElse(id, Nil), createdAt, updatedAt)
        }
      ).transact(xa)

    def createBox(userId: String, name: String): Task[StorageBox] =
      for
        nextPos <- sql"SELECT COALESCE(MAX(position) + 1, 0) FROM storage_boxes WHERE user_id = $userId"
                     .query[Int].unique.transact(xa)
        id       = java.util.UUID.randomUUID().toString
        now      = Instant.now()
        _       <- sql"""
                     INSERT INTO storage_boxes (id, user_id, name, position, created_at, updated_at)
                     VALUES ($id, $userId, $name, $nextPos, $now, $now)
                   """.update.run.void.transact(xa)
      yield StorageBox(id, userId, name, nextPos, Nil, now, now)

    def renameBox(id: String, name: String): Task[Unit] =
      sql"UPDATE storage_boxes SET name = $name, updated_at = NOW() WHERE id = $id"
        .update.run.void.transact(xa)

    def reorderBox(id: String, position: Int): Task[Unit] =
      sql"UPDATE storage_boxes SET position = $position, updated_at = NOW() WHERE id = $id"
        .update.run.void.transact(xa)

    def deleteBox(id: String): Task[Unit] =
      // ON DELETE CASCADE removes its drawers; each drawer's ON DELETE SET NULL
      // on collection_entries.drawer_id clears the assignment without touching the card.
      sql"DELETE FROM storage_boxes WHERE id = $id".update.run.void.transact(xa)

    def createDrawer(boxId: String, name: String): Task[StorageDrawer] =
      for
        nextPos <- sql"SELECT COALESCE(MAX(position) + 1, 0) FROM storage_drawers WHERE box_id = $boxId"
                     .query[Int].unique.transact(xa)
        id       = java.util.UUID.randomUUID().toString
        now      = Instant.now()
        _       <- sql"""
                     INSERT INTO storage_drawers (id, box_id, name, position, created_at, updated_at)
                     VALUES ($id, $boxId, $name, $nextPos, $now, $now)
                   """.update.run.void.transact(xa)
      yield StorageDrawer(id, boxId, name, nextPos, 0, now, now)

    def renameDrawer(id: String, name: String): Task[Unit] =
      sql"UPDATE storage_drawers SET name = $name, updated_at = NOW() WHERE id = $id"
        .update.run.void.transact(xa)

    def reorderDrawer(id: String, position: Int): Task[Unit] =
      sql"UPDATE storage_drawers SET position = $position, updated_at = NOW() WHERE id = $id"
        .update.run.void.transact(xa)

    def deleteDrawer(id: String): Task[Unit] =
      sql"DELETE FROM storage_drawers WHERE id = $id".update.run.void.transact(xa)

    /** Shared row -> OwnedCard mapping for findDrawerCards / findUnassignedCards.
     *  A Fragment (not a raw String spliced via "#$") — Fragment ++ concatenation
     *  is the pattern already proven working elsewhere in this file (see
     *  countOtherDrawerCardsInSameSets); "#$" raw-string splicing sends the
     *  literal text as a bind parameter instead of inlining it, breaking every
     *  query built on it. */
    private val ownedCardQuery: Fragment =
      Fragment.const(
        """
        SELECT
          ce.card_id, ce.conditions, ce.selected_cond, ce.updated_at, ce.drawer_id,
          c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
          c.image_small, c.image_large,
          p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
        LEFT JOIN card_prices p ON p.card_id = ce.card_id
        """
      )

    private def toOwnedCards(rows: List[
      (String, String, String, Instant, Option[String],
       String, String, String, String, Option[String], Option[String],
       String, String,
       Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])
    ]): List[OwnedCard] =
      rows.flatMap {
        case (cardId, condJson, selCond, updatedAt, drawerId,
              cId, setId, name, number, rarity, artist,
              imgSmall, imgLarge,
              nm, lp, mp, hp, dmg) =>
          condJson.fromJson[List[ConditionCount]].toOption.map { conditions =>
            val prices = if nm.orElse(lp).orElse(mp).orElse(hp).orElse(dmg).isDefined
                         then Some(CardPrices(nm, lp, mp, hp, dmg))
                         else None
            OwnedCard(
              cardId       = cardId,
              conditions   = conditions,
              selectedCond = selCond,
              updatedAt    = updatedAt,
              card         = Card(cId, setId, name, number, rarity, artist,
                                  CardImage(imgSmall, imgLarge), prices, None),
              drawerId     = drawerId
            )
          }
      }

    def findDrawerCards(drawerId: String): Task[List[OwnedCard]] =
      (ownedCardQuery ++ fr"WHERE ce.drawer_id = $drawerId ORDER BY ce.updated_at DESC")
        .query[(String, String, String, Instant, Option[String],
                String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])]
        .to[List]
        .map(toOwnedCards)
        .transact(xa)

    def findUnassignedCards(userId: String): Task[List[OwnedCard]] =
      (ownedCardQuery ++ fr"WHERE ce.user_id = $userId AND ce.drawer_id IS NULL ORDER BY ce.updated_at DESC")
        .query[(String, String, String, Instant, Option[String],
                String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])]
        .to[List]
        .map(toOwnedCards)
        .transact(xa)

    def assignCards(userId: String, cardIds: List[String], drawerId: String): Task[Int] =
      // One UPDATE per card, all in a single transaction — matches the
      // per-item-loop pattern CollectionRepository.bulkUpsert already uses
      // in this codebase, rather than introducing a new IN-clause helper.
      cardIds.traverse { cardId =>
        sql"""
          UPDATE collection_entries SET drawer_id = $drawerId
          WHERE user_id = $userId AND card_id = $cardId
        """.update.run
      }.map(_.sum).transact(xa)

    def countOtherDrawerCardsInSameSets(userId: String, cardIds: List[String], drawerId: String): Task[Int] =
      if cardIds.isEmpty then ZIO.succeed(0)
      else
        // OR-chain over the (already small — one bulk-assign call's worth of)
        // card ids, built with plain Fragment concatenation. Call this AFTER
        // assignCards: the just-assigned cards already carry drawer_id, so
        // the "!= drawerId" check below naturally excludes them without
        // needing to explicitly subtract them back out.
        val idMatch = cardIds.map(id => fr"c2.id = $id").reduce(_ ++ fr" OR " ++ _)
        (fr"""
          SELECT COUNT(*) FROM collection_entries ce
          JOIN cards c ON c.id = ce.card_id
          WHERE ce.user_id = $userId
            AND ce.drawer_id IS NOT NULL
            AND ce.drawer_id != $drawerId
            AND c.set_id IN (
              SELECT DISTINCT c2.set_id FROM cards c2 WHERE (""" ++ idMatch ++ fr"))")
          .query[Int].unique.transact(xa)

    def unassignCard(userId: String, cardId: String): Task[Unit] =
      sql"""
        UPDATE collection_entries SET drawer_id = NULL
        WHERE user_id = $userId AND card_id = $cardId
      """.update.run.void.transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, StorageRepository] =
    ZLayer.fromFunction(new Live(_))
