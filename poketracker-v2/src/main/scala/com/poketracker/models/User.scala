/**
 * A registered PokéTracker user, and their account role.
 *
 * USED BY: UserRepository, UserService, AuthRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

enum UserRole:
  case Collector, Vendor, Admin

object UserRole:
  given JsonCodec[UserRole] = JsonCodec.string.transform(
    s => UserRole.valueOf(s),
    r => r.toString
  )

/**
 * @param location    City-level, for trade matching, e.g. "Austin, TX". None if not shared.
 * @param reputation  Running score from completed trades.
 */
final case class User(
  id:         String,
  username:   String,
  email:      String,
  role:       UserRole,
  reputation: Int,
  location:   Option[String],
  createdAt:  Instant
)

object User:
  given JsonCodec[User] = DeriveJsonCodec.gen[User]
