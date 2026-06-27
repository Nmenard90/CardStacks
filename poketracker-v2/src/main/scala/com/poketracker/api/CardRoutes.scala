/**
 * FILE: CardRoutes.scala
 * PACKAGE: com.poketracker.api
 * LOCATION: src/main/scala/com/poketracker/api/CardRoutes.scala
 *
 * PURPOSE:
 *   Defines all HTTP endpoints related to cards and sets.
 *   Receives HTTP requests, calls CardService, returns JSON responses.
 *   This is the only place that knows about HTTP — services and repositories
 *   have no knowledge of HTTP at all.
 *
 * ENDPOINTS:
 *   GET /api/sets              — all sets, newest first
 *   GET /api/cards/:setId      — all cards in a set with prices
 *   GET /api/cards/id/:cardId  — single card by ID
 *   GET /api/search?q=name     — search cards by name
 *   GET /api/admin/refresh/:setId — force re-fetch a set from the API
 *
 * HOW ZIO HTTP ROUTES WORK:
 *   Routes are defined as pattern matches on the HTTP method and URL path.
 *   Each branch returns a ZIO effect that produces an HTTP Response.
 *   ZIO HTTP matches incoming requests against these patterns in order
 *   and runs the first match.
 *
 *   Pattern syntax:
 *     Method.GET / "api" / "sets"           matches GET /api/sets
 *     Method.GET / "api" / "cards" / string("setId")  matches GET /api/cards/sv1
 *                                           and gives us setId = "sv1"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.service.CardService
 *     The service this route file delegates all business logic to.
 *     Routes never contain business logic — they only handle HTTP.
 *
 *   zio.*
 *     ZIO core — ZIO, Task, ZLayer, ZIO.serviceWithZIO.
 *
 *   zio.http.*
 *     Routes, Method, Handler, Response, Status — ZIO HTTP types.
 *     Routes is the collection of route definitions.
 *     Method.GET/POST etc are the HTTP methods.
 *     Response.json builds a JSON HTTP response.
 *     Status.NotFound, Status.InternalServerError etc are HTTP status codes.
 *
 *   zio.json.*
 *     .toJson extension method — converts any type with a JsonEncoder to JSON string.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: Main.scala
 * DEPENDS ON: CardService
 */

package com.poketracker.api

import com.poketracker.service.CardService
import zio.*
import zio.http.*
import zio.json.*

/**
 * OBJECT: CardRoutes
 * PURPOSE: Defines and provides all card-related HTTP routes.
 */
object CardRoutes:

  /**
   * VALUE: routes
   * PURPOSE: The collection of all card-related HTTP route definitions.
   *          Returned as Routes[CardService, Nothing] which means:
   *            CardService = what these routes need to run (injected by ZIO)
   *            Nothing     = these routes themselves cannot fail
   *                          (errors are caught and returned as HTTP responses)
   *
   * NOTE ON ERROR HANDLING:
   *   Every route wraps its logic in .catchAll which converts any ZIO failure
   *   into an appropriate HTTP error response. This means the server never
   *   crashes on a failed request — it always returns a proper HTTP response.
   *
   * @return Routes[CardService, Nothing]
   */
  val routes: Routes[CardService, Nothing] = Routes(

    /**
     * ROUTE: GET /api/sets
     * PURPOSE: Returns all Pokémon TCG sets ordered newest first.
     *          Used to populate the set selector dropdown in the UI.
     * RESPONSE: 200 JSON array of CardSet objects
     *           500 if an unexpected error occurs
     */
    Method.GET / "api" / "sets" -> handler {
      ZIO.serviceWithZIO[CardService](_.getSets)
        .map(sets => Response.json(sets.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/cards/:setId
     * PURPOSE: Returns all cards in a set with their prices.
     *          If the set is not cached, fetches from the Pokémon TCG API.
     * @param setId  Set ID from the URL path e.g. "sv1", "me2pt5"
     * RESPONSE: 200 JSON array of Card objects
     *           500 if fetch or database error
     */
    Method.GET / "api" / "cards" / string("setId") -> handler { (setId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.getCardsBySet(setId))
        .map(cards => Response.json(cards.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/cards/id/:cardId
     * PURPOSE: Returns a single card by its ID with prices.
     *          Used when the trade analyzer needs full card details.
     * @param cardId  Card ID from the URL path e.g. "sv1-1"
     * RESPONSE: 200 JSON Card object if found
     *           404 if no card has this ID
     *           500 if database error
     */
    Method.GET / "api" / "cards" / "id" / string("cardId") -> handler { (cardId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.getCardById(cardId))
        .map {
          case Some(card) => Response.json(card.toJson)
          case None       => Response.notFound
        }
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/search?q=query
     * PURPOSE: Searches all cards by name across all cached sets.
     *          Used by the trade analyzer search box.
     * @param q  Query parameter — the search term e.g. "Charizard"
     * RESPONSE: 200 JSON array of matching Card objects (max 60)
     *           400 if query parameter is missing or too short
     *           500 if database error
     */
    Method.GET / "api" / "search" -> handler { (req: Request) =>
      val query = req.url.queryParams.getAll("q").headOption.getOrElse("")
      if query.length < 2 then
        ZIO.succeed(Response.badRequest("Query must be at least 2 characters"))
      else
        ZIO.serviceWithZIO[CardService](_.searchCards(query))
          .map(cards => Response.json(cards.toJson))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/admin/refresh/:setId
     * PURPOSE: Forces a re-fetch of a set from the Pokémon TCG API.
     *          Use this when a new set is released to pull in the new cards.
     * @param setId  The set ID to refresh e.g. "sv9"
     * RESPONSE: 200 JSON {"ok": true} on success
     *           500 if the API fetch fails
     */
    Method.GET / "api" / "admin" / "refresh" / string("setId") -> handler { (setId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.refreshSet(setId))
        .map(_ => Response.json("""{"ok": true}"""))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/admin/refresh-orphans
     * PURPOSE: One-shot repair. Finds every card a user owns that is missing
     *          from the catalog (renders blank/$0) and backfills its set from
     *          the API. Run once to fix existing data; new saves can't create
     *          orphans because the save path calls ensureCached.
     * RESPONSE: 200 JSON {"setsRefreshed": N} on success
     *           500 if the repair fails
     */
    Method.GET / "api" / "admin" / "refresh-orphans" -> handler { (_: Request) =>
      ZIO.serviceWithZIO[CardService](_.refreshOrphans)
        .map(n => Response.json(s"""{"setsRefreshed": $n}"""))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    }
  )