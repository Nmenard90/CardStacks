/**
 * Trust/reputation system: post-trade ratings, and reports for scamming
 * or misrepresenting cards.
 *
 * USED BY: ReputationRepository, ReputationService, ReputationRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/** Deliberately just 3 values, not 1-5 stars — finer granularity invites gaming. */
enum RatingValue:
  case Positive, Neutral, Negative

object RatingValue:
  given JsonCodec[RatingValue] = JsonCodec.string.transform(
    s => RatingValue.valueOf(s),
    r => r.toString
  )

/** @param comment  Optional, but expected to be filled in when rating is Negative. */
final case class TradeRating(
  id:         String,
  tradeId:    String,
  fromUserId: String,
  forUserId:  String,
  rating:     RatingValue,
  comment:    Option[String],
  createdAt:  Instant
)

object TradeRating:
  given JsonCodec[TradeRating] = DeriveJsonCodec.gen[TradeRating]

enum ReportReason:
  case FakeCards, Misrepresented, NoShow, Scam, Other

object ReportReason:
  given JsonCodec[ReportReason] = JsonCodec.string.transform(
    s => ReportReason.valueOf(s),
    r => r.toString
  )

/**
 * A report filed against a user. Three reports triggers a public warning
 * badge on their profile.
 *
 * @param description  Required — reports without context aren't acted on.
 * @param tradeId       None when a report is filed pre-emptively, without a specific trade.
 */
final case class UserReport(
  id:             String,
  reportedUserId: String,
  reportedById:   String,
  reason:         ReportReason,
  description:    String,
  tradeId:        Option[String],
  createdAt:      Instant
)

object UserReport:
  given JsonCodec[UserReport] = DeriveJsonCodec.gen[UserReport]
