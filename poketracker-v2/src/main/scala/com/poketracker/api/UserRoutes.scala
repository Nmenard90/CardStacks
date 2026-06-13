/**
 * FILE: UserRoutes.scala
 * PACKAGE: com.poketracker.api
 * LOCATION: src/main/scala/com/poketracker/api/UserRoutes.scala
 *
 * PURPOSE:
 *   HTTP endpoints for user accounts — registration, lookup, profile updates.
 *
 * ENDPOINTS:
 *   GET  /api/users                   — list all users (login screen chips)
 *   GET  /api/users/:username         — find user by username
 *   POST /api/users                   — register new user
 *   PUT  /api/users/:userId/location  — update location
 *
 * USED BY: Main.scala
 * DEPENDS ON: UserService
 */

package com.poketracker.api

import com.poketracker.service.UserService
import zio.*
import zio.http.*
import zio.json.*

/**
 * OBJECT: UserRoutes
 * PURPOSE: All HTTP routes for user account management.
 */
object UserRoutes:

  /**
   * CASE CLASS: RegisterRequest
   * PURPOSE: JSON body for the registration endpoint.
   * @param username  Desired username — must be unique across all users
   * @param email     Email address — must be unique across all users
   */
  private case class RegisterRequest(username: String, email: String)
  private given JsonDecoder[RegisterRequest] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: LocationRequest
   * PURPOSE: JSON body for the update location endpoint.
   * @param location  City-level location string e.g. "Austin, TX"
   */
  private case class LocationRequest(location: String)
  private given JsonDecoder[LocationRequest] = DeriveJsonDecoder.gen

  /**
   * VALUE: routes
   * PURPOSE: All user HTTP route definitions.
   * @return Routes[UserService, Nothing]
   */
  val routes: Routes[UserService, Nothing] = Routes(

    /**
     * ROUTE: GET /api/users
     * PURPOSE: Lists every registered user, ordered alphabetically by username.
     *          Used by the login screen to show "pick an existing user" chips.
     *          This path has exactly two segments so it never conflicts with
     *          GET /api/users/:username below, which requires three.
     * RESPONSE: 200 JSON array of User objects (empty array if none exist)
     *           500 on database error
     */
    Method.GET / "api" / "users" -> handler { (_: Request) =>
      ZIO.serviceWithZIO[UserService](_.listAll)
        .map(users => Response.json(users.toJson))
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: GET /api/users/:username
     * PURPOSE: Looks up a user by username. Used at login.
     * @param username  The username to look up
     * RESPONSE: 200 JSON User object if found
     *           404 if no user has this username
     *           500 on database error
     */
    Method.GET / "api" / "users" / string("username") -> handler { (username: String, _: Request) =>
      ZIO.serviceWithZIO[UserService](_.findByUsername(username))
        .map {
          case Some(user) => Response.json(user.toJson)
          case None       => Response.notFound
        }
        .catchAll(e => ZIO.succeed(Response.internalServerError(e.getMessage)))
    },

    /**
     * ROUTE: POST /api/users
     * PURPOSE: Registers a new user account.
     *          Returns 409 Conflict if username or email is already taken.
     * BODY: RegisterRequest JSON
     * RESPONSE: 201 JSON User object on success
     *           400 if request body is malformed
     *           409 if username or email already exists
     */
    Method.POST / "api" / "users" -> handler { (req: Request) =>
      (for
        body   <- req.body.asString
        parsed <- ZIO.fromEither(body.fromJson[RegisterRequest])
                    .mapError(e => RuntimeException(s"Bad request: $e"))
        user   <- ZIO.serviceWithZIO[UserService](_.register(parsed.username, parsed.email))
      yield Response.json(user.toJson).status(Status.Created)
      ).catchAll { e =>
        val status = if e.getMessage.contains("already") then Status.Conflict
                     else Status.BadRequest
        ZIO.succeed(Response(status = status, body = Body.fromString(e.getMessage)))
      }
    },

    /**
     * ROUTE: PUT /api/users/:userId/location
     * PURPOSE: Updates a user's city-level location for trade proximity matching.
     * @param userId  The user to update
     * BODY: LocationRequest JSON
     * RESPONSE: 200 {"ok": true} on success
     *           400 if location is empty or request is malformed
     */
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