/**
 * AuthRoutes — the one endpoint the frontend calls right after Supabase
 * sign-up/sign-in, before it can call anything else.
 *
 * HOW IT WORKS
 *   The frontend never knows our internal userId — it only holds a
 *   Supabase session. GET /api/auth/me sends that session's access token
 *   as a bearer token; `security.AuthGuard` verifies it and provisions (or
 *   looks up) the matching local profile row, which this route just
 *   echoes back as JSON. Every other endpoint in the app is keyed by the
 *   `id` this response returns.
 *
 * USED BY: web/src/context/UserContext (called once right after auth)
 * DEPENDS ON: security.AuthGuard (supplies the authenticated User)
 */

package com.poketracker.api

import com.poketracker.models.User
import zio.*
import zio.http.*
import zio.json.*

object AuthRoutes:

  val routes: Routes[User, Nothing] = Routes(
    Method.GET / "api" / "auth" / "me" -> handler { (_: Request) =>
      ZIO.serviceWith[User](user => Response.json(user.toJson))
    }
  )
