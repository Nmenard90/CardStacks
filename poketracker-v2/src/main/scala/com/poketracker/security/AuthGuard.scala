/**
 * AuthGuard — the one place every request under /api (other than the
 * public catalog endpoints) gets checked for a valid Supabase session
 * before it reaches a route handler.
 *
 * HOW IT WORKS
 *   Wraps the protected route group in Main.scala with a zio-http
 *   "providing" aspect: it verifies the caller's bearer token
 *   (SupabaseJwtVerifier.verify), turns its claims into our local User
 *   profile (UserService.findOrCreateFromAuth), and makes that User
 *   available to any handler that asks for it via `ZIO.service[User]`
 *   (see AuthRoutes).
 *
 *   It also closes the door this app used to leave open: almost every
 *   endpoint takes a `userId` as a path segment (`/api/spaces/:userId/...`,
 *   `/api/binders/:userId/...`, etc.) and, until now, trusted whatever the
 *   client sent — anyone who learned another user's id could read or edit
 *   their entire collection. `requiredOwnerUserId` recognizes that shape
 *   generically from the path and rejects the request with 403 unless the
 *   path's userId matches the authenticated caller's.
 *
 *   KNOWN LIMITATION: a handful of endpoints are keyed only by an internal
 *   object id with no userId in the path at all (`/api/storage/boxes/:id`,
 *   `/api/storage/drawers/:id`, `/api/storage/drawers/:id/cards`) — those
 *   are authenticated but not yet ownership-checked here, since that needs
 *   a DB lookup per object rather than a path pattern. Pre-existing gap,
 *   not introduced by this change; tracked in BUGS.md.
 *
 * USED BY: Main.scala
 * DEPENDS ON: security.SupabaseJwtVerifier, service.UserService
 */

package com.poketracker.security

import com.poketracker.models.User
import com.poketracker.service.UserService
import zio.*
import zio.http.*

object AuthGuard:

  /** Resource segments where the very next path segment is always a userId. */
  private val userScopedResources = Set("binders", "collection", "spaces", "shelf")

  private def isPublic(req: Request): Boolean =
    if req.method == Method.OPTIONS then true // CORS preflight carries no auth header
    else
      val p = req.url.path.toString
      p == "/health" || p == "/api/sets" || p == "/api/search" ||
        p.startsWith("/api/cards") || p.startsWith("/api/admin")

  /** None = no ownership check applies to this path (either it's not
   *  user-scoped, or it's the known-limitation case above). */
  private def requiredOwnerUserId(req: Request): Option[String] =
    val segs = req.url.path.toString.split("/").filter(_.nonEmpty).toList
    segs match
      case "api" :: resource :: userId :: _ if userScopedResources.contains(resource) => Some(userId)
      case "api" :: "storage" :: seg :: _ if seg != "boxes" && seg != "drawers"        => Some(seg)
      case "api" :: "users" :: userId :: "location" :: Nil                             => Some(userId)
      case _ => None

  private def jsonError(status: Status, message: String): Response =
    Response(status = status, body = Body.fromString(s"""{"error":"${message.replace("\"", "'")}"}"""))
    .addHeader(Header.ContentType(MediaType.application.json))

  private val missingToken  = jsonError(Status.Unauthorized, "Missing or malformed Authorization header")
  private val notAnOwner    = jsonError(Status.Forbidden, "You do not have access to this resource")

  val aspect: HandlerAspect[UserService & SupabaseJwtVerifier, User] =
    Middleware.customAuthProvidingZIO[UserService & SupabaseJwtVerifier, User](
      (req: Request) =>
        if isPublic(req) then
          ZIO.succeed(None)
        else
          req.header(Header.Authorization) match
            case Some(Header.Authorization.Bearer(token)) =>
              for
                claims <- ZIO.serviceWithZIO[SupabaseJwtVerifier](_.verify(token.value.asString))
                            .mapError(reason => jsonError(Status.Unauthorized, reason))
                user   <- ZIO.serviceWithZIO[UserService](
                            _.findOrCreateFromAuth(claims.subject, claims.email, claims.username, claims.isAnonymous)
                          ).tapErrorCause(cause => ZIO.logErrorCause("findOrCreateFromAuth failed", cause))
                           .orElseFail(jsonError(Status.InternalServerError, "Could not load your profile"))
                _      <- requiredOwnerUserId(req) match
                            case Some(claimedUserId) if claimedUserId != user.id => ZIO.fail(notAnOwner)
                            case _                                               => ZIO.unit
              yield Some(user)
            case _ => ZIO.fail(missingToken)
      ,
      Headers.empty,
      Status.Unauthorized
    )
