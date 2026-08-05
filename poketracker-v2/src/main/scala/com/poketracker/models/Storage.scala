/**
 * FILE: Storage.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/Storage.scala
 *
 * PURPOSE:
 *   Represents a user's physical card-storage hierarchy — stackable boxes,
 *   each with drawers, each drawer holding some of the user's owned cards.
 *   Mirrors the real-world object (e.g. 4 boxes stacked, 3 drawers per box)
 *   rather than imposing a fixed schema, since every user's actual storage
 *   product is different.
 *
 * USED BY: StorageRepository, StorageService, StorageRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * CASE CLASS: StorageDrawer
 *
 * PURPOSE:
 *   One drawer within a box. Holds however many cards the user has
 *   assigned to it — no fixed capacity, since real drawers vary.
 *
 * @param id         UUID primary key.
 * @param boxId      Which box this drawer belongs to.
 * @param name       User-chosen or default name, e.g. "Drawer 1".
 * @param position   Order within the box (top to bottom / left to right).
 * @param cardCount  How many owned cards are currently assigned here.
 *                   Computed via COUNT(*) at read time — never stored, so
 *                   it can never drift out of sync with the actual data.
 * @param createdAt  When this drawer was created.
 * @param updatedAt  When this drawer was last modified.
 */
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

/**
 * CASE CLASS: StorageBox
 *
 * PURPOSE:
 *   A named physical box a user owns, containing an ordered list of
 *   drawers. Boxes are ordered by `position` so the UI can render them
 *   stacked the way the user actually stacks the real ones.
 *
 * @param id         UUID primary key.
 * @param userId     The user who owns this box.
 * @param name       User-chosen name, e.g. "Box 1".
 * @param position   Display/stack order.
 * @param drawers    This box's drawers, ordered by their own position.
 * @param createdAt  When this box was created.
 * @param updatedAt  When this box was last modified.
 */
final case class StorageBox(
  id:        String,
  userId:    String,
  name:      String,
  position:  Int,
  drawers:   List[StorageDrawer],
  createdAt: Instant,
  updatedAt: Instant
)

object StorageBox:
  given JsonCodec[StorageBox] = DeriveJsonCodec.gen[StorageBox]

/**
 * CASE CLASS: AssignResult
 *
 * PURPOSE:
 *   Result of assigning one or more cards to a drawer.
 *
 * @param assigned  How many cards were assigned.
 * @param warning   Set when some of the assigned cards' sets already have
 *                  OTHER owned cards assigned to a different drawer —
 *                  informational only, the assignment still happens. Never
 *                  a hard block: splitting a set across boxes is a real,
 *                  legitimate thing users do.
 */
final case class AssignResult(assigned: Int, warning: Option[String])

object AssignResult:
  given JsonCodec[AssignResult] = DeriveJsonCodec.gen[AssignResult]
