/**
 * UserService — business logic for user accounts: registration, lookup,
 * profile updates, reputation.
 *
 * HOW IT WORKS
 *   Thin rules layer over UserRepository: enforces username/email
 *   uniqueness on registration, rejects blank locations, and derives the
 *   reputation warning-badge threshold. All database access goes through
 *   the injected UserRepository — this file has no SQL of its own.
 *
 * USED BY: UserRoutes
 * DEPENDS ON: UserRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.UserRepository
import zio.*
import java.time.Instant
import java.util.UUID

trait UserService:

  /** Fails if username or email is already taken. */
  def register(username: String, email: String): Task[User]

  def findByUsername(username: String): Task[Option[User]]

  /** A→Z, for the login screen's "pick an existing user" chips. */
  def listAll: Task[List[User]]

  /** City-level only, never an exact address. */
  def updateLocation(userId: String, location: String): Task[Unit]

  /** Recalculates and persists reputation. Called after a trade rating is submitted. */
  def refreshReputation(userId: String): Task[Int]

  /** True once a user has 3+ reports — the warning-badge threshold. */
  def getReputationStatus(userId: String): Task[Boolean]

object UserService:

  final class Live(repo: UserRepository) extends UserService:

    def register(username: String, email: String): Task[User] =
      for
        existing <- repo.findByUsername(username)
        _        <- ZIO.when(existing.isDefined)(
                      ZIO.fail(new IllegalArgumentException(
                        s"Username '$username' is already taken. Please choose a different one."
                      ))
                    )
        byEmail  <- repo.findByEmail(email)
        _        <- ZIO.when(byEmail.isDefined)(
                      ZIO.fail(new IllegalArgumentException(
                        s"An account with this email already exists."
                      ))
                    )
        id       = UUID.randomUUID().toString
        user     = User(
                     id         = id,
                     username   = username,
                     email      = email,
                     role       = UserRole.Collector,
                     reputation = 0,
                     location   = None,
                     createdAt  = Instant.now()
                   )
        _        <- repo.create(user)
      yield user

    def findByUsername(username: String): Task[Option[User]] =
      repo.findByUsername(username)

    def listAll: Task[List[User]] =
      repo.findAll

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
