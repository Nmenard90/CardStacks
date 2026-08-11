/**
 * AuthConfig — reads the Supabase project URL from the environment.
 *
 * HOW IT WORKS
 *   Supabase's newer projects sign access tokens asymmetrically (their
 *   "JWT Signing Keys" feature) rather than with one shared secret, and
 *   publish the matching public keys at
 *   `<project-url>/auth/v1/.well-known/jwks.json`. Verifying a token is
 *   then just a matter of knowing the project's URL — which isn't secret,
 *   it's the same value the frontend already uses as VITE_SUPABASE_URL.
 *
 * USED BY: security.SupabaseJwtVerifier
 */

package com.poketracker.config

import zio.*

object AuthConfig:

  val supabaseUrl: ZIO[Any, Throwable, String] =
    System.env("SUPABASE_URL").map(_.map(_.trim)).someOrFail(
      new IllegalArgumentException(
        "SUPABASE_URL is not set. In Railway set: SUPABASE_URL = <Supabase Project Settings -> API -> Project URL> (same value as the frontend's VITE_SUPABASE_URL)"
      )
    )
