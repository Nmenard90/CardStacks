/**
 * The unified shelf — one ordering across two otherwise-unrelated features
 * (storage boxes and binders), so a user can drag either kind into any
 * position on the same cabinet. Deliberately doesn't merge the two features'
 * own tables; a ShelfItem just points at one by (kind, refId).
 *
 * USED BY: ShelfRepository, ShelfService, ShelfRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/** One row of shelf ordering. Also doubles as the reorder request's wire shape. */
final case class ShelfItem(
  kind:     String,
  refId:    String,
  position: Int
)

object ShelfItem:
  given JsonCodec[ShelfItem] = DeriveJsonCodec.gen[ShelfItem]

/**
 * One shelf tile as returned to the client — `box` or `binder` is set
 * depending on `kind`, never both. Kept as two Option fields (rather than a
 * sealed trait) to match how the rest of this codebase's JSON models favor
 * flat case classes over ADTs with discriminators (see BinderSlot).
 */
final case class ShelfEntry(
  kind:     String,
  position: Int,
  box:      Option[StorageBox]    = None,
  binder:   Option[BinderSummary] = None
)

object ShelfEntry:
  given JsonCodec[ShelfEntry] = DeriveJsonCodec.gen[ShelfEntry]

/** A binder's cover info only, no slots — the shelf tile doesn't need them. */
final case class BinderSummary(
  id:         String,
  userId:     String,
  name:       String,
  pocketSize: PocketSize,
  coverImage: Option[String],
  createdAt:  Instant,
  updatedAt:  Instant
)

object BinderSummary:
  given JsonCodec[BinderSummary] = DeriveJsonCodec.gen[BinderSummary]

  def from(b: Binder): BinderSummary =
    BinderSummary(b.id, b.userId, b.name, b.pocketSize, b.coverImage, b.createdAt, b.updatedAt)
