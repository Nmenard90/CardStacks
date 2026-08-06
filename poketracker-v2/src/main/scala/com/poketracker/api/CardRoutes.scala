/**
 * CardRoutes — HTTP endpoints for cards and sets.
 *
 * HOW IT WORKS
 *   Pure request/response plumbing over CardService — the only place in
 *   the app that knows about HTTP; services/repositories don't.
 *
 * ENDPOINTS
 *   GET /api/sets                          — all sets, newest first
 *   GET /api/cards/:setId                  — all cards in a set with prices
 *   GET /api/cards/id/:cardId              — single card by ID
 *   GET /api/cards/id/:cardId/price-history
 *   GET /api/search?q=name                 — search cards by name
 *   GET /api/admin/refresh/:setId          — force re-fetch a set from the API
 *   GET /api/admin/refresh-prices/:setId   — re-fetch prices only
 *   GET /api/admin/refresh-orphans         — repair owned-but-uncached cards
 */

package com.poketracker.api

import com.poketracker.service.CardService
import zio.*
import zio.http.*
import zio.json.*

object CardRoutes:

  val routes: Routes[CardService, Nothing] = Routes(

    Method.GET / "api" / "sets" -> handler {
      ZIO.serviceWithZIO[CardService](_.getSets)
        .map(sets => Response.json(sets.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "cards" / string("setId") -> handler { (setId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.getCardsBySet(setId))
        .map(cards => Response.json(cards.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "cards" / "id" / string("cardId") -> handler { (cardId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.getCardById(cardId))
        .map {
          case Some(card) => Response.json(card.toJson)
          case None       => Response.notFound
        }
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "cards" / "id" / string("cardId") / "price-history" -> handler { (cardId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.getPriceHistory(cardId))
        .map(points => Response.json(points.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "search" -> handler { (req: Request) =>
      val query = req.url.queryParams.getAll("q").headOption.getOrElse("")
      if query.length < 2 then
        ZIO.succeed(Response.badRequest("Query must be at least 2 characters"))
      else
        ZIO.serviceWithZIO[CardService](_.searchCards(query))
          .map(cards => Response.json(cards.toJson))
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "admin" / "refresh" / string("setId") -> handler { (setId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.refreshSet(setId))
        .map(_ => Response.json("""{"ok": true}"""))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "admin" / "refresh-prices" / string("setId") -> handler { (setId: String, _: Request) =>
      ZIO.serviceWithZIO[CardService](_.refreshPrices(setId))
        .map(_ => Response.json("""{"ok": true}"""))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "admin" / "refresh-orphans" -> handler { (_: Request) =>
      ZIO.serviceWithZIO[CardService](_.refreshOrphans)
        .map(n => Response.json(s"""{"setsRefreshed": $n}"""))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    }
  )
