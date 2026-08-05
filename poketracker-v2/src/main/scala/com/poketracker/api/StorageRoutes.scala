/**
 * FILE: StorageRoutes.scala
 * PACKAGE: com.poketracker.api
 * LOCATION: src/main/scala/com/poketracker/api/StorageRoutes.scala
 *
 * PURPOSE:
 *   HTTP endpoints for physical storage (boxes, drawers, card assignment).
 *
 * ENDPOINTS:
 *   GET    /api/storage/:userId/boxes                         — list boxes with drawers
 *   POST   /api/storage/:userId/boxes                         — create a box
 *   PUT    /api/storage/boxes/:boxId                          — rename/reorder a box
 *   DELETE /api/storage/boxes/:boxId                          — delete a box
 *   POST   /api/storage/boxes/:boxId/drawers                  — create a drawer
 *   PUT    /api/storage/drawers/:drawerId                     — rename/reorder a drawer
 *   DELETE /api/storage/drawers/:drawerId                     — delete a drawer
 *   GET    /api/storage/drawers/:drawerId/cards                — cards in a drawer
 *   GET    /api/storage/:userId/unassigned                    — owned cards with no drawer
 *   POST   /api/storage/:userId/assign                        — assign cards to a drawer
 *   DELETE /api/storage/:userId/assign/:cardId                — unassign a card
 *
 * USED BY: Main.scala
 * DEPENDS ON: StorageService
 */

package com.poketracker.api

import com.poketracker.service.StorageService
import zio.*
import zio.http.*
import zio.json.*

object StorageRoutes:

  private case class CreateBoxRequest(name: String)
  private given JsonDecoder[CreateBoxRequest] = DeriveJsonDecoder.gen

  private case class CreateDrawerRequest(name: String)
  private given JsonDecoder[CreateDrawerRequest] = DeriveJsonDecoder.gen

  /** name/position are both optional — only the fields present are changed. */
  private case class UpdateRequest(name: Option[String], position: Option[Int])
  private given JsonDecoder[UpdateRequest] = DeriveJsonDecoder.gen

  private case class AssignRequest(cardIds: List[String], drawerId: String)
  private given JsonDecoder[AssignRequest] = DeriveJsonDecoder.gen

  val routes: Routes[StorageService, Nothing] = Routes(

    Method.GET / "api" / "storage" / string("userId") / "boxes" -> handler {
      (userId: String, _: Request) =>
        ZIO.serviceWithZIO[StorageService](_.getBoxes(userId))
          .map(boxes => Response.json(boxes.toJson))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.POST / "api" / "storage" / string("userId") / "boxes" -> handler {
      (userId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[CreateBoxRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          box    <- ZIO.serviceWithZIO[StorageService](_.createBox(userId, parsed.name))
        yield Response.json(box.toJson).status(Status.Created)
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.PUT / "api" / "storage" / "boxes" / string("boxId") -> handler {
      (boxId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[UpdateRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- ZIO.foreach(parsed.name)(n => ZIO.serviceWithZIO[StorageService](_.renameBox(boxId, n)))
          _      <- ZIO.foreach(parsed.position)(p => ZIO.serviceWithZIO[StorageService](_.reorderBox(boxId, p)))
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.DELETE / "api" / "storage" / "boxes" / string("boxId") -> handler {
      (boxId: String, _: Request) =>
        ZIO.serviceWithZIO[StorageService](_.deleteBox(boxId))
          .map(_ => Response.json("""{"ok": true}"""))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.POST / "api" / "storage" / "boxes" / string("boxId") / "drawers" -> handler {
      (boxId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[CreateDrawerRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          drawer <- ZIO.serviceWithZIO[StorageService](_.createDrawer(boxId, parsed.name))
        yield Response.json(drawer.toJson).status(Status.Created)
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.PUT / "api" / "storage" / "drawers" / string("drawerId") -> handler {
      (drawerId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[UpdateRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- ZIO.foreach(parsed.name)(n => ZIO.serviceWithZIO[StorageService](_.renameDrawer(drawerId, n)))
          _      <- ZIO.foreach(parsed.position)(p => ZIO.serviceWithZIO[StorageService](_.reorderDrawer(drawerId, p)))
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.DELETE / "api" / "storage" / "drawers" / string("drawerId") -> handler {
      (drawerId: String, _: Request) =>
        ZIO.serviceWithZIO[StorageService](_.deleteDrawer(drawerId))
          .map(_ => Response.json("""{"ok": true}"""))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "storage" / "drawers" / string("drawerId") / "cards" -> handler {
      (drawerId: String, _: Request) =>
        ZIO.serviceWithZIO[StorageService](_.getDrawerCards(drawerId))
          .map(cards => Response.json(cards.toJson))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "storage" / string("userId") / "unassigned" -> handler {
      (userId: String, _: Request) =>
        ZIO.serviceWithZIO[StorageService](_.getUnassignedCards(userId))
          .map(cards => Response.json(cards.toJson))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.POST / "api" / "storage" / string("userId") / "assign" -> handler {
      (userId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[AssignRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          result <- ZIO.serviceWithZIO[StorageService](_.assignCards(userId, parsed.cardIds, parsed.drawerId))
        yield Response.json(result.toJson)
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.DELETE / "api" / "storage" / string("userId") / "assign" / string("cardId") -> handler {
      (userId: String, cardId: String, _: Request) =>
        ZIO.serviceWithZIO[StorageService](_.unassignCard(userId, cardId))
          .map(_ => Response.json("""{"ok": true}"""))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    }
  )
