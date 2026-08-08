/**
 * A user's physical card storage — stackable boxes, each with drawers.
 * Mirrors the real object instead of forcing one fixed layout, since
 * everyone's actual storage setup is different.
 *
 * USED BY: StorageRepository, StorageService, StorageRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/** @param cardCount  Computed fresh on read, never stored — can't go stale. */
final case class StorageDrawer(
  id:        String,
  boxId:     String,
  name:      String,
  position:  Int,
  cardCount: Int,
  createdAt: Instant,
  updatedAt: Instant
)

object StorageDrawer:
  given JsonCodec[StorageDrawer] = DeriveJsonCodec.gen[StorageDrawer]

/** @param kind  "box" (default) or "display_case" — a display case is a box
 *               with exactly one drawer, whose shelf tile shows the cards
 *               inside directly instead of a crate face. */
final case class StorageBox(
  id:        String,
  userId:    String,
  name:      String,
  kind:      String,
  boxType:   String,
  capacity:  Int,
  color:     String,
  position:  Int,
  spaceId:   Option[String],
  storageUnitId: Option[String],
  shelfIndex: Option[Int],
  stackIndex: Option[Int],
  stackLevel: Option[Int],
  drawers:   List[StorageDrawer],
  createdAt: Instant,
  updatedAt: Instant
)

object StorageBox:
  given JsonCodec[StorageBox] = DeriveJsonCodec.gen[StorageBox]

/**
 * @param warning  Set (but never blocking) if some of the assigned cards'
 *                 sets already have other owned cards in a different
 *                 drawer — splitting a set across boxes is legitimate.
 */
final case class AssignResult(
  assigned: Int,
  warning:  Option[String]
)

object AssignResult:
  given JsonCodec[AssignResult] = DeriveJsonCodec.gen[AssignResult]
