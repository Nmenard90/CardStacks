/**
 * ShopRoutes — each user's optional public "cards for sale" page and their
 * buyer-request inbox.
 *
 * HOW IT WORKS
 *   A user's collection is private until they switch their shop on (saving
 *   shop settings with enabled=true). Their public link is /shop/<slug>.
 *   An unknown slug and a switched-off shop both return the same 404, so
 *   nobody can tell whether a private shop exists.
 *   Public responses strip everything private — what the seller paid,
 *   purchase dates, which box/drawer a card lives in, and the stored price
 *   snapshot (the page prices from the card's live market data).
 *   Anyone can POST a request (no account); only the seller can read or
 *   update them, via the normal AuthGuard-protected /api/collection/:userId path.
 *
 * ENDPOINTS
 *   Public:
 *     GET  /api/shop/:slug                                 — the shop's cards + Messenger link
 *     GET  /api/shop/from-share/:shareSlug                 — {slug} of the shop an old /s/<slug> share link now leads to
 *     POST /api/shop/:slug/requests                        — buyer sends a buy request or question; returns {ok, id}
 *     GET  /api/shop/:slug/requests/:id                    — the buyer's view of their request (the id is the secret:
 *          a random UUID only the buyer's link carries): the cards, status, and the seller's photos of those cards
 *     GET  /api/shop/:slug/photo/:cardId/:side?cond=NM     — a seller photo (side = front|back), JPEG
 *   Protected (owner only, enforced by AuthGuard's path check):
 *     GET    /api/collection/:userId/shop-photos              — which photos the owner has (no shop needed)
 *     GET    /api/collection/:userId/shop-photos/:cardId/:side?cond=NM — one of the owner's own photos, JPEG
 *     PUT    /api/collection/:userId/shop-photos/:cardId/:side?cond=NM — body = JPEG bytes (<= 1.5 MB)
 *     DELETE /api/collection/:userId/shop-photos/:cardId/:side?cond=NM
 *     GET  /api/collection/:userId/shop-settings           — slug / on-off / Messenger link
 *     PUT  /api/collection/:userId/shop-settings           — body {slug, enabled, messengerUrl}
 *     GET  /api/collection/:userId/shop-requests           — inbox, newest first
 *     POST /api/collection/:userId/shop-requests/:id       — body {"status": "new|answered|done"}
 *     POST /api/collection/:userId/shop-requests/:id/items/:index — body {"pulled"?: bool, "foundQty"?: 2, "condition"?: "LP"};
 *          the pull list: mark a card found (or how many of it), or set its real condition (the buyer's pick is kept
 *          as askedCondition)
 *     POST /api/collection/:userId/shop-requests/:id/sell  — takes the found cards out of the seller's collection
 *          (only those, and never twice) and marks the request done; returns {request, taken, short}
 *     POST /api/collection/:userId/shop-requests/:id/put-back — body {"index"?: 3}; a refund or a sale that fell
 *          through: puts that card's sold copies (or every card's, without an index) back in the collection
 */

package com.poketracker.api

import com.poketracker.models.*
import com.poketracker.repository.ShopRepository
import com.poketracker.service.CollectionService
import zio.*
import zio.http.*
import zio.json.*

object ShopRoutes:

  private case class StatusBody(status: String)
  private given JsonDecoder[StatusBody] = DeriveJsonDecoder.gen[StatusBody]

  /** Which card to put back; none = every sold card on the request. */
  private case class PutBackBody(index: Option[Int])
  private given JsonDecoder[PutBackBody] = DeriveJsonDecoder.gen[PutBackBody]

  private val validStatuses = Set("new", "answered", "done")

  /** Slugs that would collide with real front-end routes. */
  private val reservedSlugs = Set("requests", "admin", "api", "new", "settings")
  private val slugPattern   = "^[a-z0-9-]{3,30}$".r

  private val notOpen = Response.notFound("This shop is not open.")

  private val photoSides   = Set("front", "back")
  private val maxPhotoSize = 1536 * 1024   // 1.5 MB per picture

  /** True when the bytes start with the JPEG signature. The bytes are served back
   *  from this site's own address, so only a real picture is ever accepted. */
  private[poketracker] def isJpeg(b: Array[Byte]): Boolean =
    b.length > 3 && (b(0) & 0xff) == 0xff && (b(1) & 0xff) == 0xd8 && (b(2) & 0xff) == 0xff

  /** Checks the photo's address parts; Left = message for the seller. */
  private[poketracker] def validatePhotoKey(cardId: String, side: String, cond: Option[String]): Either[String, String] =
    val c = cond.map(_.trim).getOrElse("")
    if !photoSides(side)                  then Left("Photo side must be front or back.")
    else if cardId.isEmpty || cardId.length > 64 then Left("That card id looks wrong.")
    else if c.isEmpty || c.length > 40    then Left("Missing the card's condition.")
    else Right(c)

  /** Everything a stranger must never see. */
  private def sanitize(o: OwnedCard): OwnedCard =
    o.copy(
      drawerId   = None,
      conditions = o.conditions.map(_.copy(price = None, purchasePrice = None, purchasedAt = None))
    )

  /** Normalizes and checks the owner's shop settings; Left = message to show them. */
  private[poketracker] def validateSettings(in: ShopSettings): Either[String, ShopSettings] =
    val slug = in.slug.trim.toLowerCase
    val url  = in.messengerUrl.trim
    val name = in.displayName.trim
    val bio  = in.bio.trim
    if slugPattern.findFirstIn(slug).isEmpty then Left("Link name must be 3-30 letters, numbers or dashes.")
    else if reservedSlugs(slug)              then Left("That link name is reserved. Please pick another.")
    else if url.nonEmpty && (!url.startsWith("https://") || url.length > 200) then Left("Messenger link must start with https:// (like https://m.me/yourname).")
    else if name.length > 80 then Left("Shop name must be 80 characters or fewer.")
    else if bio.length > 1000 then Left("Bio must be 1000 characters or fewer.")
    else Right(ShopSettings(slug, in.enabled, url, name, bio))

  private val conditions = Set("NM", "LP", "MP", "HP", "DMG")

  /**
   * The seller's pull-list change to one requested card; Left = message for them. A new condition replaces only the
   * grade at the front ("NM 1st Edition" -> "LP 1st Edition"); the buyer's pick is remembered the first time it
   * changes and forgotten when the seller sets it back.
   */
  private[poketracker] def applyItemChange(item: ShopRequestItem, change: ShopRequestItemChange): Either[String, ShopRequestItem] =
    change.condition.map(_.trim) match
      case _ if item.soldQty > 0 => Left("That card is sold. Put it back first to change it.")
      case Some(c) if !conditions(c) => Left("Condition must be NM, LP, MP, HP or DMG.")
      case _ if change.foundQty.exists(n => n < 0 || n > item.qty) => Left(s"Found must be between 0 and ${item.qty}.")
      case grade =>
        val condition = grade.fold(item.condition)(g => g + item.condition.dropWhile(_ != ' '))
        val asked     = item.askedCondition.getOrElse(item.condition)
        // A count says it all (0 = not found, all of them = plain found); found or not alone means all or none.
        val (pulled, foundQty) = change.foundQty match
          case Some(n) => (Some(n > 0), Option.when(n > 0 && n < item.qty)(n))
          case None    => change.pulled.fold((item.pulled, item.foundQty))(p => (Some(p), None))
        Right(item.copy(
          condition      = condition,
          pulled         = pulled,
          foundQty       = foundQty,
          askedCondition = if condition == asked then None else Some(asked)
        ))

  /** Trims and length-caps the untrusted buyer request; Left = message for the buyer. */
  private[poketracker] def validateRequest(in: ShopRequestInput): Either[String, ShopRequestInput] =
    val name    = in.buyerName.trim
    val contact = in.buyerContact.trim
    val message = in.message.trim
    if name.isEmpty || name.length > 80          then Left("Please enter your name (80 characters max).")
    else if contact.isEmpty || contact.length > 200 then Left("Please tell me how to reach you (Facebook name, phone, or email).")
    else if message.length > 1000                then Left("Message is too long (1000 characters max).")
    else if in.items.length > 150                then Left("That is too many cards for one request (150 max).")
    else if in.items.exists(i => i.qty < 1 || i.qty > 99 || i.cardId.length > 64 || i.name.length > 120 ||
                                 i.number.length > 20 || i.condition.length > 20)
                                                 then Left("One of the cards in your request looks wrong. Please refresh and try again.")
    else Right(ShopRequestInput(name, contact, message,
      in.items.map(i => i.copy(pulled = None, askedCondition = None, foundQty = None, sold = None, photos = i.photos.filter(identity)))))

  /** A request id as the server makes them (a random UUID); anything else can't be one. */
  private val requestId = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$".r

  /** The buyer's view of a request: their cards (not the seller's pull-list notes) and the seller's photos of them. */
  private[poketracker] def buyerView(r: ShopRequest, photos: List[ShopPhotoRef]): BuyerRequestView =
    val items = r.items.map(i => BuyerRequestItem(i.cardId, i.name, i.number, i.condition, i.qty, i.photos.contains(true), i.askedCondition))
    val cards = items.map(_.cardId).toSet
    BuyerRequestView(r.status, r.createdAt, items, photos.filter(p => cards(p.cardId)))

  val publicRoutes: Routes[CollectionService & ShopRepository, Nothing] = Routes(

    // Old share links (/s/<slug>) point at the same person's shop. 404 when they have none open.
    Method.GET / "api" / "shop" / "from-share" / string("shareSlug") -> handler { (shareSlug: String, _: Request) =>
      ZIO.serviceWithZIO[ShopRepository](_.shopSlugForShareLink(shareSlug)).map {
        case Some(slug) => Response.json(Map("slug" -> slug).toJson)
        case None       => notOpen
      }.catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "shop" / string("slug") -> handler { (slug: String, req: Request) =>
      ZIO.serviceWithZIO[ShopRepository](_.findPublicSeller(slug.toLowerCase)).flatMap {
        case None                        => ZIO.succeed(notOpen)
        case Some((userId, messengerUrl, displayName, bio)) =>
          // Multi-game: ?game=<id> picks the game's world, default English Pokémon.
          for
            cards  <- ZIO.serviceWithZIO[CollectionService](_.getOwnedCards(userId, GameParam.of(req)))
            photos <- ZIO.serviceWithZIO[ShopRepository](_.listPhotos(userId))
          yield Response.json(ShopView(messengerUrl, cards.map(sanitize), photos, displayName, bio).toJson)
      }.catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "shop" / string("slug") / "photo" / string("cardId") / string("side") -> handler {
      (slug: String, cardId: String, side: String, req: Request) =>
        validatePhotoKey(cardId, side, req.url.queryParams.getAll("cond").headOption) match
          case Left(_)     => ZIO.succeed(Response.notFound)
          case Right(cond) =>
            (for
              seller <- ZIO.serviceWithZIO[ShopRepository](_.findPublicSeller(slug.toLowerCase))
              userId <- ZIO.fromOption(seller.map(_._1))
              photo  <- ZIO.serviceWithZIO[ShopRepository](_.getPhoto(userId, cardId, cond, side)).some
            yield Response(
              status  = Status.Ok,
              headers = Headers(
                Header.ContentType(MediaType.image.jpeg),
                Header.Custom("Cache-Control", "public, max-age=31536000, immutable"),   // the page's URL carries a version
                Header.Custom("X-Content-Type-Options", "nosniff")
              ),
              body = Body.fromArray(photo._1)
            )).catchAll(_ => ZIO.succeed(Response.notFound))
    },

    Method.POST / "api" / "shop" / string("slug") / "requests" -> handler { (slug: String, req: Request) =>
      (for
        seller <- ZIO.serviceWithZIO[ShopRepository](_.findPublicSeller(slug.toLowerCase))
                    .mapError(_ => "Could not save your request. Please try again.")
        userId <- ZIO.fromOption(seller.map(_._1)).orElseFail("This shop is not open.")
        body   <- req.body.asString.mapError(_ => "Could not read that request.")
        parsed <- ZIO.fromEither(body.fromJson[ShopRequestInput]).mapError(_ => "Could not read that request.")
        clean  <- ZIO.fromEither(validateRequest(parsed))
        saved  <- ZIO.serviceWithZIO[ShopRepository](_.create(userId, clean)).mapError(_ => "Could not save your request. Please try again.")
      yield Response.json(s"""{"ok": true, "id": "${saved.id}"}""")
      ).catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    },

    Method.GET / "api" / "shop" / string("slug") / "requests" / string("id") -> handler { (slug: String, id: String, _: Request) =>
      if requestId.matches(id) then
        (for
          seller  <- ZIO.serviceWithZIO[ShopRepository](_.findPublicSeller(slug.toLowerCase))
          userId  <- ZIO.fromOption(seller.map(_._1))
          request <- ZIO.serviceWithZIO[ShopRepository](_.find(userId, id)).some
          photos  <- ZIO.serviceWithZIO[ShopRepository](_.listPhotos(userId)).asSomeError
        yield Response.json(buyerView(request, photos).toJson)
        ).catchAll(_ => ZIO.succeed(notOpen))
      else ZIO.succeed(notOpen)
    }
  )

  val protectedRoutes: Routes[ShopRepository, Nothing] = Routes(

    Method.GET / "api" / "collection" / string("userId") / "shop-settings" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[ShopRepository](_.getSettings(userId))
        .map(s => Response.json(s.getOrElse(ShopSettings("", false, "")).toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.PUT / "api" / "collection" / string("userId") / "shop-settings" -> handler { (userId: String, req: Request) =>
      (for
        body   <- req.body.asString.mapError(_ => "Could not read that.")
        parsed <- ZIO.fromEither(body.fromJson[ShopSettings]).mapError(_ => "Could not read that.")
        clean  <- ZIO.fromEither(validateSettings(parsed))
        _      <- ZIO.serviceWithZIO[ShopRepository](_.saveSettings(userId, clean)).mapError { e =>
                    // slug is UNIQUE, so Postgres rejects a name another shop already has.
                    if Option(e.getMessage).exists(_.contains("duplicate key")) then "That link name is taken. Try another."
                    else "Could not save your shop settings."
                  }
      yield Response.json(clean.toJson)
      ).catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    },

    Method.GET / "api" / "collection" / string("userId") / "shop-requests" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[ShopRepository](_.list(userId))
        .map(rs => Response.json(rs.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    // The owner's own photos, from their collection (no shop needed): which exist, and each picture.
    Method.GET / "api" / "collection" / string("userId") / "shop-photos" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[ShopRepository](_.listPhotos(userId))
        .map(photos => Response.json(photos.toJson))
        .catchAll(_ => ZIO.succeed(Response.internalServerError("Could not load your photos.")))
    },

    Method.GET / "api" / "collection" / string("userId") / "shop-photos" / string("cardId") / string("side") -> handler {
      (userId: String, cardId: String, side: String, req: Request) =>
        validatePhotoKey(cardId, side, req.url.queryParams.getAll("cond").headOption) match
          case Left(_)     => ZIO.succeed(Response.notFound)
          case Right(cond) =>
            ZIO.serviceWithZIO[ShopRepository](_.getPhoto(userId, cardId, cond, side)).some
              .map(photo => Response(
                status  = Status.Ok,
                headers = Headers(
                  Header.ContentType(MediaType.image.jpeg),
                  Header.Custom("Cache-Control", "private, no-cache"),
                  Header.Custom("X-Content-Type-Options", "nosniff")
                ),
                body = Body.fromArray(photo._1)
              ))
              .catchAll(_ => ZIO.succeed(Response.notFound))
    },

    Method.PUT / "api" / "collection" / string("userId") / "shop-photos" / string("cardId") / string("side") -> handler {
      (userId: String, cardId: String, side: String, req: Request) =>
        (for
          cond  <- ZIO.fromEither(validatePhotoKey(cardId, side, req.url.queryParams.getAll("cond").headOption))
          bytes <- req.body.asArray.mapError(_ => "Could not read that photo.")
          _     <- ZIO.when(bytes.length > maxPhotoSize)(ZIO.fail("That photo is too big (1.5 MB max)."))
          _     <- ZIO.unless(isJpeg(bytes))(ZIO.fail("Only JPEG photos are accepted."))
          ok    <- ZIO.serviceWithZIO[ShopRepository](_.savePhoto(userId, cardId, cond, side, bytes)).mapError(_ => "Could not save that photo.")
          _     <- ZIO.unless(ok)(ZIO.fail(s"You are at the limit of ${ShopRepository.MaxPhotosPerUser} photos. Remove some first."))
        yield Response.json("""{"ok": true}""")
        ).catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    },

    Method.DELETE / "api" / "collection" / string("userId") / "shop-photos" / string("cardId") / string("side") -> handler {
      (userId: String, cardId: String, side: String, req: Request) =>
        (for
          cond <- ZIO.fromEither(validatePhotoKey(cardId, side, req.url.queryParams.getAll("cond").headOption))
          _    <- ZIO.serviceWithZIO[ShopRepository](_.deletePhoto(userId, cardId, cond, side)).mapError(_ => "Could not remove that photo.")
        yield Response.json("""{"ok": true}""")
        ).catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    },

    Method.POST / "api" / "collection" / string("userId") / "shop-requests" / string("id") -> handler {
      (userId: String, id: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[StatusBody]).mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- ZIO.unless(validStatuses(parsed.status))(ZIO.fail(RuntimeException("Unknown status")))
          _      <- ZIO.serviceWithZIO[ShopRepository](_.setStatus(userId, id, parsed.status))
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.POST / "api" / "collection" / string("userId") / "shop-requests" / string("id") / "items" / int("index") -> handler {
      (userId: String, id: String, index: Int, req: Request) =>
        (for
          body    <- req.body.asString.mapError(_ => "Could not read that.")
          change  <- ZIO.fromEither(body.fromJson[ShopRequestItemChange]).mapError(_ => "Could not read that.")
          result  <- ZIO.serviceWithZIO[ShopRepository](_.updateItem(userId, id, index, applyItemChange(_, change)))
                       .mapError(_ => "Could not save that. Please try again.")
          updated <- ZIO.fromOption(result).orElseFail("That card is no longer on this request.").flatMap(ZIO.fromEither(_))
        yield Response.json(updated.toJson)
        ).catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    },

    Method.POST / "api" / "collection" / string("userId") / "shop-requests" / string("id") / "sell" -> handler {
      (userId: String, id: String, _: Request) =>
        ZIO.serviceWithZIO[ShopRepository](_.sell(userId, id))
          .mapError(_ => "Could not finish that sale. Nothing was taken out; please try again.")
          .flatMap(ZIO.fromOption(_).orElseFail("That request is gone."))
          .map(result => Response.json(result.toJson))
          .catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    },

    Method.POST / "api" / "collection" / string("userId") / "shop-requests" / string("id") / "put-back" -> handler {
      (userId: String, id: String, req: Request) =>
        (for
          body    <- req.body.asString.mapError(_ => "Could not read that.")
          which   <- ZIO.fromEither(if body.isBlank then Right(PutBackBody(None)) else body.fromJson[PutBackBody]).mapError(_ => "Could not read that.")
          result  <- ZIO.serviceWithZIO[ShopRepository](_.putBack(userId, id, which.index))
                       .mapError(_ => "Could not put that back. Please try again.")
          updated <- ZIO.fromOption(result).orElseFail("That request is gone.")
        yield Response.json(updated.toJson)
        ).catchAll(msg => ZIO.succeed(Response.badRequest(msg)))
    }
  )
