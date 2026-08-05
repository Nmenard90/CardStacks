/**
 * FILE: BinderRoutes.scala
 * PACKAGE: com.poketracker.api
 * LOCATION: src/main/scala/com/poketracker/api/BinderRoutes.scala
 *
 * PURPOSE:
 *   HTTP endpoints for binder management.
 *
 * ENDPOINTS:
 *   GET    /api/binders/:userId                              — list binders
 *   POST   /api/binders/:userId                             — create binder
 *   GET    /api/binders/:userId/:binderId                   — get binder with slots
 *   PUT    /api/binders/:userId/:binderId                   — update name/cover
 *   DELETE /api/binders/:userId/:binderId                   — delete binder
 *   PUT    /api/binders/:userId/:binderId/slot/:slotIndex   — place/remove card
 *
 * USED BY: Main.scala
 * DEPENDS ON: BinderService
 */

package com.poketracker.api

import com.poketracker.models.*
import com.poketracker.service.BinderService
import zio.*
import zio.http.*
import zio.json.*

/**
 * OBJECT: BinderRoutes
 * PURPOSE: All HTTP routes for binder management.
 */
object BinderRoutes:

  /**
   * CASE CLASS: CreateBinderRequest
   * PURPOSE: JSON body for creating a new binder.
   * @param name        Display name e.g. "My Charizards"
   * @param pocketSize  Cards per page — must be "Four", "Nine", or "Twelve"
   */
  private case class CreateBinderRequest(name: String, pocketSize: String)
  private given JsonDecoder[CreateBinderRequest] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: UpdateBinderRequest
   * PURPOSE: JSON body for updating binder metadata. All fields optional —
   *          only the fields present in the request are changed.
   * @param name        New display name, if changing
   * @param coverImage  New cover image URL, if changing
   * @param pocketSize  New pocket size ("Four" | "Nine" | "Twelve"), if changing
   */
  private case class UpdateBinderRequest(
    name:       Option[String],
    coverImage: Option[String],
    pocketSize: Option[String]
  )
  private given JsonDecoder[UpdateBinderRequest] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: SlotRequest
   * PURPOSE: JSON body for placing or clearing a binder slot.
   *          Send all None fields to clear the slot.
   * @param cardId    Card to place, or None to clear the slot
   * @param cardName  Cached card name for display without a database join
   * @param imageUrl  Cached card image URL for display without a database join
   */
  private case class SlotRequest(
    cardId:   Option[String],
    cardName: Option[String],
    imageUrl: Option[String]
  )
  private given JsonDecoder[SlotRequest] = DeriveJsonDecoder.gen

  /**
   * VALUE: routes
   * PURPOSE: All binder HTTP route definitions.
   * @return Routes[BinderService, Nothing]
   */
  val routes: Routes[BinderService, Nothing] = Routes(

    /**
     * ROUTE: GET /api/binders/:userId
     * PURPOSE: Returns all binders for a user without slot data.
     *          Slots are omitted for performance — loaded separately when opening a binder.
     * @param userId  The user whose binders to list
     * RESPONSE: 200 JSON array of Binder objects (slots list empty)
     *           500 on database error
     */
    Method.GET / "api" / "binders" / string("userId") -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[BinderService](_.getBinders(userId))
        .map(binders => Response.json(binders.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: POST /api/binders/:userId
     * PURPOSE: Creates a new empty binder for a user.
     * @param userId  The user who will own this binder
     * BODY: CreateBinderRequest JSON
     * RESPONSE: 201 JSON Binder object on success
     *           400 if pocketSize is invalid or name is empty
     */
    Method.POST / "api" / "binders" / string("userId") -> handler { (userId: String, req: Request) =>
      (for
        body   <- req.body.asString
        parsed <- ZIO.fromEither(body.fromJson[CreateBinderRequest])
                    .mapError(e => RuntimeException(s"Bad request: $e"))
        size   <- ZIO.attempt(PocketSize.valueOf(parsed.pocketSize))
                    .mapError(_ => RuntimeException(
                      s"Invalid pocketSize '${parsed.pocketSize}'. Must be Four, Nine, or Twelve."
                    ))
        binder <- ZIO.serviceWithZIO[BinderService](_.createBinder(userId, parsed.name, size))
      yield Response.json(binder.toJson).status(Status.Created)
      ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/binders/:userId/:binderId
     * PURPOSE: Returns one binder with all its slots fully loaded.
     *          Used when opening a binder to view and edit pages.
     * @param userId    The user (used for future auth)
     * @param binderId  The binder to fetch
     * RESPONSE: 200 JSON Binder with full slots array
     *           404 if binder not found
     *           500 on database error
     */
    Method.GET / "api" / "binders" / string("userId") / string("binderId") -> handler {
      (_: String, binderId: String, _: Request) =>
        ZIO.serviceWithZIO[BinderService](_.getBinder(binderId))
          .map {
            case Some(b) => Response.json(b.toJson)
            case None    => Response.notFound
          }
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: PUT /api/binders/:userId/:binderId
     * PURPOSE: Updates a binder's name, cover image, and/or pocket size.
     *          Only the fields present in the body are updated.
     * @param userId    The user
     * @param binderId  The binder to update
     * BODY: UpdateBinderRequest JSON
     * RESPONSE: 200 {"ok": true}
     *           400 if request is malformed
     */
    Method.PUT / "api" / "binders" / string("userId") / string("binderId") -> handler {
      (_: String, binderId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[UpdateBinderRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- ZIO.foreach(parsed.name)(n =>
                      ZIO.serviceWithZIO[BinderService](_.renameBinder(binderId, n))
                    )
          _      <- ZIO.foreach(parsed.coverImage)(url =>
                      ZIO.serviceWithZIO[BinderService](_.setCover(binderId, url))
                    )
          // Resize, when requested. PocketSize.valueOf throws on anything
          // other than "Four" | "Nine" | "Twelve" — mapped to a 400 below,
          // same as the create route's validation.
          _      <- ZIO.foreach(parsed.pocketSize)(s =>
                      ZIO.attempt(PocketSize.valueOf(s))
                        .mapError(_ => RuntimeException(
                          s"Invalid pocket size '$s'. Must be Four, Nine, or Twelve."
                        ))
                        .flatMap(size =>
                          ZIO.serviceWithZIO[BinderService](_.resizeBinder(binderId, size))
                        )
                    )
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    /**
     * ROUTE: DELETE /api/binders/:userId/:binderId
     * PURPOSE: Permanently deletes a binder and all its slots.
     *          This cannot be undone.
     * @param userId    The user
     * @param binderId  The binder to delete
     * RESPONSE: 200 {"ok": true}
     *           500 on database error
     */
    Method.DELETE / "api" / "binders" / string("userId") / string("binderId") -> handler {
      (_: String, binderId: String, _: Request) =>
        ZIO.serviceWithZIO[BinderService](_.deleteBinder(binderId))
          .map(_ => Response.json("""{"ok": true}"""))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: PUT /api/binders/:userId/:binderId/slot/:slotIndex
     * PURPOSE: Places or removes a card from a specific binder slot.
     *          Send cardId as null or omit it to clear the slot.
     * @param userId     The user
     * @param binderId   The binder containing the slot
     * @param slotIndex  Which slot to update (0-based, across all pages)
     * BODY: SlotRequest JSON
     * RESPONSE: 200 {"ok": true}
     *           400 if slotIndex is out of range or body is malformed
     */
    Method.PUT / "api" / "binders" / string("userId") / string("binderId") / "slot" / int("slotIndex") -> handler {
      (_: String, binderId: String, slotIndex: Int, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[SlotRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- parsed.cardId match
                      case None =>
                        ZIO.serviceWithZIO[BinderService](_.removeCard(binderId, slotIndex))
                      case Some(cardId) =>
                        val card = Card(cardId, "", parsed.cardName.getOrElse(""),
                                        "", None, None,
                                        CardImage(parsed.imageUrl.getOrElse(""), ""), None, None)
                        ZIO.serviceWithZIO[BinderService](_.placeCard(binderId, slotIndex, card))
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    }
  )