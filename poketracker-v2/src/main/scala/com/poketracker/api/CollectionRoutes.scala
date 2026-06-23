/**
 * FILE: CollectionRoutes.scala
 * PACKAGE: com.poketracker.api
 * LOCATION: src/main/scala/com/poketracker/api/CollectionRoutes.scala
 *
 * PURPOSE:
 *   HTTP endpoints for managing a user's card collection.
 *   All business logic delegated to CollectionService.
 *
 * ENDPOINTS:
 *   GET  /api/collection/:userId          — get full collection
 *   GET  /api/collection/:userId/stats    — get collection statistics
 *   POST /api/collection/:userId/:cardId  — update one card entry
 *   POST /api/collection/:userId/bulk     — update many cards at once
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.models.*
 *     ConditionCount — the per-condition quantity type used in request bodies.
 *
 *   com.poketracker.service.CollectionService
 *     Service this file delegates all logic to.
 *     Also imports CollectionStats from this package.
 *
 *   zio.* / zio.http.* / zio.json.*
 *     Standard ZIO, HTTP, and JSON imports used by all route files.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: Main.scala
 * DEPENDS ON: CollectionService
 */

package com.poketracker.api

import com.poketracker.models.*
import com.poketracker.service.{CollectionService, CollectionStats}
import zio.*
import zio.http.*
import zio.json.*

/**
 * OBJECT: CollectionRoutes
 * PURPOSE: All HTTP routes for collection management.
 */
object CollectionRoutes:

  /**
   * CASE CLASS: UpdateEntryRequest
   * PURPOSE: JSON body shape expected by the single-card update endpoint.
   * @param conditions   New list of condition/quantity pairs for this card
   * @param selectedCond Which condition tab is active in the UI
   */
  private case class UpdateEntryRequest(
    conditions:   List[ConditionCount],
    selectedCond: String
  )
  private given JsonDecoder[UpdateEntryRequest] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: BulkUpdateItem
   * PURPOSE: One item in a bulk update request body array.
   * @param cardId       The card to update
   * @param conditions   New condition quantities for this card
   * @param selectedCond Active condition tab for this card in the UI
   */
  private case class BulkUpdateItem(
    cardId:       String,
    conditions:   List[ConditionCount],
    selectedCond: String
  )
  private given JsonDecoder[BulkUpdateItem] = DeriveJsonDecoder.gen

  /**
   * VALUE: routes
   * PURPOSE: All collection HTTP route definitions.
   * @return Routes[CollectionService, Nothing]
   */
  val routes: Routes[CollectionService, Nothing] = Routes(

    /**
     * ROUTE: GET /api/collection/:userId
     * PURPOSE: Returns a user's entire collection.
     * @param userId  The user whose collection to fetch
     * RESPONSE: 200 JSON array of CollectionEntry objects
     *           500 on database error
     */
    Method.GET / "api" / "collection" / string("userId") -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[CollectionService](_.getCollection(userId))
        .map(entries => Response.json(entries.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/collection/:userId/owned
     * PURPOSE: Returns all cards owned by a user, each with full card details.
     *          Used by the My Collection page to avoid N+1 per-card lookups.
     * @param userId  The user
     * RESPONSE: 200 JSON array of OwnedCard objects
     *           500 on database error
     */
    Method.GET / "api" / "collection" / string("userId") / "owned" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[CollectionService](_.getOwnedCards(userId))
        .map(cards => Response.json(cards.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/collection/:userId/stats
     * PURPOSE: Returns summary statistics for a user's collection.
     *          Includes total cards, unique cards, total value, sets entered.
     * @param userId  The user
     * RESPONSE: 200 JSON CollectionStats object
     *           500 on database error
     */
    Method.GET / "api" / "collection" / string("userId") / "stats" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[CollectionService](_.getStats(userId))
        .map(stats => Response.json(stats.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: POST /api/collection/:userId/:cardId
     * PURPOSE: Creates or updates one card entry in a user's collection.
     *          If all quantities in the body are zero, deletes the entry.
     * @param userId  The user
     * @param cardId  The card to update
     * BODY: UpdateEntryRequest JSON
     * RESPONSE: 200 JSON updated CollectionEntry
     *           200 {"deleted": true} if all quantities were zero
     *           400 if request body is malformed
     *           500 on database error
     */
    Method.POST / "api" / "collection" / string("userId") / string("cardId") -> handler {
      (userId: String, cardId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[UpdateEntryRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          result <- ZIO.serviceWithZIO[CollectionService](
                      _.updateEntry(userId, cardId, parsed.conditions, parsed.selectedCond)
                    )
        yield result match
          case Some(entry) => Response.json(entry.toJson)
          case None        => Response.json("""{"deleted": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    /**
     * ROUTE: POST /api/collection/:userId/bulk
     * PURPOSE: Updates many collection entries at once in a single transaction.
     *          More efficient than calling the single-card endpoint repeatedly.
     *          Used when importing a collection from CSV.
     * @param userId  The user
     * BODY: JSON array of BulkUpdateItem
     * RESPONSE: 200 {"ok": true} on success
     *           400 if request body is malformed
     *           500 on database error
     */
    Method.POST / "api" / "collection" / string("userId") / "bulk" -> handler {
      (userId: String, req: Request) =>
        (for
          body  <- req.body.asString
          items <- ZIO.fromEither(body.fromJson[List[BulkUpdateItem]])
                     .mapError(e => RuntimeException(s"Bad request: $e"))
          _     <- ZIO.serviceWithZIO[CollectionService](
                     _.bulkUpdate(userId, items.map(i => (i.cardId, i.conditions, i.selectedCond)))
                   )
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    }
  )