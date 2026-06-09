/**
 * FILE: Binder.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/Binder.scala
 *
 * PURPOSE:
 *   Represents a physical card binder that a user has created to organize
 *   their collection. Each binder has pages, each page has slots, each slot
 *   holds one card.
 *
 * IMPORTS:
 *   zio.json.* — JSON conversion
 *   java.time.Instant — UTC timestamps
 *
 * USED BY: BinderRepository, BinderService, BinderRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * ENUM: PocketSize
 *
 * PURPOSE:
 *   How many card slots are on each page of the binder.
 *   Using an enum prevents invalid values — you cannot set pocket size to 7.
 *
 *   Four  — 4 cards per page (2×2 grid) — good for showcasing valuable cards
 *   Nine  — 9 cards per page (3×3 grid) — most common binder format
 *   Twelve — 12 cards per page (4×3 grid) — maximum density
 */
enum PocketSize:
  case Four, Nine, Twelve

object PocketSize:
  /**
   * METHOD: toInt
   * PURPOSE: Returns the actual number of slots per page for layout calculations.
   */
  extension (ps: PocketSize)
    def toInt: Int = ps match
      case Four   => 4
      case Nine   => 9
      case Twelve => 12

  given JsonCodec[PocketSize] = JsonCodec.string.transform(
    s => PocketSize.valueOf(s),
    p => p.toString
  )

/**
 * CASE CLASS: BinderSlot
 *
 * PURPOSE:
 *   One slot in a binder page. Either occupied by a card or empty.
 *
 * @param slotIndex  Position within the binder (0-based, counts across all pages).
 *                   Slot 0 = first slot on page 1, slot 9 = first slot on page 2
 *                   (for a 9-pocket binder).
 * @param cardId     Which card is in this slot. None means the slot is empty.
 * @param cardName   Cached card name for display without a database lookup.
 * @param imageUrl   Cached card image URL for display without a database lookup.
 */
final case class BinderSlot(
  slotIndex: Int,
  cardId:    Option[String],
  cardName:  Option[String],
  imageUrl:  Option[String]
):
  /** Whether this slot has a card in it. */
  def isEmpty: Boolean = cardId.isEmpty

object BinderSlot:
  given JsonCodec[BinderSlot] = DeriveJsonCodec.gen[BinderSlot]

  /**
   * FUNCTION: empty
   * PURPOSE: Creates an empty slot at the given index. Used when building
   *          a new binder page — all slots start empty.
   * @param index  The slot's position in the binder
   * @return       An empty BinderSlot at that index
   */
  def empty(index: Int): BinderSlot =
    BinderSlot(slotIndex = index, cardId = None, cardName = None, imageUrl = None)

/**
 * CASE CLASS: Binder
 *
 * PURPOSE:
 *   A named collection of card slots organized into pages.
 *   Users create binders to organize cards however they like —
 *   by set, by type, by value, etc.
 *
 * @param id          UUID primary key.
 * @param userId      The user who owns this binder. Foreign key → users.id
 * @param name        User-chosen name. e.g. "My Charizards", "Base Set Complete"
 * @param pocketSize  How many cards fit on each page.
 * @param coverImage  Optional URL to an image used as the binder cover.
 *                    Users can set any card image as their cover.
 * @param slots       All slots in the binder, across all pages.
 *                    Ordered by slotIndex.
 * @param createdAt   When this binder was created.
 * @param updatedAt   When this binder was last modified.
 */
final case class Binder(
  id:          String,
  userId:      String,
  name:        String,
  pocketSize:  PocketSize,
  coverImage:  Option[String],
  slots:       List[BinderSlot],
  createdAt:   Instant,
  updatedAt:   Instant
):
  /**
   * METHOD: totalPages
   * PURPOSE: How many pages this binder has based on number of slots.
   * @return Number of pages, always at least 1.
   */
  def totalPages: Int =
    if slots.isEmpty then 1
    else Math.ceil(slots.size.toDouble / pocketSize.toInt).toInt

  /**
   * METHOD: slotsForPage
   * PURPOSE: Returns the slots that appear on a specific page.
   *          Used by the frontend to render one page of the binder at a time.
   * @param pageNumber  1-based page number (first page = 1)
   * @return            The slots on that page, in order
   */
  def slotsForPage(pageNumber: Int): List[BinderSlot] =
    val perPage = pocketSize.toInt
    val start   = (pageNumber - 1) * perPage
    slots.slice(start, start + perPage)

object Binder:
  given JsonCodec[Binder] = DeriveJsonCodec.gen[Binder]
