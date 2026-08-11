/**
 * SupabaseAuth — verifies a Supabase-issued access token (HS256 JWT)
 * without any external JWT library.
 *
 * HOW IT WORKS
 *   A JWT is three base64url segments separated by dots: header.payload.signature.
 *   Supabase signs the "header.payload" bytes with HMAC-SHA256 using the
 *   project's JWT secret (see config.AuthConfig). Verifying a token means
 *   recomputing that same HMAC locally and checking it matches the token's
 *   signature segment, then reading the claims out of the (now-trusted)
 *   payload — the subject (Supabase's internal user id), email, and the
 *   username the frontend asked Supabase to store as user metadata at
 *   sign-up.
 *
 * USED BY: security.AuthGuard
 */

package com.poketracker.security

import zio.json.*
import zio.json.ast.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

final case class SupabaseClaims(subject: String, email: Option[String], username: Option[String])

object SupabaseAuth:

  private def hmacSha256(key: String, data: String): Array[Byte] =
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(new SecretKeySpec(key.getBytes(UTF_8), "HmacSHA256"))
    mac.doFinal(data.getBytes(UTF_8))

  private def field(json: Json, name: String): Option[Json] = json match
    case Json.Obj(fields) => fields.find(_._1 == name).map(_._2)
    case _                => None

  private def asString(json: Json): Option[String] = json match
    case Json.Str(s) => Some(s)
    case _            => None

  private def asLong(json: Json): Option[Long] = json match
    case Json.Num(n) => Some(n.longValue)
    case _            => None

  /** Left(reason) on anything wrong with the token — bad shape, bad
   *  signature, expired, or missing claims. Never throws. */
  def verify(token: String, secret: String): Either[String, SupabaseClaims] =
    token.split('.').toList match
      case headerB64 :: payloadB64 :: sigB64 :: Nil =>
        try
          val expectedSig = hmacSha256(secret, s"$headerB64.$payloadB64")
          val actualSig    = Base64.getUrlDecoder.decode(sigB64)
          if !MessageDigest.isEqual(expectedSig, actualSig) then
            Left("Invalid token signature")
          else
            val payloadStr = new String(Base64.getUrlDecoder.decode(payloadB64), UTF_8)
            payloadStr.fromJson[Json] match
              case Left(err) => Left(s"Malformed token payload: $err")
              case Right(payload) =>
                val sub      = field(payload, "sub").flatMap(asString)
                val exp      = field(payload, "exp").flatMap(asLong)
                val email    = field(payload, "email").flatMap(asString)
                val username = field(payload, "user_metadata").flatMap(field(_, "username")).flatMap(asString)

                (sub, exp) match
                  case (Some(s), Some(e)) =>
                    if Instant.now().getEpochSecond > e then Left("Token expired")
                    else Right(SupabaseClaims(s, email, username))
                  case _ => Left("Token missing required claims")
        catch
          case e: Exception => Left(s"Token verification failed: ${e.getMessage}")
      case _ => Left("Malformed token")
