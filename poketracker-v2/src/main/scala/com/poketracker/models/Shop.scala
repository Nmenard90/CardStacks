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

/** One card a buyer picked on the public shop page; `photos` when the buyer asked to see photos of the copy. The
 *  seller's pull list adds the rest (stored in the request's items JSON, so no migration): `pulled` once they've found the card, `foundQty` when they found only some of `qty`,
 *  `askedCondition`, what the buyer picked, once the seller changed `condition` to the copy's real one, and `sold`,
 *  how many copies the sale took out of their collection. All absent on a new request. */
final case class ShopRequestItem(
  cardId:         String,
  name:           String,
  number:         String,
  condition:      String,
  qty:            Int,
  pulled:         Option[Boolean] = None,
  askedCondition: Option[String]  = None,
  foundQty:       Option[Int]     = None,
  sold:           Option[Int]     = None,
  photos:         Option[Boolean] = None
):
  /** Copies found: none until marked found, then all of `qty` unless the seller said fewer. */
  def found: Int = if pulled.contains(true) then foundQty.getOrElse(qty).max(0).min(qty) else 0
  def soldQty: Int = sold.getOrElse(0)

object ShopRequestItem:
  given JsonCodec[ShopRequestItem] = DeriveJsonCodec.gen[ShopRequestItem]

/** One card the sale couldn't fully take out: the collection had fewer copies than were found (already removed by
 *  hand, or sold elsewhere). */
final case class SaleShortfall(name: String, number: String, condition: String, wanted: Int, taken: Int)

object SaleShortfall:
  given JsonEncoder[SaleShortfall] = DeriveJsonEncoder.gen[SaleShortfall]

/** What completing a sale did: the request as saved now, and any cards that came up short. */
final case class SaleResult(request: ShopRequest, taken: Int, short: List[SaleShortfall])

object SaleResult:
  given JsonEncoder[SaleResult] = DeriveJsonEncoder.gen[SaleResult]

/** What the public page POSTs. No account needed, so every field is untrusted. */
final case class ShopRequestInput(
  buyerName:    String,
  buyerContact: String,
  message:      String,
  items:        List[ShopRequestItem]
)

/** The seller's change to one card on their pull list: found or not, how many were found, and/or its real condition. */
final case class ShopRequestItemChange(pulled: Option[Boolean] = None, condition: Option[String] = None, foundQty: Option[Int] = None)

object ShopRequestItemChange:
  given JsonDecoder[ShopRequestItemChange] = DeriveJsonDecoder.gen[ShopRequestItemChange]

object ShopRequestInput:
  given JsonDecoder[ShopRequestInput] = DeriveJsonDecoder.gen[ShopRequestInput]

/** One card of a request as its buyer sees it: the condition the seller confirmed with the copy in hand (and what the
 *  buyer picked, when that differs), whether they asked for photos. Nothing else from the seller's pull list. */
final case class BuyerRequestItem(cardId: String, name: String, number: String, condition: String, qty: Int, photos: Boolean,
                                  askedCondition: Option[String] = None)

object BuyerRequestItem:
  given JsonEncoder[BuyerRequestItem] = DeriveJsonEncoder.gen[BuyerRequestItem]

/** A request as its buyer sees it (from the link they got when sending it): the cards, whether the seller has
 *  answered, and the seller's photos of those cards. No contact details, message or pull-list notes. */
final case class BuyerRequestView(
  status:    String,
  createdAt: Instant,
  items:     List[BuyerRequestItem],
  photos:    List[ShopPhotoRef]
)

object BuyerRequestView:
  given JsonEncoder[BuyerRequestView] = DeriveJsonEncoder.gen[BuyerRequestView]

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
