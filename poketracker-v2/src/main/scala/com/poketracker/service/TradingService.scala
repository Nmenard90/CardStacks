/**
 * TradingService — rules for share links, trade lists and offers.
 *
 * HOW IT WORKS
 *   - Share links are lazily created the first time an owner opens their
 *     share settings; the slug is a random 12-char token, so a link can't
 *     be guessed, and regenerating it revokes every old copy.
 *   - Demo (anonymous) accounts can't share or make offers — they're
 *     deleted after 24h, which would strand the other side of any trade.
 *   - An offer may only ask for cards the seller actually exposes: trade
 *     list items (up to the listed quantity), or anything owned when the
 *     seller made their whole collection public. Cards the buyer puts up
 *     must be in the buyer's own collection. Card names/images/prices are
 *     snapshotted server-side — the client only sends ids.
 *   - Status transitions: the seller accepts/declines a Pending offer, the
 *     buyer can withdraw it; once Accepted, either side can mark it
 *     Completed or Cancelled. Nothing in the collection changes
 *     automatically — the owners update their own collections.
 *
 * USED BY: TradingRoutes
 * DEPENDS ON: TradingRepository, UserRepository
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.{TradingRepository, UserRepository}
import zio.*

/** A failure with a specific HTTP status — routes map it to a response. */
final case class TradingError(status: Int, message: String) extends RuntimeException(message)

/** One card in a bulk "list for trade": no asking price = make an offer. */
final case class TradeLine(cardId: String, condition: String, quantity: Int, askingPrice: Option[Double])

/** One requested line in an offer: just ids, everything else is looked up. */
final case class OfferLine(cardId: String, condition: String, quantity: Int)

trait TradingService:
  def getShare(userId: String): Task[ShareSettings]
  def updateShare(userId: String, enabled: Boolean, collectionPublic: Boolean, bio: Option[String]): Task[ShareSettings]
  def regenerateSlug(userId: String): Task[ShareSettings]
  def sharedProfile(slug: String, game: String): Task[SharedProfile]

  def tradeList(userId: String, game: String): Task[List[TradeListItem]]
  def saveTradeItem(userId: String, cardId: String, condition: String, quantity: Int,
    askingPrice: Option[Double], note: Option[String]): Task[List[TradeListItem]]
  def removeTradeItem(userId: String, itemId: String): Task[Unit]
  /** Lists many cards at once. Quantities above what's owned are cut down
   *  to what's owned; cards not owned at all are skipped. */
  def saveTradeItems(userId: String, lines: List[TradeLine]): Task[List[TradeListItem]]
  def removeTradeItems(userId: String, itemIds: List[String]): Task[Int]

  def makeOffer(buyerId: String, slug: String, wants: List[OfferLine], gives: List[OfferLine],
    cashAmount: Option[Double], message: Option[String]): Task[CardOffer]
  def offers(userId: String, game: String): Task[List[CardOffer]]
  def offer(userId: String, offerId: String): Task[CardOffer]
  def setStatus(userId: String, offerId: String, status: String): Task[CardOffer]
  def postMessage(userId: String, offerId: String, body: String): Task[CardOffer]
  def unreadCount(userId: String, game: String): Task[Int]

object TradingService:

  private val MaxLines   = 50
  private val MaxCash    = 1_000_000.0
  private val MaxMessage = 2000
  private val MaxBulk    = 2000

  private val slugChars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  private val rng = new java.security.SecureRandom()
  private[service] def newSlug(): String =
    (1 to 12).map(_ => slugChars.charAt(rng.nextInt(slugChars.length))).mkString

  private def fail(status: Int, msg: String) = ZIO.fail(TradingError(status, msg))

  private def clean(s: Option[String]): Option[String] = s.map(_.trim).filter(_.nonEmpty)

  /** Who may move an offer from `from` to `to`. */
  private[poketracker] def allowed(role: String, from: String, to: String): Boolean =
    import OfferState.*
    (role, from, to) match
      case ("seller", Pending, Accepted | Declined)       => true
      case ("buyer",  Pending, Withdrawn)                 => true
      case (_,        Accepted, Completed | Cancelled)    => true
      case _                                              => false

  final class Live(repo: TradingRepository, users: UserRepository) extends TradingService:

    private def realUser(userId: String, action: String): Task[User] =
      users.findById(userId).flatMap {
        case None                     => fail(404, "User not found")
        case Some(u) if u.isAnonymous => fail(403, s"Create a free account to $action — demo accounts are deleted after 24 hours.")
        case Some(u)                  => ZIO.succeed(u)
      }

    def getShare(userId: String): Task[ShareSettings] =
      realUser(userId, "share your cards") *> repo.ensureShare(userId, newSlug())

    def updateShare(userId: String, enabled: Boolean, collectionPublic: Boolean, bio: Option[String]): Task[ShareSettings] =
      val b = clean(bio)
      for
        _ <- ZIO.when(b.exists(_.length > 500))(fail(400, "Bio must be 500 characters or fewer."))
        _ <- getShare(userId)
        _ <- repo.updateShare(userId, enabled, collectionPublic, b)
        s <- repo.ensureShare(userId, newSlug())
      yield s

    def regenerateSlug(userId: String): Task[ShareSettings] =
      getShare(userId) *> repo.setSlug(userId, newSlug()) *> repo.ensureShare(userId, newSlug())

    def sharedProfile(slug: String, game: String): Task[SharedProfile] =
      for
        found <- repo.findShareBySlug(slug).someOrElseZIO(fail(404, "This share link doesn't exist or was turned off."))
        (ownerId, share) = found
        owner <- users.findById(ownerId).someOrElseZIO(fail(404, "This share link doesn't exist or was turned off."))
        list  <- repo.listTradeItems(ownerId, game)
        coll  <- if share.collectionPublic then repo.publicCollection(ownerId, game).map(Some(_)) else ZIO.none
        games <- repo.tradeGames(ownerId, share.collectionPublic)
      yield SharedProfile(owner.username, owner.reputation, owner.createdAt, share.bio, list, coll, game, games)

    def tradeList(userId: String, game: String): Task[List[TradeListItem]] = repo.listTradeItems(userId, game)

    def saveTradeItem(userId: String, cardId: String, condition: String, quantity: Int,
                      askingPrice: Option[Double], note: Option[String]): Task[List[TradeListItem]] =
      for
        _     <- realUser(userId, "list cards for trade")
        _     <- ZIO.when(quantity < 1)(fail(400, "Quantity must be at least 1."))
        _     <- ZIO.when(askingPrice.exists(p => p < 0 || p > MaxCash))(fail(400, "Asking price is out of range."))
        _     <- ZIO.when(clean(note).exists(_.length > 300))(fail(400, "Note must be 300 characters or fewer."))
        owned <- repo.ownedQuantity(userId, cardId, condition)
        _     <- ZIO.when(owned < quantity)(fail(400, s"You only own $owned of that card in $condition."))
        _     <- repo.upsertTradeItem(userId, cardId, condition, quantity, askingPrice, clean(note))
        // Return the list for the game this card belongs to.
        game  <- repo.gamesOfCards(List(cardId)).map(_.headOption.getOrElse(Game.DefaultId))
        list  <- repo.listTradeItems(userId, game)
      yield list

    def removeTradeItem(userId: String, itemId: String): Task[Unit] = repo.deleteTradeItem(userId, itemId)

    def saveTradeItems(userId: String, lines: List[TradeLine]): Task[List[TradeListItem]] =
      for
        _     <- realUser(userId, "list cards for trade")
        _     <- ZIO.when(lines.isEmpty)(fail(400, "Pick at least one card."))
        _     <- ZIO.when(lines.size > MaxBulk)(fail(400, s"List at most $MaxBulk cards per request."))
        _     <- ZIO.when(lines.exists(_.quantity < 1))(fail(400, "Quantity must be at least 1."))
        _     <- ZIO.when(lines.exists(_.askingPrice.exists(p => p < 0 || p > MaxCash)))(fail(400, "Asking price is out of range."))
        owned <- repo.ownedQuantities(userId, lines.map(_.cardId))
        // A repeated (card, condition) keeps its last line; never list more than owned.
        rows   = lines.groupMapReduce(l => (l.cardId, l.condition))(identity)((_, b) => b).values.toList.flatMap { l =>
                   val n = math.min(l.quantity, owned.getOrElse((l.cardId, l.condition), 0))
                   Option.when(n > 0)((l.cardId, l.condition, n, l.askingPrice))
                 }
        _     <- ZIO.when(rows.isEmpty)(fail(400, "None of those cards are in your collection."))
        _     <- repo.upsertTradeItems(userId, rows)
        game  <- repo.gamesOfCards(rows.take(1).map(_._1)).map(_.headOption.getOrElse(Game.DefaultId))
        list  <- repo.listTradeItems(userId, game)
      yield list

    def removeTradeItems(userId: String, itemIds: List[String]): Task[Int] =
      ZIO.when(itemIds.size > MaxBulk)(fail(400, s"Remove at most $MaxBulk cards per request.")) *>
        repo.deleteTradeItems(userId, itemIds.distinct)

    private def snapshot(line: OfferLine): Task[OfferCard] =
      repo.cardView(line.cardId, line.condition, line.quantity)
        .someOrElseZIO(fail(400, s"Unknown card ${line.cardId}."))
        .map(v => OfferCard(v.cardId, v.name, v.imageSmall, v.condition, v.quantity, v.marketPrice))

    /** Same card+condition may appear on multiple lines — check the sum. */
    private def merged(lines: List[OfferLine]): List[OfferLine] =
      lines.groupBy(l => (l.cardId, l.condition)).toList.map { case ((id, c), ls) => OfferLine(id, c, ls.map(_.quantity).sum) }

    def makeOffer(buyerId: String, slug: String, wants: List[OfferLine], gives: List[OfferLine],
                  cashAmount: Option[Double], message: Option[String]): Task[CardOffer] =
      val msg = clean(message)
      val cash = cashAmount.filter(_ > 0)
      for
        _      <- realUser(buyerId, "make offers")
        found  <- repo.findShareBySlug(slug).someOrElseZIO(fail(404, "This share link doesn't exist or was turned off."))
        (sellerId, share) = found
        _      <- ZIO.when(sellerId == buyerId)(fail(400, "You can't make an offer on your own cards."))
        _      <- ZIO.when(wants.isEmpty)(fail(400, "Pick at least one card you want."))
        _      <- ZIO.when(wants.size > MaxLines || gives.size > MaxLines)(fail(400, s"An offer can include at most $MaxLines cards per side."))
        _      <- ZIO.when((wants ++ gives).exists(_.quantity < 1))(fail(400, "Every quantity must be at least 1."))
        _      <- ZIO.when(cashAmount.exists(c => c < 0 || c > MaxCash))(fail(400, "Cash amount is out of range."))
        _      <- ZIO.when(msg.exists(_.length > MaxMessage))(fail(400, s"Message must be $MaxMessage characters or fewer."))
        _      <- ZIO.when(cash.isEmpty && gives.isEmpty && msg.isEmpty)(fail(400, "Offer some cash, some of your cards, or at least send a message."))
        _      <- ZIO.foreachDiscard(merged(wants)) { l =>
                    // A trade-list item can outlive the copies behind it (sold,
                    // removed from the collection) — never offer more than owned.
                    val owned = repo.ownedQuantity(sellerId, l.cardId, l.condition)
                    val available =
                      if share.collectionPublic then owned
                      else repo.listedQuantity(sellerId, l.cardId, l.condition).zipWith(owned)(math.min)
                    available.flatMap(n => ZIO.when(n < l.quantity)(fail(400, s"${l.cardId} (${l.condition}) isn't available in that quantity.")))
                  }
        _      <- ZIO.foreachDiscard(merged(gives)) { l =>
                    repo.ownedQuantity(buyerId, l.cardId, l.condition)
                      .flatMap(n => ZIO.when(n < l.quantity)(fail(400, s"You only own $n of ${l.cardId} in ${l.condition}.")))
                  }
        // Each game is its own world: an offer is for cards of exactly one game.
        games  <- repo.gamesOfCards((wants ++ gives).map(_.cardId))
        game   <- games match
                    case List(g) => ZIO.succeed(g)
                    case _       => fail(400, "An offer can only include cards from one game.")
        wantsC <- ZIO.foreach(merged(wants))(snapshot)
        givesC <- ZIO.foreach(merged(gives))(snapshot)
        id     <- repo.createOffer(sellerId, buyerId, wantsC, givesC, cash, msg, game)
        offer  <- offer(buyerId, id)
      yield offer

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

  val layer: ZLayer[TradingRepository & UserRepository, Nothing, TradingService] =
    ZLayer.fromFunction(new Live(_, _))
