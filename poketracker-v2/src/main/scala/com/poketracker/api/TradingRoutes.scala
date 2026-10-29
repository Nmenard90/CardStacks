/**
 * TradingRoutes — HTTP endpoints for card offers (My Shop → Offers).
 *
 * HOW IT WORKS
 *   Pure request/response plumbing over TradingService. Everything under
 *   /api/trading/:userId is behind AuthGuard, which also 403s any request
 *   whose path userId isn't the caller ("trading" is a user-scoped
 *   resource there). TradingError carries its own HTTP status.
 *   New offers are no longer made here: the share-link trade page was folded
 *   into the shop, where buyers send buy/trade requests (ShopRoutes).
 *
 * ENDPOINTS
 *   GET    /api/trading/:userId/offers                       — offers made and received
 *   GET    /api/trading/:userId/offers/:offerId              — one offer + thread (marks read)
 *   PUT    /api/trading/:userId/offers/:offerId/status       — accept/decline/withdraw/complete/cancel
 *   POST   /api/trading/:userId/offers/:offerId/messages     — post to the thread
 *   GET    /api/trading/:userId/unread                       — unread offer count for the nav badge
 *
 * USED BY: Main.scala
 * DEPENDS ON: TradingService
 */

package com.poketracker.api

import com.poketracker.service.{TradingError, TradingService}
import zio.*
import zio.http.*
import zio.json.*

object TradingRoutes:

  private case class StatusRequest(status: String)
  private case class MessageRequest(body: String)

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

  val routes: Routes[TradingService, Nothing] = Routes(

    Method.GET / "api" / "trading" / string("userId") / "offers" -> handler { (userId: String, req: Request) =>
      respond(svc.flatMap(_.offers(userId, GameParam.of(req))))
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

    Method.GET / "api" / "trading" / string("userId") / "unread" -> handler { (userId: String, req: Request) =>
      respond(svc.flatMap(_.unreadCount(userId, GameParam.of(req))).map(n => Map("count" -> n)))
    }
  )
