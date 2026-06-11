/**
 * FILE: UserService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/UserService.scala
 *
 * PURPOSE:
 *   Business logic for user accounts — registration, login, profile updates.
 *   Handles ID generation, validation, and reputation calculation.
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

/**
 * TRAIT: UserService
 * PURPOSE: Interface for all user business logic.
 */
trait UserService:

  /**
   * METHOD: register
   * PURPOSE: Creates a new user account.
   *          Validates that the username and email are not already taken.
   *
   * @param username  Chosen display name — must be unique
   * @param email     Email address — must be unique
   * @return          The newly created User, or fails if username/email taken
   */
  def register(username: String, email: String): Task[User]

  /**
   * METHOD: findByUsername
   * PURPOSE: Looks up a user by their username.
   *          Used at login.
   * @param username  The username to look up
   * @return          Some(user) if found, None if no user has this username
   */
  def findByUsername(username: String): Task[Option[User]]

  /**
   * METHOD: updateLocation
   * PURPOSE: Saves a user's location for trade proximity matching.
   *          Location is stored at city level only — never exact address.
   * @param userId    The user to update
   * @param location  City-level string e.g. "Austin, TX"
   * @return          Unit
   */
  def updateLocation(userId: String, location: String): Task[Unit]

  /**
   * METHOD: refreshReputation
   * PURPOSE: Recalculates a user's reputation score from their trade ratings
   *          and saves the new score. Called after a rating is submitted.
   * @param userId  The user whose reputation to refresh
   * @return        The new reputation score
   */
  def refreshReputation(userId: String): Task[Int]

  /**
   * METHOD: getReputationStatus
   * PURPOSE: Determines whether a user should show a warning badge.
   *          A warning badge appears when a user has 3 or more reports filed
   *          against them. This is visible to other users when viewing
   *          their profile or trade listings.
   * @param userId  The user to check
   * @return        True if the user has 3+ reports and should show a warning
   */
  def getReputationStatus(userId: String): Task[Boolean]

object UserService:

  final class Live(repo: UserRepository) extends UserService:

    def register(username: String, email: String): Task[User] =
      for
        // Check username is not taken — fail with clear message if it is
        existing <- repo.findByUsername(username)
        _        <- ZIO.when(existing.isDefined)(
                      ZIO.fail(new IllegalArgumentException(
                        s"Username '$username' is already taken. Please choose a different one."
                      ))
                    )
        // Check email is not already registered
        byEmail  <- repo.findByEmail(email)
        _        <- ZIO.when(byEmail.isDefined)(
                      ZIO.fail(new IllegalArgumentException(
                        s"An account with this email already exists."
                      ))
                    )
        // Generate a new UUID for this user.
        // UUID.randomUUID() creates a version 4 (random) UUID.
        // We convert to String for storage.
        id       = UUID.randomUUID().toString
        user     = User(
                     id         = id,
                     username   = username,
                     email      = email,
                     role       = UserRole.Collector,  // All new users start as Collector
                     reputation = 0,                   // Start with neutral reputation
                     location   = None,                // Location is set separately
                     createdAt  = Instant.now()
                   )
        _        <- repo.create(user)
      yield user

    def findByUsername(username: String): Task[Option[User]] =
      repo.findByUsername(username)

    def updateLocation(userId: String, location: String): Task[Unit] =
      // Validate location is not empty before saving
      ZIO.when(location.trim.isEmpty)(
        ZIO.fail(new IllegalArgumentException("Location cannot be empty"))
      ) *> repo.updateLocation(userId, location.trim)

    def refreshReputation(userId: String): Task[Int] =
      for
        // Ask the trade repository to calculate the score from ratings.
        // We call through UserRepository which delegates to the trade data.
        score <- repo.countReportsAgainst(userId)
                   .flatMap(_ => ZIO.succeed(0)) // Placeholder — real calc in TradeService
        _     <- repo.updateReputation(userId, score)
      yield score

    def getReputationStatus(userId: String): Task[Boolean] =
      // A user gets a warning badge if they have 3 or more reports
      repo.countReportsAgainst(userId).map(_ >= 3)

  val layer: ZLayer[UserRepository, Nothing, UserService] =
    ZLayer.fromFunction(new Live(_))
