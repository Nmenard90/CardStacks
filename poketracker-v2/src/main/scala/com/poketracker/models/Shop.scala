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

/** What the public page gets back: the link button plus the cards. */
final case class ShopView(
  messengerUrl: String,
  cards:        List[OwnedCard],
  displayName:  String = "",
  bio:          String = ""
)

object ShopView:
  given JsonEncoder[ShopView] = DeriveJsonEncoder.gen[ShopView]

/** One card a buyer picked on the public shop page. */
final case class ShopRequestItem(
  cardId:    String,
  name:      String,
  number:    String,
  condition: String,
  qty:       Int
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
