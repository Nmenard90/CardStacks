/**
 * AuthConfig — reads the Supabase project's JWT secret from the environment.
 *
 * HOW IT WORKS
 *   Supabase signs every access token it issues (HS256) with a per-project
 *   secret, found in the Supabase dashboard under Project Settings -> API ->
 *   JWT Settings ("JWT Secret"). The backend uses that same secret to verify
 *   incoming tokens without ever calling out to Supabase itself.
 *
 * USED BY: security.AuthGuard
 */

package com.poketracker.config

import zio.*

object AuthConfig:

  val supabaseJwtSecret: ZIO[Any, Throwable, String] =
    System.env("SUPABASE_JWT_SECRET").someOrFail(
      new IllegalArgumentException(
        "SUPABASE_JWT_SECRET is not set. In Railway set: SUPABASE_JWT_SECRET = <Supabase Project Settings -> API -> JWT Settings -> JWT Secret>"
      )
    )
