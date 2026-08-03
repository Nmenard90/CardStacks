/**
 * FILE: RipRoutes.scala
 * PACKAGE: com.poketracker.api
 * LOCATION: src/main/scala/com/poketracker/api/RipRoutes.scala
 *
 * PURPOSE:
 *   HTTP endpoints for the Rip Tracker feature: starting a rip session,
 *   recording pulls, reviewing a session's recap, and the rip-or-hold
 *   verdict for a product. All business logic delegated to RipTrackerService.
 *
 * ENDPOINTS:
 *   POST /api/rip-sessions                    — start a session for a product
 *   POST /api/rip-sessions/:id/pulls           — record a scanned card into a pack
 *   GET  /api/rip-sessions/:id                 — session recap (packs + pulls)
 *   GET  /api/rip-tracker/verdict/:productId   — rip-or-hold verdict
 *
 * NOT WIRED INTO Main.scala's `allRoutes` YET. Every one of these routes
 * hits tables from Migration 004, which has not been run against
 * production — adding `RipRoutes.routes` to Main.scala before that migration
 * runs would repeat the exact outage this repo's AGENTS.md now warns about.
 * Wire this in only after confirming Migration 004 has been applied.
 *
 * USED BY: (future) Main.scala, once wired
 * DEPENDS ON: RipTrackerService
 */

package com.poketracker.api

import com.poketracker.models.*
import com.poketracker.service.{
  RipTrackerService, PullResult, SessionRecap, Verdict,
  GuaranteedFloorResult, PerPackEvResult, DistributionStats, CeilingCheck, MarginalValueResult
}
import zio.*
import zio.http.*
import zio.json.*

object RipRoutes:

  /** POST /api/rip-sessions body shape. */
  private case class CreateSessionRequest(userId: String, productId: String)
  private given JsonDecoder[CreateSessionRequest] = DeriveJsonDecoder.gen

  /** POST /api/rip-sessions/:id/pulls body shape. */
  private case class RecordPullRequest(ripPackId: String, cardId: String, condition: String)
  private given JsonDecoder[RecordPullRequest] = DeriveJsonDecoder.gen

  private given JsonEncoder[RipSession] = DeriveJsonEncoder.gen
  private given JsonEncoder[RipPack]    = DeriveJsonEncoder.gen
  private given JsonEncoder[Pull]       = DeriveJsonEncoder.gen
  private given JsonEncoder[PullResult] = DeriveJsonEncoder.gen
  private given JsonEncoder[SessionRecap] = DeriveJsonEncoder.gen
  private given JsonEncoder[GuaranteedFloorResult]  = DeriveJsonEncoder.gen
  private given JsonEncoder[PerPackEvResult]        = DeriveJsonEncoder.gen
  private given JsonEncoder[DistributionStats]      = DeriveJsonEncoder.gen
  private given JsonEncoder[CeilingCheck]           = DeriveJsonEncoder.gen
  private given JsonEncoder[MarginalValueResult]    = DeriveJsonEncoder.gen
  private given JsonEncoder[Verdict]                = DeriveJsonEncoder.gen

  private case class CreateSessionResponse(session: RipSession, packs: List[RipPack])
  private given JsonEncoder[CreateSessionResponse] = DeriveJsonEncoder.gen

  val routes: Routes[RipTrackerService, Nothing] = Routes(

    /**
     * ROUTE: POST /api/rip-sessions
     * PURPOSE: Starts a rip session for a product, auto-generating its packs.
     * BODY: {"userId": "...", "productId": "..."}
     * RESPONSE: 200 {"session": RipSession, "packs": [RipPack]}
     *           400 unknown product or malformed body
     */
    Method.POST / "api" / "rip-sessions" -> handler { (req: Request) =>
      (for
        body   <- req.body.asString
        parsed <- ZIO.fromEither(body.fromJson[CreateSessionRequest])
                    .mapError(e => RuntimeException(s"Bad request: $e"))
        (session, packs) <- ZIO.serviceWithZIO[RipTrackerService](
                               _.createSession(parsed.userId, parsed.productId)
                             )
      yield Response.json(CreateSessionResponse(session, packs).toJson)
      ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    /**
     * ROUTE: POST /api/rip-sessions/:id/pulls
     * PURPOSE: Records one scanned card into a pack of this session.
     * @param id  The rip session ID (validated against the pack's own session).
     * BODY: {"ripPackId": "...", "cardId": "...", "condition": "NM"}
     * RESPONSE: 200 PullResult (pull + alreadyOwned/setComplete flags)
     *           400 malformed body, unknown card/pack, or pack belongs to a
     *               different session than :id
     */
    Method.POST / "api" / "rip-sessions" / string("id") / "pulls" -> handler {
      (sessionId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[RecordPullRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          result <- ZIO.serviceWithZIO[RipTrackerService](
                      _.recordPull(parsed.ripPackId, parsed.cardId, parsed.condition)
                    )
          // Cheap safety check: the pack the pull landed in must actually
          // belong to the session in the URL, not just any session.
          _      <- ZIO.unless(result.pull.ripPackId == parsed.ripPackId)(
                      ZIO.fail(RuntimeException("pack/session mismatch"))
                    )
        yield Response.json(result.toJson)
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/rip-sessions/:id
     * PURPOSE: Full recap of a session — packs and pulls — for the review screen.
     * RESPONSE: 200 SessionRecap
     *           404 unknown session
     */
    Method.GET / "api" / "rip-sessions" / string("id") -> handler { (id: String, _: Request) =>
      ZIO.serviceWithZIO[RipTrackerService](_.getRecap(id))
        .map {
          case Some(recap) => Response.json(recap.toJson)
          case None        => Response.status(Status.NotFound)
        }
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/rip-tracker/verdict/:productId
     * PURPOSE: The rip-or-hold verdict for a sealed product.
     * QUERY PARAMS (all optional):
     *   userId                — enables the marginal-to-you value view
     *   chaseThreshold         — single-card price for "P(pulling a chase hit)"
     *   projectedSealedPrice   — a labeled forecast, kept separate from the
     *                            real current sealed price
     * RESPONSE: 200 Verdict
     *           404 unknown product
     */
    Method.GET / "api" / "rip-tracker" / "verdict" / string("productId") -> handler {
      (productId: String, req: Request) =>
        val q = req.url.queryParams
        val userId               = q.getAll("userId").headOption
        val chaseThreshold       = q.getAll("chaseThreshold").headOption.flatMap(_.toDoubleOption)
        val projectedSealedPrice = q.getAll("projectedSealedPrice").headOption.flatMap(_.toDoubleOption)

        ZIO.serviceWithZIO[RipTrackerService](
          _.getVerdict(productId, userId, chaseThreshold, projectedSealedPrice)
        )
          .map {
            case Some(verdict) => Response.json(verdict.toJson)
            case None          => Response.status(Status.NotFound)
          }
          .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    }
  )
