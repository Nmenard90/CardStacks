/**
 * UserService — business logic for user accounts: profile provisioning,
 * lookup, updates, reputation.
 *
 * HOW IT WORKS
 *   Passwords and identity live entirely in Supabase Auth — this service
 *   never sees one. `findOrCreateFromAuth` is the only entry point that
 *   creates a row: it's called once per request by `security.AuthGuard`
 *   after a Supabase access token has already been cryptographically
 *   verified, and turns that token's claims into (or looks up) our own
 *   local profile row, which is what the rest of the backend (collections,
 *   binders, storage...) actually references by id.
 *
 * USED BY: security.AuthGuard, UserRoutes
 * DEPENDS ON: UserRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.UserRepository
import zio.*
import java.time.Instant
import java.util.UUID

trait UserService:

  /** Looks up the local profile linked to a verified Supabase user id,
   *  creating one (with a unique username derived from sign-up metadata)
   *  the first time that Supabase account is ever seen. */
  def findOrCreateFromAuth(supabaseUserId: String, email: Option[String], desiredUsername: Option[String]): Task[User]

  def findByUsername(username: String): Task[Option[User]]

  /** City-level only, never an exact address. */
  def updateLocation(userId: String, location: String): Task[Unit]

  /** Recalculates and persists reputation. Called after a trade rating is submitted. */
  def refreshReputation(userId: String): Task[Int]

  /** True once a user has 3+ reports — the warning-badge threshold. */
  def getReputationStatus(userId: String): Task[Boolean]

object UserService:

  final class Live(repo: UserRepository) extends UserService:

    def findOrCreateFromAuth(supabaseUserId: String, email: Option[String], desiredUsername: Option[String]): Task[User] =
      repo.findBySupabaseUserId(supabaseUserId).flatMap {
        case Some(user) => ZIO.succeed(user)
        case None =>
          val requested = desiredUsername.map(_.trim).filter(_.nonEmpty)
            .getOrElse(s"collector-${supabaseUserId.take(8)}")
          for
            username <- uniqueUsername(requested)
            id        = UUID.randomUUID().toString
            user      = User(
                          id             = id,
                          supabaseUserId = supabaseUserId,
                          username       = username,
                          email          = email.getOrElse(s"$supabaseUserId@users.noreply"),
                          role           = UserRole.Collector,
                          reputation     = 0,
                          location       = None,
                          createdAt      = Instant.now()
                        )
            _        <- repo.create(user)
          yield user
      }

    /** Appends -2, -3, ... until the username is free — the caller picked
     *  it at sign-up, so a collision should be rare, not an error. */
    private def uniqueUsername(base: String): Task[String] =
      def attempt(candidate: String, suffix: Int): Task[String] =
        repo.findByUsername(candidate).flatMap {
          case None    => ZIO.succeed(candidate)
          case Some(_) => attempt(s"$base-$suffix", suffix + 1)
        }
      attempt(base, 2)

    def findByUsername(username: String): Task[Option[User]] =
      repo.findByUsername(username)

    def updateLocation(userId: String, location: String): Task[Unit] =
      ZIO.when(location.trim.isEmpty)(
        ZIO.fail(new IllegalArgumentException("Location cannot be empty"))
      ) *> repo.updateLocation(userId, location.trim)

    def refreshReputation(userId: String): Task[Int] =
      for
        // TODO: placeholder — real scoring math lands once trades feed into it.
        score <- repo.countReportsAgainst(userId).flatMap(_ => ZIO.succeed(0))
        _     <- repo.updateReputation(userId, score)
      yield score

    def getReputationStatus(userId: String): Task[Boolean] =
      repo.countReportsAgainst(userId).map(_ >= 3)

  val layer: ZLayer[UserRepository, Nothing, UserService] =
    ZLayer.fromFunction(new Live(_))
