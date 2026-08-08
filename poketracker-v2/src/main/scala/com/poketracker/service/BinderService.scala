/**
 * BinderService — creating binders, placing/removing cards from slots,
 * bounds-checking slot operations.
 *
 * HOW IT WORKS
 *   Thin rules layer over BinderRepository: validates slot index range,
 *   rejects blank names, and builds new Binder objects client-side so a
 *   create doesn't need a round-trip read to know what it just saved.
 *   createBinder/deleteBinder also keep ShelfRepository's ordering table
 *   in sync.
 *
 * USED BY: BinderRoutes
 * DEPENDS ON: BinderRepository, ShelfRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.{BinderRepository, ShelfRepository}
import zio.*
import java.time.Instant
import java.util.UUID

trait BinderService:

  /** Without slot data — the shelf view only needs covers. */
  def getBinders(userId: String): Task[List[Binder]]

  /** With every slot, for opening a binder to view/edit pages. */
  def getBinder(id: String): Task[Option[Binder]]

  def createBinder(
    userId:     String,
    name:       String,
    pocketSize: PocketSize
  ): Task[Binder]

  /** Replaces whatever was already in the slot, if anything. */
  def placeCard(binderId: String, slotIndex: Int, card: Card): Task[Unit]

  def removeCard(binderId: String, slotIndex: Int): Task[Unit]

  def renameBinder(id: String, name: String): Task[Unit]

  def setCover(id: String, imageUrl: String): Task[Unit]

  /** Placed cards keep their slot index — pages just re-flow at the new pocket count. */
  def resizeBinder(id: String, pocketSize: PocketSize): Task[Unit]

  def deleteBinder(id: String): Task[Unit]

object BinderService:

  // Sanity cap, not a real limit — a 9-pocket binder with 100 pages is 900 slots.
  private val MaxSlots = 2000

  final class Live(repo: BinderRepository, shelf: ShelfRepository) extends BinderService:

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
        spaceId = None,
        storageUnitId = None,
        shelfIndex = None,
        shelfPosition = None,
        slots      = Nil,
        createdAt  = Instant.now(),
        updatedAt  = Instant.now()
      )
      repo.create(binder) *> shelf.ensureExists(userId, "binder", binder.id) *> ZIO.succeed(binder)

    def placeCard(binderId: String, slotIndex: Int, card: Card): Task[Unit] =
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
      repo.delete(id) *> shelf.remove("binder", id)

  val layer: ZLayer[BinderRepository & ShelfRepository, Nothing, BinderService] =
    ZLayer.fromFunction(new Live(_, _))
