/**
 * FILE: BinderRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/BinderRepository.scala
 *
 * PURPOSE:
 *   Handles all database operations for binders and their card slots.
 *   Binders and slots are stored in two separate tables (binders and binder_slots)
 *   and this repository joins them together when fetching.
 *
 * USED BY: BinderService
 * DEPENDS ON: Doobie, ZIO, Binder model
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
import java.time.Instant

/**
 * TRAIT: BinderRepository
 * PURPOSE: Interface for all binder data access operations.
 */
trait BinderRepository:

  /**
   * METHOD: findByUser
   * PURPOSE: Fetches all binders owned by a user, without their slots.
   *          Used for the binder shelf view — we show binder covers
   *          without loading all card data for every binder.
   * @param userId  The user whose binders to fetch
   * @return        List of binders, newest first, without slot data
   */
  def findByUser(userId: String): Task[List[Binder]]

  /**
   * METHOD: findById
   * PURPOSE: Fetches a single binder with all its slots.
   *          Used when opening a binder to view its pages.
   * @param id  The binder's UUID
   * @return    Some(binder) with all slots, None if not found
   */
  def findById(id: String): Task[Option[Binder]]

  /**
   * METHOD: create
   * PURPOSE: Creates a new empty binder.
   * @param binder  The binder to create (slots list will be empty)
   * @return        Unit
   */
  def create(binder: Binder): Task[Unit]

  /**
   * METHOD: updateSlot
   * PURPOSE: Places or removes a card from a specific slot.
   *          If cardId is Some, places the card. If None, empties the slot.
   * @param binderId   Which binder
   * @param slotIndex  Which position in the binder (0-based)
   * @param cardId     The card to place, or None to empty the slot
   * @param cardName   Cached card name for display
   * @param imageUrl   Cached card image URL for display
   * @return           Unit
   */
  def updateSlot(
    binderId:  String,
    slotIndex: Int,
    cardId:    Option[String],
    cardName:  Option[String],
    imageUrl:  Option[String]
  ): Task[Unit]

  /**
   * METHOD: updateName
   * PURPOSE: Renames a binder.
   * @param id    The binder to rename
   * @param name  The new name
   * @return      Unit
   */
  def updateName(id: String, name: String): Task[Unit]

  /**
   * METHOD: updateCover
   * PURPOSE: Sets the cover image for a binder.
   * @param id        The binder to update
   * @param imageUrl  URL to use as the cover image
   * @return          Unit
   */
  def updateCover(id: String, imageUrl: String): Task[Unit]

  /**
   * METHOD: updatePocketSize
   * PURPOSE: Changes how many card pockets each binder page holds.
   *          Slots keep their indexes — cards re-flow across pages in the
   *          UI because a page simply shows a different range of indexes.
   * @param id          The binder to update
   * @param pocketSize  The new size (Four, Nine, or Twelve)
   * @return            Unit
   */
  def updatePocketSize(id: String, pocketSize: PocketSize): Task[Unit]

  /**
   * METHOD: delete
   * PURPOSE: Deletes a binder and all its slots.
   *          The ON DELETE CASCADE in the schema handles deleting slots automatically.
   * @param id  The binder to delete
   * @return    Unit
   */
  def delete(id: String): Task[Unit]

object BinderRepository:

  final class Live(xa: Transactor[Task]) extends BinderRepository:

    def findByUser(userId: String): Task[List[Binder]] =
      sql"""
        SELECT id, user_id, name, pocket_size, cover_image, created_at, updated_at
        FROM binders
        WHERE user_id = $userId
        ORDER BY updated_at DESC
      """
        .query[(String, String, String, String, Option[String], Instant, Instant)]
        .to[List]
        .map(_.map { case (id, uid, name, size, cover, createdAt, updatedAt) =>
          // Create binder with empty slots — slots are loaded separately when needed
          Binder(id, uid, name, PocketSize.valueOf(size), cover, Nil, createdAt, updatedAt)
        })
        .transact(xa)

    def findById(id: String): Task[Option[Binder]] =
      // Two queries: one for the binder, one for its slots.
      // We run both in the same transaction for consistency —
      // the slot data will match the binder data as of the same moment.
      val binderQuery =
        sql"""
          SELECT id, user_id, name, pocket_size, cover_image, created_at, updated_at
          FROM binders WHERE id = $id
        """
          .query[(String, String, String, String, Option[String], Instant, Instant)]
          .option

      val slotsQuery =
        sql"""
          SELECT slot_index, card_id, card_name, image_url
          FROM binder_slots
          WHERE binder_id = $id
          ORDER BY slot_index
        """
          .query[(Int, Option[String], Option[String], Option[String])]
          .to[List]

      // Run both queries in the same transaction then combine the results.
      // For comprehension in Doobie's ConnectionIO context.
      (for
        binderOpt <- binderQuery
        slots     <- slotsQuery
      yield binderOpt.map { case (bid, uid, name, size, cover, createdAt, updatedAt) =>
        val binderSlots = slots.map { case (idx, cardId, cardName, imgUrl) =>
          BinderSlot(idx, cardId, cardName, imgUrl)
        }
        Binder(bid, uid, name, PocketSize.valueOf(size), cover, binderSlots, createdAt, updatedAt)
      }).transact(xa)

    def create(binder: Binder): Task[Unit] =
      sql"""
        INSERT INTO binders (id, user_id, name, pocket_size, cover_image, created_at, updated_at)
        VALUES (${binder.id}, ${binder.userId}, ${binder.name},
                ${binder.pocketSize.toString}, ${binder.coverImage},
                ${binder.createdAt}, ${binder.updatedAt})
      """
        .update.run.void.transact(xa)

    def updateSlot(
      binderId:  String,
      slotIndex: Int,
      cardId:    Option[String],
      cardName:  Option[String],
      imageUrl:  Option[String]
    ): Task[Unit] =
      sql"""
        INSERT INTO binder_slots (binder_id, slot_index, card_id, card_name, image_url)
        VALUES ($binderId, $slotIndex, $cardId, $cardName, $imageUrl)
        ON CONFLICT (binder_id, slot_index) DO UPDATE SET
          card_id   = EXCLUDED.card_id,
          card_name = EXCLUDED.card_name,
          image_url = EXCLUDED.image_url
      """
        .update.run.void
        // Also update the binder's updated_at timestamp so the shelf shows the right order
        .flatMap { _ =>
          sql"UPDATE binders SET updated_at = NOW() WHERE id = $binderId"
            .update.run.void
        }
        .transact(xa)

    def updateName(id: String, name: String): Task[Unit] =
      sql"""
        UPDATE binders SET name = $name, updated_at = NOW() WHERE id = $id
      """
        .update.run.void.transact(xa)

    def updateCover(id: String, imageUrl: String): Task[Unit] =
      sql"""
        UPDATE binders SET cover_image = $imageUrl, updated_at = NOW() WHERE id = $id
      """
        .update.run.void.transact(xa)

    def updatePocketSize(id: String, pocketSize: PocketSize): Task[Unit] =
      // pocket_size is stored as the enum's name ("Four" | "Nine" | "Twelve"),
      // same encoding the INSERT in create() uses.
      sql"""
        UPDATE binders SET pocket_size = ${pocketSize.toString}, updated_at = NOW() WHERE id = $id
      """
        .update.run.void.transact(xa)

    def delete(id: String): Task[Unit] =
      // ON DELETE CASCADE in schema.sql automatically deletes all binder_slots rows
      sql"DELETE FROM binders WHERE id = $id"
        .update.run.void.transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, BinderRepository] =
    ZLayer.fromFunction(new Live(_))
