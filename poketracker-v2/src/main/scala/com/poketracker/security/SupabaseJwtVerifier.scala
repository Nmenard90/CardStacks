/**
 * SupabaseJwtVerifier — verifies a Supabase-issued access token against
 * Supabase's own public signing keys.
 *
 * HOW IT WORKS
 *   Supabase publishes its current signing keys at
 *   `<project-url>/auth/v1/.well-known/jwks.json`. `RemoteJWKSet` fetches
 *   and caches that set in memory (built once at startup, in `layer`
 *   below — NOT reconstructed per request, or every API call would hit
 *   Supabase's JWKS endpoint). Verifying a token means reading which key
 *   (`kid`) and algorithm it claims to be signed with from its header,
 *   then checking the signature against that cached key — Nimbus does the
 *   actual cryptography (EC/RSA signature verification) so this file
 *   doesn't hand-roll it.
 *
 * USED BY: security.AuthGuard
 * DEPENDS ON: config.AuthConfig
 */

package com.poketracker.security

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.source.{JWKSource, JWKSourceBuilder}
import com.nimbusds.jose.proc.{JWSVerificationKeySelector, SecurityContext}
import com.nimbusds.jwt.SignedJWT
import com.nimbusds.jwt.proc.DefaultJWTProcessor
import com.poketracker.config.AuthConfig
import zio.*
import java.time.Instant
import scala.jdk.CollectionConverters.*

final case class SupabaseClaims(subject: String, email: Option[String], username: Option[String], isAnonymous: Boolean)

trait SupabaseJwtVerifier:
  /** Fails with a human-readable reason on anything wrong with the token —
   *  bad signature, expired, unknown key, malformed. Never throws. */
  def verify(token: String): IO[String, SupabaseClaims]

object SupabaseJwtVerifier:

  final class Live(keySource: JWKSource[SecurityContext]) extends SupabaseJwtVerifier:

    def verify(token: String): IO[String, SupabaseClaims] =
      ZIO.attemptBlocking {
        val jwt = SignedJWT.parse(token)

        // Built per call (cheap) but backed by the shared, cached keySource —
        // matches whatever algorithm this project's signing keys actually
        // use (ES256, RS256, ...) instead of assuming one.
        val processor = new DefaultJWTProcessor[SecurityContext]()
        processor.setJWSKeySelector(new JWSVerificationKeySelector(jwt.getHeader.getAlgorithm, keySource))

        val claims = processor.process(jwt, null)

        val exp = Option(claims.getExpirationTime)
        if exp.exists(_.toInstant.isBefore(Instant.now())) then
          throw new IllegalStateException("Token expired")

        val email       = Option(claims.getStringClaim("email"))
        val metadata    = Option(claims.getJSONObjectClaim("user_metadata")).map(_.asScala)
        val username    = metadata.flatMap(_.get("username")).map(_.toString)
        // Supabase sets this true only on anonymous-auth sessions (the "try
        // the demo" button) — absent entirely on normal accounts.
        val isAnonymous = Option(claims.getBooleanClaim("is_anonymous")).exists(_.booleanValue)

        SupabaseClaims(claims.getSubject, email, username, isAnonymous)
      }.mapError(e => Option(e.getMessage).getOrElse(e.getClass.getSimpleName))

  /** RemoteJWKSet caches Supabase's public keys in memory and only
   *  re-fetches them when a token references a `kid` it hasn't seen yet
   *  (e.g. after Supabase rotates keys) — built once here, not per request. */
  val layer: ZLayer[Any, Throwable, SupabaseJwtVerifier] =
    ZLayer.fromZIO {
      for
        supabaseUrl <- AuthConfig.supabaseUrl
        keySource   <- ZIO.attempt {
                         val jwksUrl = java.net.URI.create(s"$supabaseUrl/auth/v1/.well-known/jwks.json").toURL
                         JWKSourceBuilder.create[SecurityContext](jwksUrl).build()
                       }
      yield new Live(keySource)
    }
