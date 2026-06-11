/**
 * FILE: UserRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/UserRepository.scala
 *
 * PURPOSE:
 *   Handles all database operations for user accounts.
 *
 * USED BY: UserService
 * DEPENDS ON: Doobie, ZIO, User model
 */

package com.poketracker.repository

import cats.syntax.all.*
import com.poketracker.models.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*
import java.time.Instant

/**
 * TRAIT: UserRepository
 * PURPOSE: Interface for all user data access operations.
 */
trait UserRepository:

  /**
   * METHOD: findById
   * PURPOSE: Fetch a user by their UUID primary key.
   * @param id  UUID string
   * @return    Some(user) if found, None if not
   */
  def findById(id: String): Task[Option[User]]

  /**
   * METHOD: findByUsername
   * PURPOSE: Fetch a user by their username.
   *          Used at login — usernames are unique.
   * @param username  The username to look up
   * @return          Some(user) if found, None if not
   */
  def findByUsername(username: String): Task[Option[User]]

  /**
   * METHOD: findByEmail
   * PURPOSE: Fetch a user by their email address.
   *          Used to check for duplicate emails on registration.
   * @param email  The email to look up
   * @return       Some(user) if found, None if not
   */
  def findByEmail(email: String): Task[Option[User]]

  /**
   * METHOD: create
   * PURPOSE: Inserts a new user into the database.
   * @param user  The user to create
   * @return      Unit — we use the ID we generated, not a DB-generated one
   */
  def create(user: User): Task[Unit]

  /**
   * METHOD: updateReputation
   * PURPOSE: Recalculates and saves a user's reputation score.
   *          Called after a trade rating is submitted.
   * @param userId      The user whose score to update
   * @param reputation  The new calculated score
   * @return            Unit
   */
  def updateReputation(userId: String, reputation: Int): Task[Unit]

  /**
   * METHOD: updateLocation
   * PURPOSE: Saves a user's city-level location for trade proximity.
   * @param userId    The user
   * @param location  City-level string e.g. "Austin, TX"
   * @return          Unit
   */
  def updateLocation(userId: String, location: String): Task[Unit]

  /**
   * METHOD: countReportsAgainst
   * PURPOSE: Counts how many reports have been filed against a user.
   *          Used to determine if a warning badge should be shown.
   *          Three or more reports triggers the badge.
   * @param userId  The user to check
   * @return        Number of reports filed against them
   */
  def countReportsAgainst(userId: String): Task[Int]

object UserRepository:

  final class Live(xa: Transactor[Task]) extends UserRepository:

    // Private helper that maps a result row to a User.
    // Defined once and reused by all SELECT queries to avoid repetition.
    private def rowToUser(
      id: String, username: String, email: String, role: String,
      reputation: Int, location: Option[String], createdAt: Instant
    ): User =
      // UserRole.valueOf converts the string stored in the DB back to our enum.
      // e.g. "Collector" -> UserRole.Collector
      User(id, username, email, UserRole.valueOf(role), reputation, location, createdAt)

    def findById(id: String): Task[Option[User]] =
      sql"""
        SELECT id, username, email, role, reputation, location, created_at
        FROM users
        WHERE id = $id
      """
        .query[(String, String, String, String, Int, Option[String], Instant)]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def findByUsername(username: String): Task[Option[User]] =
      sql"""
        SELECT id, username, email, role, reputation, location, created_at
        FROM users
        WHERE username = $username
      """
        .query[(String, String, String, String, Int, Option[String], Instant)]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def findByEmail(email: String): Task[Option[User]] =
      sql"""
        SELECT id, username, email, role, reputation, location, created_at
        FROM users
        WHERE email = $email
      """
        .query[(String, String, String, String, Int, Option[String], Instant)]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def create(user: User): Task[Unit] =
      sql"""
        INSERT INTO users (id, username, email, role, reputation, location, created_at)
        VALUES (${user.id}, ${user.username}, ${user.email},
                ${user.role.toString}, ${user.reputation},
                ${user.location}, ${user.createdAt})
      """
        .update.run.void.transact(xa)

    def updateReputation(userId: String, reputation: Int): Task[Unit] =
      sql"""
        UPDATE users SET reputation = $reputation WHERE id = $userId
      """
        .update.run.void.transact(xa)

    def updateLocation(userId: String, location: String): Task[Unit] =
      sql"""
        UPDATE users SET location = $location WHERE id = $userId
      """
        .update.run.void.transact(xa)

    def countReportsAgainst(userId: String): Task[Int] =
      sql"""
        SELECT COUNT(*) FROM user_reports WHERE reported_user_id = $userId
      """
        .query[Int]
        .unique
        .transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, UserRepository] =
    ZLayer.fromFunction(new Live(_))
