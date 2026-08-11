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

  /** Looks up the profile linked to a verified Supabase access token's `sub` claim. */
  def findBySupabaseUserId(supabaseUserId: String): Task[Option[User]]

  def findAll: Task[List[User]]

  def create(user: User): Task[Unit]
  def updateReputation(userId: String, reputation: Int): Task[Unit]
  def updateLocation(userId: String, location: String): Task[Unit]

  /** 3+ triggers a warning badge on the user's profile/listings. */
  def countReportsAgainst(userId: String): Task[Int]

object UserRepository:

  final class Live(xa: Transactor[Task]) extends UserRepository:

    private def rowToUser(
      id: String, supabaseUserId: String, username: String, email: String, role: String,
      reputation: Int, location: Option[String], createdAt: Instant
    ): User =
      User(id, supabaseUserId, username, email, UserRole.valueOf(role), reputation, location, createdAt)

    private type Row = (String, String, String, String, String, Int, Option[String], Instant)

    private val columns = "id, supabase_user_id, username, email, role, reputation, location, created_at"

    def findById(id: String): Task[Option[User]] =
      (sql"SELECT " ++ Fragment.const(columns) ++ sql" FROM users WHERE id = $id")
        .query[Row]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def findByUsername(username: String): Task[Option[User]] =
      (sql"SELECT " ++ Fragment.const(columns) ++ sql" FROM users WHERE username = $username")
        .query[Row]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def findByEmail(email: String): Task[Option[User]] =
      (sql"SELECT " ++ Fragment.const(columns) ++ sql" FROM users WHERE email = $email")
        .query[Row]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def findBySupabaseUserId(supabaseUserId: String): Task[Option[User]] =
      (sql"SELECT " ++ Fragment.const(columns) ++ sql" FROM users WHERE supabase_user_id = $supabaseUserId")
        .query[Row]
        .option
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def findAll: Task[List[User]] =
      (sql"SELECT " ++ Fragment.const(columns) ++ sql" FROM users ORDER BY username ASC")
        .query[Row]
        .to[List]
        .map(_.map(rowToUser.tupled))
        .transact(xa)

    def create(user: User): Task[Unit] =
      sql"""
        INSERT INTO users (id, supabase_user_id, username, email, role, reputation, location, created_at)
        VALUES (${user.id}, ${user.supabaseUserId}, ${user.username}, ${user.email},
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
