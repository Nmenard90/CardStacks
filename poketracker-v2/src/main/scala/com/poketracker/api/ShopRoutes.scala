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
 *     POST /api/shop/:slug/requests                        — buyer sends a buy request or question
 *     GET  /api/shop/:slug/photo/:cardId/:side?cond=NM     — a seller photo (side = front|back), JPEG
 *   Protected (owner only, enforced by AuthGuard's path check):
 *     PUT    /api/collection/:userId/shop-photos/:cardId/:side?cond=NM — body = JPEG bytes (<= 1.5 MB)
 *     DELETE /api/collection/:userId/shop-photos/:cardId/:side?cond=NM
 *     GET  /api/collection/:userId/shop-settings           — slug / on-off / Messenger link
 *     PUT  /api/collection/:userId/shop-settings           — body {slug, enabled, messengerUrl}
 *     GET  /api/collection/:userId/shop-requests           — inbox, newest first
 *     POST /api/collection/:userId/shop-requests/:id       — body {"status": "new|answered|done"}
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
  private def validateSettings(in: ShopSettings): Either[String, ShopSettings] =
    val slug = in.slug.trim.toLowerCase
    val url  = in.messengerUrl.trim
    if slugPattern.findFirstIn(slug).isEmpty then Left("Link name must be 3-30 letters, numbers or dashes.")
    else if reservedSlugs(slug)              then Left("That link name is reserved. Please pick another.")
    else if url.nonEmpty && (!url.startsWith("https://") || url.length > 200) then Left("Messenger link must start with https:// (like https://m.me/yourname).")
    else Right(ShopSettings(slug, in.enabled, url))

  /** Trims and length-caps the untrusted buyer request; Left = message for the buyer. */
  private def validateRequest(in: ShopRequestInput): Either[String, ShopRequestInput] =
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
    else Right(ShopRequestInput(name, contact, message, in.items))

  val publicRoutes: Routes[CollectionService & ShopRepository, Nothing] = Routes(

    Method.GET / "api" / "shop" / string("slug") -> handler { (slug: String, req: Request) =>
      ZIO.serviceWithZIO[ShopRepository](_.findPublicSeller(slug.toLowerCase)).flatMap {
        case None                        => ZIO.succeed(notOpen)
        case Some((userId, messengerUrl)) =>
          // Multi-game: ?game=<id> picks the game's world, default English Pokémon.
          for
            cards  <- ZIO.serviceWithZIO[CollectionService](_.getOwnedCards(userId, GameParam.of(req)))
            photos <- ZIO.serviceWithZIO[ShopRepository](_.listPhotos(userId))
          yield Response.json(ShopView(messengerUrl, cards.map(sanitize), photos).toJson)
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
    }
  )
