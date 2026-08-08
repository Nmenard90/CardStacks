/**
 * A physical-binder organizer: pages made of slots, each slot holding one card.
 *
 * USED BY: BinderRepository, BinderService, BinderRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

enum PocketSize:
  case Four, Nine, Twelve

object PocketSize:
  extension (ps: PocketSize)
    def toInt: Int = ps match
      case Four   => 4
      case Nine   => 9
      case Twelve => 12

  given JsonCodec[PocketSize] = JsonCodec.string.transform(
    s => PocketSize.valueOf(s),
    p => p.toString
  )

/** @param cardName/imageUrl  Cached so displaying a slot never needs a card lookup. */
final case class BinderSlot(
  slotIndex: Int,
  cardId:    Option[String],
  cardName:  Option[String],
  imageUrl:  Option[String]
):

  def isEmpty: Boolean = cardId.isEmpty

object BinderSlot:
  given JsonCodec[BinderSlot] = DeriveJsonCodec.gen[BinderSlot]

  def empty(index: Int): BinderSlot =
    BinderSlot(slotIndex = index, cardId = None, cardName = None, imageUrl = None)

/**
 * Pages aren't stored separately — `slots` is one flat, ordered list
 * across the whole binder, and totalPages/slotsForPage below work out
 * which slots belong to which page.
 */
final case class Binder(
  id:          String,
  userId:      String,
  name:        String,
  pocketSize:  PocketSize,
  coverImage:  Option[String],
  spaceId:     Option[String],
  storageUnitId: Option[String],
  shelfIndex:  Option[Int],
  shelfPosition: Option[Int],
  slots:       List[BinderSlot],
  createdAt:   Instant,
  updatedAt:   Instant
):

  /** Rounds up — a partly-filled page still counts as a whole page. */
  def totalPages: Int =
    if slots.isEmpty then 1
    else Math.ceil(slots.size.toDouble / pocketSize.toInt).toInt

  def slotsForPage(pageNumber: Int): List[BinderSlot] =
    val perPage = pocketSize.toInt
    val start = (pageNumber - 1) * perPage
    slots.slice(start, start + perPage)

object Binder:
  given JsonCodec[Binder] = DeriveJsonCodec.gen[Binder]
