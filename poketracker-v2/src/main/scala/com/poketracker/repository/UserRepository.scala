/**
 * UserRepository — all database access for user accounts.
 *
 * HOW IT WORKS
 *   Plain Doobie CRUD over the `users` table. `Live` is the only place
 *   SQL for this table lives; `UserService` depends on the trait, not
 *   `Live`, so a test double can stand in without touching Doobie.
 *
 * USED BY: UserService
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

trait UserRepository:
  def findById(id: String): Task[Option[User]]
  def findByUsername(username: String): Task[Option[User]]
  def findByEmail(email: String): Task[Option[User]]

  /** A→Z by username — feeds the login screen's "pick an existing user" chips. */
  def findAll: Task[List[User]]

  def create(user: User): Task[Unit]
  def updateReputation(userId: String, reputation: Int): Task[Unit]
  def updateLocation(userId: String, location: String): Task[Unit]

  /** 3+ triggers a warning badge on the user's profile/listings. */
  def countReportsAgainst(userId: String): Task[Int]

object UserRepository:

  final class Live(xa: Transactor[Task]) extends UserRepository:

    private def rowToUser(
      id: String, username: String, email: String, role: String,
      reputation: Int, location: Option[String], createdAt: Instant
    ): User =
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

    def findAll: Task[List[User]] =
      sql"""
        SELECT id, username, email, role, reputation, location, created_at
        FROM users
        ORDER BY username ASC
      """
        .query[(String, String, String, String, Int, Option[String], Instant)]
        .to[List]
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
