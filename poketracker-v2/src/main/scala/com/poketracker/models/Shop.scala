package com.poketracker.models

import zio.json.*
import java.time.Instant

/** A user's shop switch: private by default, public at /shop/<slug> once enabled. */
final case class ShopSettings(
  slug:         String,
  enabled:      Boolean,
  messengerUrl: String,
  displayName:  String = "",
  bio:          String = ""
)

object ShopSettings:
  given JsonCodec[ShopSettings] = DeriveJsonCodec.gen[ShopSettings]

/** Which photo exists (never the picture itself). `version` changes whenever it is replaced, so the page can cache images forever. */
final case class ShopPhotoRef(
  cardId:    String,
  condition: String,
  side:      String,
  version:   Long
)

object ShopPhotoRef:
  given JsonEncoder[ShopPhotoRef] = DeriveJsonEncoder.gen[ShopPhotoRef]

/** What the public page gets back: the link button, the cards, and which photos exist. */
final case class ShopView(
  messengerUrl: String,
  cards:        List[OwnedCard],
  photos:       List[ShopPhotoRef],
  displayName:  String = "",
  bio:          String = ""
)

object ShopView:
  given JsonEncoder[ShopView] = DeriveJsonEncoder.gen[ShopView]

/** One card a buyer picked on the public shop page. The seller's pull list adds the last two (stored in the
 *  request's items JSON, so no migration): `pulled` once they've found the card, and `askedCondition`, what the
 *  buyer picked, once the seller changed `condition` to the copy's real one. Both absent on a new request. */
final case class ShopRequestItem(
  cardId:         String,
  name:           String,
  number:         String,
  condition:      String,
  qty:            Int,
  pulled:         Option[Boolean] = None,
  askedCondition: Option[String]  = None
)

object ShopRequestItem:
  given JsonCodec[ShopRequestItem] = DeriveJsonCodec.gen[ShopRequestItem]

/** What the public page POSTs. No account needed, so every field is untrusted. */
final case class ShopRequestInput(
  buyerName:    String,
  buyerContact: String,
  message:      String,
  items:        List[ShopRequestItem]
)

/** The seller's change to one card on their pull list: found or not, and/or its real condition. */
final case class ShopRequestItemChange(pulled: Option[Boolean] = None, condition: Option[String] = None)

object ShopRequestItemChange:
  given JsonDecoder[ShopRequestItemChange] = DeriveJsonDecoder.gen[ShopRequestItemChange]

object ShopRequestInput:
  given JsonDecoder[ShopRequestInput] = DeriveJsonDecoder.gen[ShopRequestInput]

/** A stored request, as the seller sees it in their inbox. */
final case class ShopRequest(
  id:           String,
  buyerName:    String,
  buyerContact: String,
  message:      String,
  kind:         String,
  items:        List[ShopRequestItem],
  status:       String,
  createdAt:    Instant
)

object ShopRequest:
  given JsonEncoder[ShopRequest] = DeriveJsonEncoder.gen[ShopRequest]
