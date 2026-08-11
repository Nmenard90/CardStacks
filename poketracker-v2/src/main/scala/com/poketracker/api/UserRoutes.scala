/**
 * UserRoutes — the one remaining plain profile-mutation endpoint that
 * doesn't belong in AuthRoutes.
 *
 * HOW IT WORKS
 *   Pure request/response plumbing: parse the body, delegate to
 *   UserService, map the result to a Response. No business logic and no
 *   database access lives here. Ownership (the `userId` in the path must
 *   match the caller) is enforced upstream by `security.AuthGuard`, not here.
 *
 * ENDPOINTS
 *   PUT /api/users/:userId/location — update location
 */

package com.poketracker.api

import com.poketracker.service.UserService
import zio.*
import zio.http.*
import zio.json.*

object UserRoutes:

  private case class LocationRequest(location: String)
  private given JsonDecoder[LocationRequest] = DeriveJsonDecoder.gen

  val routes: Routes[UserService, Nothing] = Routes(

    Method.PUT / "api" / "users" / string("userId") / "location" -> handler {
      (userId: String, req: Request) =>
        (for
          body   <- req.body.asString
          parsed <- ZIO.fromEither(body.fromJson[LocationRequest])
                      .mapError(e => RuntimeException(s"Bad request: $e"))
          _      <- ZIO.serviceWithZIO[UserService](_.updateLocation(userId, parsed.location))
        yield Response.json("""{"ok": true}""")
        ).catchAll(e => ZIO.succeed(Response.badRequest(e.getMessage)))
    }
  )
