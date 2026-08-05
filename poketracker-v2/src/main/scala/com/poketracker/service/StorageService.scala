/**
 * FILE: StorageService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/StorageService.scala
 *
 * PURPOSE:
 *   Business logic for physical storage — boxes, drawers, and assigning
 *   owned cards to them.
 *
 * USED BY: StorageRoutes
 * DEPENDS ON: StorageRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.StorageRepository
import zio.*

trait StorageService:

  def getBoxes(userId: String): Task[List[StorageBox]]
  def createBox(userId: String, name: String): Task[StorageBox]
  def renameBox(id: String, name: String): Task[Unit]
  def reorderBox(id: String, position: Int): Task[Unit]
  def deleteBox(id: String): Task[Unit]

  def createDrawer(boxId: String, name: String): Task[StorageDrawer]
  def renameDrawer(id: String, name: String): Task[Unit]
  def reorderDrawer(id: String, position: Int): Task[Unit]
  def deleteDrawer(id: String): Task[Unit]

  def getDrawerCards(drawerId: String): Task[List[OwnedCard]]
  def getUnassignedCards(userId: String): Task[List[OwnedCard]]

  /**
   * Assigns cards to a drawer, then checks whether any OTHER owned card
   * sharing a set with what was just assigned already lives in a
   * different drawer — surfaced as an informational warning, never a
   * block, since splitting a set across boxes is a real thing users do.
   */
  def assignCards(userId: String, cardIds: List[String], drawerId: String): Task[AssignResult]

  def unassignCard(userId: String, cardId: String): Task[Unit]

object StorageService:

  private def buildOverlapWarning(overlap: Int): Option[String] =
    if overlap == 0 then None
    else
      val plural = if overlap == 1 then "" else "s"
      val verb   = if overlap == 1 then "is" else "are"
      Some(s"$overlap other card$plural from the same set(s) $verb already in a different drawer.")

  final class Live(repo: StorageRepository) extends StorageService:

    def getBoxes(userId: String): Task[List[StorageBox]] = repo.findBoxesByUser(userId)
    def createBox(userId: String, name: String): Task[StorageBox] =
      ZIO.when(name.trim.isEmpty)(ZIO.fail(new IllegalArgumentException("Box name cannot be empty")))
        *> repo.createBox(userId, name.trim)
    def renameBox(id: String, name: String): Task[Unit] =
      ZIO.when(name.trim.isEmpty)(ZIO.fail(new IllegalArgumentException("Box name cannot be empty")))
        *> repo.renameBox(id, name.trim)
    def reorderBox(id: String, position: Int): Task[Unit] = repo.reorderBox(id, position)
    def deleteBox(id: String): Task[Unit] = repo.deleteBox(id)

    def createDrawer(boxId: String, name: String): Task[StorageDrawer] =
      ZIO.when(name.trim.isEmpty)(ZIO.fail(new IllegalArgumentException("Drawer name cannot be empty")))
        *> repo.createDrawer(boxId, name.trim)
    def renameDrawer(id: String, name: String): Task[Unit] =
      ZIO.when(name.trim.isEmpty)(ZIO.fail(new IllegalArgumentException("Drawer name cannot be empty")))
        *> repo.renameDrawer(id, name.trim)
    def reorderDrawer(id: String, position: Int): Task[Unit] = repo.reorderDrawer(id, position)
    def deleteDrawer(id: String): Task[Unit] = repo.deleteDrawer(id)

    def getDrawerCards(drawerId: String): Task[List[OwnedCard]] = repo.findDrawerCards(drawerId)
    def getUnassignedCards(userId: String): Task[List[OwnedCard]] = repo.findUnassignedCards(userId)

    def assignCards(userId: String, cardIds: List[String], drawerId: String): Task[AssignResult] =
      for
        assigned <- repo.assignCards(userId, cardIds, drawerId)
        overlap  <- repo.countOtherDrawerCardsInSameSets(userId, cardIds, drawerId)
        warning   = buildOverlapWarning(overlap)
      yield AssignResult(assigned, warning)

    def unassignCard(userId: String, cardId: String): Task[Unit] = repo.unassignCard(userId, cardId)

  val layer: ZLayer[StorageRepository, Nothing, StorageService] =
    ZLayer.fromFunction(new Live(_))
