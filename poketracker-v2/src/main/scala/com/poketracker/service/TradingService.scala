/**
 * TradingService — rules for card offers: reading them, accepting/declining,
 * and the message thread.
 *
 * HOW IT WORKS
 *   Offers were made on the old share-link trade page, which has been folded
 *   into the shop (buyers now send buy/trade requests from /shop/<slug>).
 *   Existing offers stay readable and answerable from My Shop's Offers tab.
 *   Status transitions: the seller accepts/declines a Pending offer, the
 *   buyer can withdraw it; once Accepted, either side can mark it Completed
 *   or Cancelled. Nothing in the collection changes automatically — the
 *   owners update their own collections.
 *
 * USED BY: TradingRoutes
 * DEPENDS ON: TradingRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.TradingRepository
import zio.*

/** A failure with a specific HTTP status — routes map it to a response. */
final case class TradingError(status: Int, message: String) extends RuntimeException(message)

trait TradingService:
  def offers(userId: String, game: String): Task[List[CardOffer]]
  def offer(userId: String, offerId: String): Task[CardOffer]
  def setStatus(userId: String, offerId: String, status: String): Task[CardOffer]
  def postMessage(userId: String, offerId: String, body: String): Task[CardOffer]
  def unreadCount(userId: String, game: String): Task[Int]

object TradingService:

  private val MaxMessage = 2000

  private def fail(status: Int, msg: String) = ZIO.fail(TradingError(status, msg))

  /** Who may move an offer from `from` to `to`. */
  private[poketracker] def allowed(role: String, from: String, to: String): Boolean =
    import OfferState.*
    (role, from, to) match
      case ("seller", Pending, Accepted | Declined)       => true
      case ("buyer",  Pending, Withdrawn)                 => true
      case (_,        Accepted, Completed | Cancelled)    => true
      case _                                              => false

  final class Live(repo: TradingRepository) extends TradingService:

    def offers(userId: String, game: String): Task[List[CardOffer]] = repo.listOffers(userId, game)

    def offer(userId: String, offerId: String): Task[CardOffer] =
      repo.markRead(offerId, userId) *>
        repo.findOffer(offerId, userId).someOrElseZIO(fail(404, "Offer not found."))

    def setStatus(userId: String, offerId: String, status: String): Task[CardOffer] =
      for
        parties <- repo.offerParties(offerId).someOrElseZIO(fail(404, "Offer not found."))
        (sellerId, buyerId, current) = parties
        role    <- if userId == sellerId then ZIO.succeed("seller")
                   else if userId == buyerId then ZIO.succeed("buyer")
                   else fail(404, "Offer not found.")
        _       <- ZIO.unless(allowed(role, current, status))(fail(400, s"Can't change this offer from $current to $status."))
        changed <- repo.setStatus(offerId, current, status, userId)
        _       <- ZIO.unless(changed)(fail(409, "This offer was just changed by the other side — reload it."))
        o       <- offer(userId, offerId)
      yield o

    def postMessage(userId: String, offerId: String, body: String): Task[CardOffer] =
      val text = body.trim
      for
        _       <- ZIO.when(text.isEmpty)(fail(400, "Message is empty."))
        _       <- ZIO.when(text.length > MaxMessage)(fail(400, s"Message must be $MaxMessage characters or fewer."))
        parties <- repo.offerParties(offerId).someOrElseZIO(fail(404, "Offer not found."))
        _       <- ZIO.unless(userId == parties._1 || userId == parties._2)(fail(404, "Offer not found."))
        _       <- repo.addMessage(offerId, userId, text)
        o       <- offer(userId, offerId)
      yield o

    def unreadCount(userId: String, game: String): Task[Int] = repo.unreadCount(userId, game)

  val layer: ZLayer[TradingRepository, Nothing, TradingService] =
    ZLayer.fromFunction(new Live(_))
