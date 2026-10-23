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
 *   Protected (owner only, enforced by AuthGuard's path check):
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
          ZIO.serviceWithZIO[CollectionService](_.getOwnedCards(userId, GameParam.of(req)))
            .map(cards => Response.json(ShopView(messengerUrl, cards.map(sanitize)).toJson))
      }.catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
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
