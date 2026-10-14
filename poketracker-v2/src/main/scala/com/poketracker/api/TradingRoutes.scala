/**
 * TradingRoutes — HTTP endpoints for share links, trade lists and offers.
 *
 * HOW IT WORKS
 *   Pure request/response plumbing over TradingService. `publicRoutes`
 *   (the share page itself) needs no session; everything under
 *   /api/trading/:userId is behind AuthGuard, which also 403s any request
 *   whose path userId isn't the caller ("trading" is a user-scoped
 *   resource there). TradingError carries its own HTTP status.
 *
 * ENDPOINTS
 *   GET    /api/share/:slug                                  — public share page data
 *   GET    /api/trading/:userId/share                        — own share settings (creates link)
 *   PUT    /api/trading/:userId/share                        — update settings
 *   POST   /api/trading/:userId/share/regenerate             — new link, old one stops working
 *   GET    /api/trading/:userId/list                         — own trade list
 *   PUT    /api/trading/:userId/list                         — add/update a trade list item
 *   DELETE /api/trading/:userId/list/:itemId                 — remove one
 *   GET    /api/trading/:userId/offers                       — offers made and received
 *   POST   /api/trading/:userId/offers                       — make an offer on a share link
 *   GET    /api/trading/:userId/offers/:offerId              — one offer + thread (marks read)
 *   PUT    /api/trading/:userId/offers/:offerId/status       — accept/decline/withdraw/complete/cancel
 *   POST   /api/trading/:userId/offers/:offerId/messages     — post to the thread
 *   GET    /api/trading/:userId/unread                       — unread offer count for the nav badge
 *
 * USED BY: Main.scala
 * DEPENDS ON: TradingService
 */

package com.poketracker.api

import com.poketracker.service.{OfferLine, TradingError, TradingService}
import zio.*
import zio.http.*
import zio.json.*

object TradingRoutes:

  private case class ShareUpdate(enabled: Boolean, collectionPublic: Boolean, bio: Option[String])
  private case class ItemRequest(cardId: String, condition: String, quantity: Int, askingPrice: Option[Double], note: Option[String])
  private case class OfferRequest(slug: String, wants: List[OfferLine], gives: List[OfferLine], cashAmount: Option[Double], message: Option[String])
  private case class StatusRequest(status: String)
  private case class MessageRequest(body: String)

  private given JsonDecoder[OfferLine]      = DeriveJsonDecoder.gen
  private given JsonDecoder[ShareUpdate]    = DeriveJsonDecoder.gen
  private given JsonDecoder[ItemRequest]    = DeriveJsonDecoder.gen
  private given JsonDecoder[OfferRequest]   = DeriveJsonDecoder.gen
  private given JsonDecoder[StatusRequest]  = DeriveJsonDecoder.gen
  private given JsonDecoder[MessageRequest] = DeriveJsonDecoder.gen

  private final class BadBody(msg: String) extends RuntimeException(msg)

  private def error(status: Status, message: String): Response =
    Response(status = status, body = Body.fromString(Map("error" -> message).toJson))
      .addHeader(Header.ContentType(MediaType.application.json))

  /** Runs the effect, JSON-encodes its result, and maps failures to a status. */
  private def respond[A: JsonEncoder](effect: ZIO[TradingService, Throwable, A]): ZIO[TradingService, Nothing, Response] =
    effect.map(a => Response.json(a.toJson)).catchAll {
      case TradingError(code, msg) => ZIO.succeed(error(Status.fromInt(code), msg))
      case e: BadBody              => ZIO.succeed(error(Status.BadRequest, e.getMessage))
      case e                       => ZIO.logErrorCause("trading request failed", Cause.fail(e)).as(error(Status.InternalServerError, "Something went wrong."))
    }

  private def body[A: JsonDecoder](req: Request): Task[A] =
    req.body.asString.flatMap(s => ZIO.fromEither(s.fromJson[A]).mapError(e => BadBody(s"Bad request: $e")))

  private def svc = ZIO.service[TradingService]

  val publicRoutes: Routes[TradingService, Nothing] = Routes(
    Method.GET / "api" / "share" / string("slug") -> handler { (slug: String, _: Request) =>
      respond(svc.flatMap(_.sharedProfile(slug)))
    }
  )

  val routes: Routes[TradingService, Nothing] = Routes(

    Method.GET / "api" / "trading" / string("userId") / "share" -> handler { (userId: String, _: Request) =>
      respond(svc.flatMap(_.getShare(userId)))
    },

    Method.PUT / "api" / "trading" / string("userId") / "share" -> handler { (userId: String, req: Request) =>
      respond(body[ShareUpdate](req).flatMap(b => svc.flatMap(_.updateShare(userId, b.enabled, b.collectionPublic, b.bio))))
    },

    Method.POST / "api" / "trading" / string("userId") / "share" / "regenerate" -> handler { (userId: String, _: Request) =>
      respond(svc.flatMap(_.regenerateSlug(userId)))
    },

    Method.GET / "api" / "trading" / string("userId") / "list" -> handler { (userId: String, _: Request) =>
      respond(svc.flatMap(_.tradeList(userId)))
    },

    Method.PUT / "api" / "trading" / string("userId") / "list" -> handler { (userId: String, req: Request) =>
      respond(body[ItemRequest](req).flatMap(b =>
        svc.flatMap(_.saveTradeItem(userId, b.cardId, b.condition, b.quantity, b.askingPrice, b.note))))
    },

    Method.DELETE / "api" / "trading" / string("userId") / "list" / string("itemId") -> handler {
      (userId: String, itemId: String, _: Request) =>
        respond(svc.flatMap(_.removeTradeItem(userId, itemId)).as(Map("ok" -> true)))
    },

    Method.GET / "api" / "trading" / string("userId") / "offers" -> handler { (userId: String, _: Request) =>
      respond(svc.flatMap(_.offers(userId)))
    },

    Method.POST / "api" / "trading" / string("userId") / "offers" -> handler { (userId: String, req: Request) =>
      respond(body[OfferRequest](req).flatMap(b =>
        svc.flatMap(_.makeOffer(userId, b.slug, b.wants, b.gives, b.cashAmount, b.message))))
    },

    Method.GET / "api" / "trading" / string("userId") / "offers" / string("offerId") -> handler {
      (userId: String, offerId: String, _: Request) =>
        respond(svc.flatMap(_.offer(userId, offerId)))
    },

    Method.PUT / "api" / "trading" / string("userId") / "offers" / string("offerId") / "status" -> handler {
      (userId: String, offerId: String, req: Request) =>
        respond(body[StatusRequest](req).flatMap(b => svc.flatMap(_.setStatus(userId, offerId, b.status))))
    },

    Method.POST / "api" / "trading" / string("userId") / "offers" / string("offerId") / "messages" -> handler {
      (userId: String, offerId: String, req: Request) =>
        respond(body[MessageRequest](req).flatMap(b => svc.flatMap(_.postMessage(userId, offerId, b.body))))
    },

    Method.GET / "api" / "trading" / string("userId") / "unread" -> handler { (userId: String, _: Request) =>
      respond(svc.flatMap(_.unreadCount(userId)).map(n => Map("count" -> n)))
    }
  )
