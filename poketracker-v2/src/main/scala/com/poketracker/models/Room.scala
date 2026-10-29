package com.poketracker.models

import zio.json.*
import java.time.Instant

final case class StorageUnit(
  id: String, spaceId: String, name: String, unitType: String, preset: String,
  color: String, shelfCount: Int, positionsPerShelf: Int, maxStackHeight: Int,
  position: Int, config: String, createdAt: Instant, updatedAt: Instant
)
object StorageUnit:
  given JsonCodec[StorageUnit] = DeriveJsonCodec.gen[StorageUnit]

final case class DisplaySlot(
  id: String, displayCaseId: String, shelfIndex: Int, slotIndex: Int, label: Option[String]
)
object DisplaySlot:
  given JsonCodec[DisplaySlot] = DeriveJsonCodec.gen[DisplaySlot]

final case class DisplayCase(
  id: String, spaceId: String, name: String, caseType: String, preset: String,
  frameColor: String, lightColor: String, lightEnabled: Boolean, shelfCount: Int,
  slotsPerShelf: Int, position: Int, config: String, slots: List[DisplaySlot],
  createdAt: Instant, updatedAt: Instant
)
object DisplayCase:
  given JsonCodec[DisplayCase] = DeriveJsonCodec.gen[DisplayCase]

final case class CollectionSpace(
  id: String, userId: String, name: String, spaceType: String, isDefault: Boolean,
  position: Int, storageUnits: List[StorageUnit], displayCases: List[DisplayCase],
  createdAt: Instant, updatedAt: Instant
)
object CollectionSpace:
  given JsonCodec[CollectionSpace] = DeriveJsonCodec.gen[CollectionSpace]

final case class InventoryLot(
  id: String, userId: String, cardId: String, variantKey: String, edition: String,
  language: String, condition: String, quantity: Int, allocated: Int,
  createdAt: Instant, updatedAt: Instant
)
object InventoryLot:
  given JsonCodec[InventoryLot] = DeriveJsonCodec.gen[InventoryLot]

/** Where copies of a card are kept, answering "where is this card?" (My Shop's requests).
 *  kind: "box" (container = box, part = compartment), "binder" (slotIndex + pocketSize give the page and pocket)
 *  or "display" (container = display case). condition is unknown for a binder pocket filled without a stored copy. */
final case class CardLocation(
  cardId: String, kind: String, container: String, part: Option[String], condition: Option[String],
  quantity: Int, slotIndex: Option[Int], pocketSize: Option[String]
)
object CardLocation:
  given JsonCodec[CardLocation] = DeriveJsonCodec.gen[CardLocation]

final case class CardAllocation(
  id: String, lotId: String, drawerId: Option[String], binderSlotId: Option[String],
  displaySlotId: Option[String], quantity: Int, protection: Option[String],
  notes: Option[String], createdAt: Instant, updatedAt: Instant
)
object CardAllocation:
  given JsonCodec[CardAllocation] = DeriveJsonCodec.gen[CardAllocation]
