/**
 * RipRoutes — HTTP endpoints for the Rip Tracker feature (box-opening
 * sessions and the rip-or-hold verdict). All logic lives in RipTrackerService.
 *
 * NOT WIRED IN — every route here needs a DB migration that hasn't run
 * against production yet. Adding this to Main.scala before then repeats
 * an outage that already happened once.
 *
 * ENDPOINTS
 *   POST /api/rip-sessions                    — start a session for a product
 *   POST /api/rip-sessions/:id/pulls           — record a scanned card into a pack
 *   GET  /api/rip-sessions/:id                 — session recap (packs + pulls)
 *   GET  /api/rip-tracker/verdict/:productId   — rip-or-hold verdict
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

  private case class CreateSessionRequest(userId: String, productId: String)
  private given JsonDecoder[CreateSessionRequest] = DeriveJsonDecoder.gen

  private case class RecordPullRequest(ripPackId: String, cardId: String, condition: String)
  private given JsonDecoder[RecordPullRequest] = DeriveJsonDecoder.gen

  // None of these model types carry their own JsonEncoder, so this file
  // derives each right where it's needed to build a response.
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

  // Verdict is composed of the types above, so its encoder must come after them.
  private given JsonEncoder[Verdict]                = DeriveJsonEncoder.gen

  private case class CreateSessionResponse(session: RipSession, packs: List[RipPack])
  private given JsonEncoder[CreateSessionResponse] = DeriveJsonEncoder.gen

  val routes: Routes[RipTrackerService, Nothing] = Routes(

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

    Method.POST / "api" / "rip-sessions" / string("id") / "pulls" -> handler {
      (sessionId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[RecordPullRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          result <- ZIO.serviceWithZIO[RipTrackerService](
                      _.recordPull(parsed.ripPackId, parsed.cardId, parsed.condition)
                    )
          // Defense against a client sending a packId that belongs to a
          // different session than the one in the URL.
          _      <- ZIO.unless(result.pull.ripPackId == parsed.ripPackId)(
                      ZIO.fail(RuntimeException("pack/session mismatch"))
                    )
        yield Response.json(result.toJson)
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    },

    Method.GET / "api" / "rip-sessions" / string("id") -> handler { (id: String, _: Request) =>
      ZIO.serviceWithZIO[RipTrackerService](_.getRecap(id))
        .map {
          case Some(recap) => Response.json(recap.toJson)
          case None        => Response.status(Status.NotFound)
        }
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "rip-tracker" / "verdict" / string("productId") -> handler {
      (productId: String, req: Request) =>
        val q = req.url.queryParams
        val userId               = q.getAll("userId").headOption
        // A non-numeric value is silently treated as absent, not an error.
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
