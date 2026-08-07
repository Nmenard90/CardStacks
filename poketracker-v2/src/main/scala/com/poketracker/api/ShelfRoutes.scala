/**
 * ShelfRoutes — HTTP endpoints for the unified shelf (boxes + binders).
 *
 * HOW IT WORKS
 *   Pure request/response plumbing over ShelfService — parse, delegate,
 *   respond. No business logic here.
 *
 * ENDPOINTS
 *   GET /api/shelf/:userId          — merged, ordered list of boxes + binders
 *   PUT /api/shelf/:userId/reorder  — write a whole new order in one request
 *
 * USED BY: Main.scala
 * DEPENDS ON: ShelfService
 */

package com.poketracker.api

import com.poketracker.models.*
import com.poketracker.service.ShelfService
import zio.*
import zio.http.*
import zio.json.*

object ShelfRoutes:

  private case class ReorderRequest(items: List[ShelfItem])
  private given JsonDecoder[ReorderRequest] = DeriveJsonDecoder.gen

  val routes: Routes[ShelfService, Nothing] = Routes(

    Method.GET / "api" / "shelf" / string("userId") -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[ShelfService](_.getShelf(userId))
        .map(entries => Response.json(entries.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.PUT / "api" / "shelf" / string("userId") / "reorder" -> handler {
      (userId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[ReorderRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- ZIO.serviceWithZIO[ShelfService](_.reorder(userId, parsed.items))
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    }
  )
