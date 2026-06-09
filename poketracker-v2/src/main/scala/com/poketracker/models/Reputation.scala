/**
 * FILE: Reputation.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/Reputation.scala
 *
 * PURPOSE:
 *   Represents the trust and reputation system.
 *   After a trade completes, both parties rate each other.
 *   Users can also report others for scamming or selling fake cards.
 *
 * IMPORTS:
 *   zio.json.* — JSON conversion
 *   java.time.Instant — UTC timestamps
 *
 * USED BY: ReputationRepository, ReputationService, ReputationRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.Instant

/**
 * ENUM: RatingValue
 *
 * PURPOSE:
 *   The possible ratings after a completed trade.
 *   Kept simple — three options is enough for a trust system.
 *   More granular ratings (1-5 stars) invite gaming the system.
 *
 *   Positive — trade went well, would trade again
 *   Neutral  — trade completed but something was off (late, poor communication)
 *   Negative — trade went badly (no-show, misrepresented card condition)
 */
enum RatingValue:
  case Positive, Neutral, Negative

object RatingValue:
  given JsonCodec[RatingValue] = JsonCodec.string.transform(
    s => RatingValue.valueOf(s),
    r => r.toString
  )

/**
 * CASE CLASS: TradeRating
 *
 * PURPOSE:
 *   A rating left by one user for another after a completed trade.
 *
 * @param id          UUID primary key.
 * @param tradeId     Which completed trade this rating is for.
 * @param fromUserId  Who left this rating.
 * @param forUserId   Who is being rated.
 * @param rating      Positive, Neutral, or Negative.
 * @param comment     Optional explanation.
 *                    Required when rating is Negative — explains what went wrong.
 * @param createdAt   When this rating was submitted.
 */
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

/**
 * ENUM: ReportReason
 *
 * PURPOSE:
 *   Why a user is being reported.
 *   Using an enum instead of free text makes reports actionable —
 *   we know exactly what category each report falls into.
 *
 *   FakeCards      — user traded counterfeit cards
 *   Misrepresented — condition was much worse than described
 *   NoShow         — agreed to trade then never showed up
 *   Scam           — took cards and disappeared
 *   Other          — anything else (requires explanation in description)
 */
enum ReportReason:
  case FakeCards, Misrepresented, NoShow, Scam, Other

object ReportReason:
  given JsonCodec[ReportReason] = JsonCodec.string.transform(
    s => ReportReason.valueOf(s),
    r => r.toString
  )

/**
 * CASE CLASS: UserReport
 *
 * PURPOSE:
 *   A report filed against a user for bad behavior.
 *   Three reports against the same user triggers a warning badge
 *   visible to everyone who views their profile or listings.
 *   Fake card reports are treated more seriously than other reasons.
 *
 * @param id             UUID primary key.
 * @param reportedUserId The user being reported. Foreign key → users.id
 * @param reportedById   Who filed this report. Foreign key → users.id
 * @param reason         Category of the report.
 * @param description    Detailed explanation of what happened.
 *                       Required — we do not act on reports without context.
 * @param tradeId        The trade where this happened, if applicable.
 *                       Optional because someone might report pre-emptively.
 * @param createdAt      When this report was filed.
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
