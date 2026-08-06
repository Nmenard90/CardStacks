/**
 * CollectionRoutes — HTTP endpoints for a user's card collection.
 *
 * HOW IT WORKS
 *   Pure request/response plumbing over CollectionService. Writes also go
 *   through CardService.ensureCached first, so a card's catalog row
 *   (name/number/prices) always exists before a collection entry can
 *   reference it — the guard against orphaned owned-card rows.
 *
 * ENDPOINTS
 *   GET  /api/collection/:userId          — full collection
 *   GET  /api/collection/:userId/owned    — owned cards with full card data
 *   GET  /api/collection/:userId/stats    — collection statistics
 *   POST /api/collection/:userId/:cardId  — update one card entry
 *   POST /api/collection/:userId/bulk     — update many cards at once
 */

package com.poketracker.api

import com.poketracker.models.*
import com.poketracker.service.{CardService, CollectionService, CollectionStats}
import zio.*
import zio.http.*
import zio.json.*

object CollectionRoutes:

  private case class UpdateEntryRequest(
    conditions:   List[ConditionCount],
    selectedCond: String
  )
  private given JsonDecoder[UpdateEntryRequest] = DeriveJsonDecoder.gen

  private case class BulkUpdateItem(
    cardId:       String,
    conditions:   List[ConditionCount],
    selectedCond: String
  )
  private given JsonDecoder[BulkUpdateItem] = DeriveJsonDecoder.gen

  val routes: Routes[CollectionService & CardService, Nothing] = Routes(

    Method.GET / "api" / "collection" / string("userId") -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[CollectionService](_.getCollection(userId))
        .map(entries => Response.json(entries.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "collection" / string("userId") / "owned" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[CollectionService](_.getOwnedCards(userId))
        .map(cards => Response.json(cards.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "collection" / string("userId") / "stats" -> handler { (userId: String, _: Request) =>
      ZIO.serviceWithZIO[CollectionService](_.getStats(userId))
        .map(stats => Response.json(stats.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.POST / "api" / "collection" / string("userId") / string("cardId") -> handler {
      (userId: String, cardId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[UpdateEntryRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          // Must run before updateEntry — see file header.
          _      <- ZIO.serviceWithZIO[CardService](_.ensureCached(List(cardId)))
          result <- ZIO.serviceWithZIO[CollectionService](
                      _.updateEntry(userId, cardId, parsed.conditions, parsed.selectedCond)
                    )
        // All-zero conditions deletes the entry (see CollectionService.updateEntry).
        yield result match
          case Some(entry) => Response.json(entry.toJson)
          case None        => Response.json("""{"deleted": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.POST / "api" / "collection" / string("userId") / "bulk" -> handler {
      (userId: String, req: Request) =>
        (for
          body  <- req.body.asString
          items <- ZIO.fromEither(body.fromJson[List[BulkUpdateItem]])
                     .mapError(e => RuntimeException(s"Bad request: $e"))
          _     <- ZIO.serviceWithZIO[CardService](_.ensureCached(items.map(_.cardId)))
          _     <- ZIO.serviceWithZIO[CollectionService](
                     _.bulkUpdate(userId, items.map(i => (i.cardId, i.conditions, i.selectedCond)))
                   )
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    }
  )
