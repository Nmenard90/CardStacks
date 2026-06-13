/**
 * FILE: BinderService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/BinderService.scala
 *
 * PURPOSE:
 *   Business logic for managing card binders.
 *   Handles creating binders, placing and removing cards from slots,
 *   and validating that slot operations are within bounds.
 *
 * USED BY: BinderRoutes
 * DEPENDS ON: BinderRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.BinderRepository
import zio.*
import java.time.Instant
import java.util.UUID

/**
 * TRAIT: BinderService
 * PURPOSE: Interface for all binder business logic.
 */
trait BinderService:

  /**
   * METHOD: getBinders
   * PURPOSE: Returns all binders for a user without slot data.
   *          Used for the shelf view — we show covers without loading all cards.
   * @param userId  The user
   * @return        List of binders, newest first
   */
  def getBinders(userId: String): Task[List[Binder]]

  /**
   * METHOD: getBinder
   * PURPOSE: Returns a single binder with all its slots.
   *          Used when opening a binder to view and edit pages.
   * @param id  The binder UUID
   * @return    Some(binder) with all slots, None if not found
   */
  def getBinder(id: String): Task[Option[Binder]]

  /**
   * METHOD: createBinder
   * PURPOSE: Creates a new empty binder for a user.
   * @param userId      Who owns this binder
   * @param name        Display name e.g. "My Charizards"
   * @param pocketSize  How many cards per page
   * @return            The newly created Binder
   */
  def createBinder(
    userId:     String,
    name:       String,
    pocketSize: PocketSize
  ): Task[Binder]

  /**
   * METHOD: placeCard
   * PURPOSE: Places a card in a specific slot of a binder.
   *          If the slot already has a card, it is replaced.
   * @param binderId   The binder to place the card in
   * @param slotIndex  Which slot (0-based, counts across all pages)
   * @param card       The card to place
   * @return           Unit, or fails if slot index is out of range
   */
  def placeCard(binderId: String, slotIndex: Int, card: Card): Task[Unit]

  /**
   * METHOD: removeCard
   * PURPOSE: Removes a card from a slot, leaving it empty.
   * @param binderId   The binder
   * @param slotIndex  Which slot to clear
   * @return           Unit
   */
  def removeCard(binderId: String, slotIndex: Int): Task[Unit]

  /**
   * METHOD: renameBinder
   * PURPOSE: Changes a binder's display name.
   * @param id    The binder to rename
   * @param name  The new name
   * @return      Unit
   */
  def renameBinder(id: String, name: String): Task[Unit]

  /**
   * METHOD: setCover
   * PURPOSE: Sets a binder's cover image.
   * @param id        The binder
   * @param imageUrl  URL to use as cover (usually a card image the user owns)
   * @return          Unit
   */
  def setCover(id: String, imageUrl: String): Task[Unit]

  /**
   * METHOD: resizeBinder
   * PURPOSE: Changes a binder's pocket size after creation.
   *          Placed cards are not touched — their slot indexes stay the
   *          same and the pages simply re-flow at the new pockets-per-page.
   * @param id          The binder to resize
   * @param pocketSize  The new size (Four, Nine, or Twelve)
   * @return            Unit
   */
  def resizeBinder(id: String, pocketSize: PocketSize): Task[Unit]

  /**
   * METHOD: deleteBinder
   * PURPOSE: Permanently deletes a binder and all its slots.
   * @param id  The binder to delete
   * @return    Unit
   */
  def deleteBinder(id: String): Task[Unit]

object BinderService:

  // Maximum slots allowed per binder.
  // A 9-pocket binder with 100 pages = 900 slots.
  // This prevents accidental creation of enormous binders.
  private val MaxSlots = 2000

  final class Live(repo: BinderRepository) extends BinderService:

    def getBinders(userId: String): Task[List[Binder]] =
      repo.findByUser(userId)

    def getBinder(id: String): Task[Option[Binder]] =
      repo.findById(id)

    def createBinder(userId: String, name: String, pocketSize: PocketSize): Task[Binder] =
      val binder = Binder(
        id         = UUID.randomUUID().toString,
        userId     = userId,
        name       = name.trim,
        pocketSize = pocketSize,
        coverImage = None,
        slots      = Nil,        // New binders start empty
        createdAt  = Instant.now(),
        updatedAt  = Instant.now()
      )
      repo.create(binder).as(binder)

    def placeCard(binderId: String, slotIndex: Int, card: Card): Task[Unit] =
      // Validate slot index is within allowed range
      ZIO.when(slotIndex < 0 || slotIndex >= MaxSlots)(
        ZIO.fail(new IllegalArgumentException(
          s"Slot index $slotIndex is out of range. Must be between 0 and ${MaxSlots - 1}."
        ))
      ) *> repo.updateSlot(
        binderId  = binderId,
        slotIndex = slotIndex,
        cardId    = Some(card.id),
        cardName  = Some(card.name),
        imageUrl  = Some(card.images.small)
      )

    def removeCard(binderId: String, slotIndex: Int): Task[Unit] =
      repo.updateSlot(
        binderId  = binderId,
        slotIndex = slotIndex,
        cardId    = None,
        cardName  = None,
        imageUrl  = None
      )

    def renameBinder(id: String, name: String): Task[Unit] =
      ZIO.when(name.trim.isEmpty)(
        ZIO.fail(new IllegalArgumentException("Binder name cannot be empty"))
      ) *> repo.updateName(id, name.trim)

    def setCover(id: String, imageUrl: String): Task[Unit] =
      repo.updateCover(id, imageUrl)

    def resizeBinder(id: String, pocketSize: PocketSize): Task[Unit] =
      repo.updatePocketSize(id, pocketSize)

    def deleteBinder(id: String): Task[Unit] =
      repo.delete(id)

  val layer: ZLayer[BinderRepository, Nothing, BinderService] =
    ZLayer.fromFunction(new Live(_))
