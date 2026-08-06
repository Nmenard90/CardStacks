/**
 * UserRoutes — HTTP endpoints for user accounts.
 *
 * HOW IT WORKS
 *   Pure request/response plumbing: parse the body, delegate to
 *   UserService, map the result to a Response. No business logic and no
 *   database access lives here.
 *
 * ENDPOINTS
 *   GET  /api/users                   — list all users (login screen chips)
 *   GET  /api/users/:username         — find user by username
 *   POST /api/users                   — register new user
 *   PUT  /api/users/:userId/location  — update location
 */

package com.poketracker.api

import com.poketracker.service.UserService
import zio.*
import zio.http.*
import zio.json.*

object UserRoutes:

  private case class RegisterRequest(username: String, email: String)
  private given JsonDecoder[RegisterRequest] = DeriveJsonDecoder.gen

  private case class LocationRequest(location: String)
  private given JsonDecoder[LocationRequest] = DeriveJsonDecoder.gen

  val routes: Routes[UserService, Nothing] = Routes(

    Method.GET / "api" / "users" -> handler { (_: Request) =>
      ZIO.serviceWithZIO[UserService](_.listAll)
        .map(users => Response.json(users.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.GET / "api" / "users" / string("username") -> handler { (username: String, _: Request) =>
      ZIO.serviceWithZIO[UserService](_.findByUsername(username))
        .map {
          case Some(user) => Response.json(user.toJson)
          case None       => Response.notFound
        }
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    Method.POST / "api" / "users" -> handler { (req: Request) =>
      (for
        body   <- req.body.asString
        parsed <- ZIO.fromEither(body.fromJson[RegisterRequest])
                    .mapError(e => RuntimeException(s"Bad request: $e"))
        user   <- ZIO.serviceWithZIO[UserService](_.register(parsed.username, parsed.email))
      yield Response.json(user.toJson).status(Status.Created)
      ).catchAll { e =>
        // UserService.register signals "already taken" via message text
        // (see that file) rather than a typed error — matched here so the
        // client gets 409 instead of a generic 400 and can show the right copy.
        val status = if e.getMessage.contains("already") then Status.Conflict
                     else Status.BadRequest
        ZIO.succeed(Response(status = status, body = Body.fromString(e.getMessage)))
      }
    },

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
