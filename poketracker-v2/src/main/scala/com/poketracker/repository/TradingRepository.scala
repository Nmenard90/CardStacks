/**
 * TradingRepository — all database access for share links, trade lists,
 * offers and offer messages (migration 015). No authorization decisions
 * live here beyond scoping every query to the user it's given — the
 * service decides who may do what.
 *
 * USED BY: TradingService
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
import zio.json.*
import java.time.Instant

trait TradingRepository:
  def getShare(userId: String): Task[Option[ShareSettings]]
  /** Creates the user's share row with `slug` if they don't have one yet;
   *  returns whichever row exists afterwards. */
  def ensureShare(userId: String, slug: String): Task[ShareSettings]
  def updateShare(userId: String, enabled: Boolean, collectionPublic: Boolean, bio: Option[String]): Task[Unit]
  def setSlug(userId: String, slug: String): Task[Unit]
  /** (ownerUserId, settings) for an enabled share link, or None. */
  def findShareBySlug(slug: String): Task[Option[(String, ShareSettings)]]

  def listTradeItems(userId: String, game: String): Task[List[TradeListItem]]
  def upsertTradeItem(userId: String, cardId: String, condition: String, quantity: Int,
    askingPrice: Option[Double], note: Option[String]): Task[Unit]
  def deleteTradeItem(userId: String, itemId: String): Task[Unit]
  /** Lists many (cardId, condition, quantity, askingPrice) at once in one
   *  transaction; an existing listing keeps its note. */
  def upsertTradeItems(userId: String, items: List[(String, String, Int, Option[Double])]): Task[Unit]
  def deleteTradeItems(userId: String, itemIds: List[String]): Task[Int]
  /** How many trade-list copies of (card, condition) this user listed. */
  def listedQuantity(userId: String, cardId: String, condition: String): Task[Int]

  /** Copies of (card, condition key) in the user's collection. */
  def ownedQuantity(userId: String, cardId: String, condition: String): Task[Int]
  /** Copies owned per (cardId, condition key), for the given cards. */
  def ownedQuantities(userId: String, cardIds: List[String]): Task[Map[(String, String), Int]]
  /** Every owned (card, condition) with quantity > 0, for a public collection. */
  def publicCollection(userId: String, game: String): Task[List[TradeCardView]]
  /** Games the user has trade-list items in (plus owned cards when `withCollection`). */
  def tradeGames(userId: String, withCollection: Boolean): Task[List[String]]
  /** Distinct games of the given cards. */
  def gamesOfCards(cardIds: List[String]): Task[List[String]]
  def cardView(cardId: String, condition: String, quantity: Int): Task[Option[TradeCardView]]

  def createOffer(sellerId: String, buyerId: String, wants: List[OfferCard], gives: List[OfferCard],
    cashAmount: Option[Double], firstMessage: Option[String], game: String): Task[String]
  /** Offers where the user is either side, newest activity first, no messages. */
  def listOffers(userId: String, game: String): Task[List[CardOffer]]
  /** One offer with its full message thread, only if the user is a participant. */
  def findOffer(offerId: String, userId: String): Task[Option[CardOffer]]
  /** (sellerId, buyerId, status) */
  def offerParties(offerId: String): Task[Option[(String, String, String)]]
  /** Moves the offer from `from` to `to` only if it is still in `from`;
   *  false when someone else changed it first. */
  def setStatus(offerId: String, from: String, to: String, actorId: String): Task[Boolean]
  def addMessage(offerId: String, senderId: String, body: String): Task[Unit]
  def markRead(offerId: String, userId: String): Task[Unit]
  def unreadCount(userId: String, game: String): Task[Int]

object TradingRepository:

  final class Live(xa: Transactor[Task]) extends TradingRepository:

    private type ShareRow = (String, Boolean, Boolean, Option[String])
    private val toShare: ShareRow => ShareSettings = (slug, en, pub, bio) => ShareSettings(slug, en, pub, bio)

    /** Market price for a condition key's base condition ("NM", "LP 1st Ed · reverse", ...).
     *  The print part is already resolved by priceJoin, which picked that
     *  print's price row. */
    private def priceFor(condition: String, nm: Option[Double], lp: Option[Double], mp: Option[Double],
                         hp: Option[Double], dmg: Option[Double]): Option[Double] =
      ConditionKey.parse(condition).condition match
        case "NM"  => nm
        case "LP"  => lp.orElse(nm)
        case "MP"  => mp.orElse(nm)
        case "HP"  => hp.orElse(nm)
        case "DMG" => dmg.orElse(nm)
        case _     => nm

    private type CardRow = (String, String, String, String, Option[String], Option[String], String, String,
                            Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])

    private def view(r: CardRow, condition: String, quantity: Int): TradeCardView =
      val (id, name, setId, number, rarity, artist, small, large, nm, lp, mp, hp, dmg) = r
      TradeCardView(id, name, setId, number, rarity, artist, small, large, condition, quantity, priceFor(condition, nm, lp, mp, hp, dmg))

    private val cardCols = fr"""c.id, c.name, c.set_id, c.number, c.rarity, c.artist, c.image_small, c.image_large,
      p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg"""

    /** One price row for card `c` and the condition key `cond` (a SQL
     *  expression): that key's print from card_variant_prices when it names
     *  one ("NM · reverse"), else the default print's latest card_prices row.
     *  LATERAL + LIMIT 1 so a card never repeats and single-row lookups
     *  (`cardView`) can't fail if card_prices ever holds several rows. */
    private def priceJoin(cond: Fragment) = fr"""LEFT JOIN LATERAL (
        SELECT x.price_nm, x.price_lp, x.price_mp, x.price_hp, x.price_dmg FROM (
          SELECT vp.price_nm, vp.price_lp, vp.price_mp, vp.price_hp, vp.price_dmg, 0 AS pri, vp.fetched_at
          FROM card_variant_prices vp
          WHERE vp.card_id = c.id AND vp.variant = NULLIF(lower(trim(split_part(""" ++ cond ++ fr""", ' · ', 2))), '')
          UNION ALL
          SELECT cp.price_nm, cp.price_lp, cp.price_mp, cp.price_hp, cp.price_dmg, 1 AS pri, cp.fetched_at
          FROM card_prices cp WHERE cp.card_id = c.id
        ) x ORDER BY x.pri, x.fetched_at DESC LIMIT 1
      ) p ON TRUE"""

    // ── share settings ──────────────────────────────────────────────────────

    def getShare(userId: String): Task[Option[ShareSettings]] =
      sql"SELECT slug, enabled, collection_public, bio FROM share_profiles WHERE user_id = $userId"
        .query[ShareRow].option.map(_.map(toShare)).transact(xa)

    def ensureShare(userId: String, slug: String): Task[ShareSettings] =
      (sql"INSERT INTO share_profiles (user_id, slug) VALUES ($userId, $slug) ON CONFLICT (user_id) DO NOTHING".update.run *>
        sql"SELECT slug, enabled, collection_public, bio FROM share_profiles WHERE user_id = $userId"
          .query[ShareRow].unique.map(toShare)).transact(xa)

    def updateShare(userId: String, enabled: Boolean, collectionPublic: Boolean, bio: Option[String]): Task[Unit] =
      sql"""UPDATE share_profiles SET enabled = $enabled, collection_public = $collectionPublic,
              bio = $bio, updated_at = NOW() WHERE user_id = $userId""".update.run.void.transact(xa)

    def setSlug(userId: String, slug: String): Task[Unit] =
      sql"UPDATE share_profiles SET slug = $slug, updated_at = NOW() WHERE user_id = $userId"
        .update.run.void.transact(xa)

    def findShareBySlug(slug: String): Task[Option[(String, ShareSettings)]] =
      sql"""SELECT user_id, slug, enabled, collection_public, bio FROM share_profiles
            WHERE slug = $slug AND enabled"""
        .query[(String, String, Boolean, Boolean, Option[String])].option
        .map(_.map { case (uid, s, en, pub, bio) => (uid, ShareSettings(s, en, pub, bio)) })
        .transact(xa)

    // ── trade list ──────────────────────────────────────────────────────────

    def listTradeItems(userId: String, game: String): Task[List[TradeListItem]] =
      (fr"SELECT t.id, t.condition, t.quantity, t.asking_price, t.note, t.updated_at," ++ cardCols ++
        fr"""FROM trade_list_items t
             JOIN cards c ON c.id = t.card_id""" ++ priceJoin(fr"t.condition") ++
        fr"""WHERE t.user_id = $userId AND c.game_id = $game
             ORDER BY c.name, t.condition""")
        .query[((String, String, Int, Option[Double], Option[String], Instant), CardRow)].to[List]
        .map(_.map { case ((id, cond, qty, ask, note, at), card) =>
          TradeListItem(id, view(card, cond, qty), ask, note, at)
        })
        .transact(xa)

    def upsertTradeItem(userId: String, cardId: String, condition: String, quantity: Int,
                        askingPrice: Option[Double], note: Option[String]): Task[Unit] =
      sql"""INSERT INTO trade_list_items (user_id, card_id, condition, quantity, asking_price, note)
            VALUES ($userId, $cardId, $condition, $quantity, $askingPrice, $note)
            ON CONFLICT (user_id, card_id, condition) DO UPDATE SET
              quantity = EXCLUDED.quantity, asking_price = EXCLUDED.asking_price,
              note = EXCLUDED.note, updated_at = NOW()""".update.run.void.transact(xa)

    def deleteTradeItem(userId: String, itemId: String): Task[Unit] =
      sql"DELETE FROM trade_list_items WHERE id = $itemId AND user_id = $userId".update.run.void.transact(xa)

    def upsertTradeItems(userId: String, items: List[(String, String, Int, Option[Double])]): Task[Unit] =
      Update[(String, String, String, Int, Option[Double])](
        """INSERT INTO trade_list_items (user_id, card_id, condition, quantity, asking_price)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, card_id, condition) DO UPDATE SET
             quantity = EXCLUDED.quantity, asking_price = EXCLUDED.asking_price, updated_at = NOW()"""
      ).updateMany(items.map { case (c, k, q, p) => (userId, c, k, q, p) }).void.transact(xa)

    def deleteTradeItems(userId: String, itemIds: List[String]): Task[Int] =
      if itemIds.isEmpty then ZIO.succeed(0)
      else sql"DELETE FROM trade_list_items WHERE user_id = $userId AND id = ANY(${itemIds.toArray})"
        .update.run.transact(xa)

    def listedQuantity(userId: String, cardId: String, condition: String): Task[Int] =
      sql"""SELECT COALESCE(SUM(quantity), 0)::int FROM trade_list_items
            WHERE user_id = $userId AND card_id = $cardId AND condition = $condition"""
        .query[Int].unique.transact(xa)

    // ── collection reads ────────────────────────────────────────────────────

    def ownedQuantity(userId: String, cardId: String, condition: String): Task[Int] =
      sql"""SELECT COALESCE(SUM(GREATEST(0, COALESCE((item->>'quantity')::int, 0))), 0)::int
            FROM collection_entries ce
            CROSS JOIN LATERAL jsonb_array_elements(ce.conditions::jsonb) item
            WHERE ce.user_id = $userId AND ce.card_id = $cardId AND item->>'condition' = $condition"""
        .query[Int].unique.transact(xa)

    def ownedQuantities(userId: String, cardIds: List[String]): Task[Map[(String, String), Int]] =
      cardIds.distinct match
        case Nil => ZIO.succeed(Map.empty)
        case ids =>
          sql"""SELECT ce.card_id, item->>'condition',
                       SUM(GREATEST(0, COALESCE((item->>'quantity')::int, 0)))::int
                FROM collection_entries ce
                CROSS JOIN LATERAL jsonb_array_elements(ce.conditions::jsonb) item
                WHERE ce.user_id = $userId AND ce.card_id = ANY(${ids.toArray})
                GROUP BY ce.card_id, item->>'condition'"""
            .query[(String, String, Int)].to[List]
            .map(_.map { case (c, k, n) => (c, k) -> n }.toMap)
            .transact(xa)

    def publicCollection(userId: String, game: String): Task[List[TradeCardView]] =
      (fr"SELECT item->>'condition', (item->>'quantity')::int," ++ cardCols ++
        fr"""FROM collection_entries ce
             CROSS JOIN LATERAL jsonb_array_elements(ce.conditions::jsonb) item
             JOIN cards c ON c.id = ce.card_id""" ++ priceJoin(fr"item->>'condition'") ++
        fr"""WHERE ce.user_id = $userId AND c.game_id = $game AND COALESCE((item->>'quantity')::int, 0) > 0
             ORDER BY c.set_id, c.number, item->>'condition'""")
        .query[((String, Int), CardRow)].to[List]
        .map(_.map { case ((cond, qty), card) => view(card, cond, qty) })
        .transact(xa)

    def tradeGames(userId: String, withCollection: Boolean): Task[List[String]] =
      sql"""SELECT DISTINCT c.game_id FROM trade_list_items t JOIN cards c ON c.id = t.card_id WHERE t.user_id = $userId
            UNION
            SELECT DISTINCT c.game_id FROM collection_entries ce JOIN cards c ON c.id = ce.card_id
            WHERE $withCollection AND ce.user_id = $userId"""
        .query[String].to[List].transact(xa)

    def gamesOfCards(cardIds: List[String]): Task[List[String]] =
      cardIds.distinct match
        case Nil => ZIO.succeed(Nil)
        case ids => sql"SELECT DISTINCT game_id FROM cards WHERE id = ANY(${ids.toArray})".query[String].to[List].transact(xa)

    def cardView(cardId: String, condition: String, quantity: Int): Task[Option[TradeCardView]] =
      (fr"SELECT" ++ cardCols ++
        fr"FROM cards c" ++ priceJoin(fr"$condition") ++ fr"WHERE c.id = $cardId")
        .query[CardRow].option.map(_.map(view(_, condition, quantity))).transact(xa)

    // ── offers ──────────────────────────────────────────────────────────────

    def createOffer(sellerId: String, buyerId: String, wants: List[OfferCard], gives: List[OfferCard],
                    cashAmount: Option[Double], firstMessage: Option[String], game: String): Task[String] =
      val id = java.util.UUID.randomUUID().toString
      val wantsJson = wants.toJson
      val givesJson = gives.toJson
      (for
        _ <- sql"""INSERT INTO card_offers (id, seller_id, buyer_id, wants, gives, cash_amount, buyer_read_at, game_id)
                   VALUES ($id, $sellerId, $buyerId, $wantsJson::jsonb, $givesJson::jsonb, $cashAmount, NOW(), $game)""".update.run
        _ <- firstMessage.traverse_ { body =>
               sql"INSERT INTO offer_messages (offer_id, sender_id, body) VALUES ($id, $buyerId, $body)".update.run
             }
      yield id).transact(xa)

    private type OfferRow = (String, String, String, String, String, Option[Double], String,
                             Option[Instant], Option[Instant], Instant, Instant, String, String)

    private val offerSelect = fr"""SELECT o.id, o.seller_id, o.buyer_id, o.wants::text, o.gives::text, o.cash_amount,
        o.status, o.seller_read_at, o.buyer_read_at, o.created_at, o.updated_at, s.username, b.username
      FROM card_offers o
      JOIN users s ON s.id = o.seller_id
      JOIN users b ON b.id = o.buyer_id"""

    private def toOffer(viewerId: String, messages: List[OfferMessage])(r: OfferRow): CardOffer =
      val (id, sellerId, _, wantsJson, givesJson, cash, status, sellerRead, buyerRead, created, updated, sellerName, buyerName) = r
      val isSeller = viewerId == sellerId
      val readAt = if isSeller then sellerRead else buyerRead
      CardOffer(
        id         = id,
        role       = if isSeller then "seller" else "buyer",
        otherUser  = if isSeller then buyerName else sellerName,
        wants      = wantsJson.fromJson[List[OfferCard]].getOrElse(Nil),
        gives      = givesJson.fromJson[List[OfferCard]].getOrElse(Nil),
        cashAmount = cash,
        status     = status,
        unread     = readAt.forall(_.isBefore(updated)),
        createdAt  = created,
        updatedAt  = updated,
        messages   = messages
      )

    def listOffers(userId: String, game: String): Task[List[CardOffer]] =
      (offerSelect ++ fr"WHERE (o.seller_id = $userId OR o.buyer_id = $userId) AND o.game_id = $game ORDER BY o.updated_at DESC LIMIT 200")
        .query[OfferRow].to[List].map(_.map(toOffer(userId, Nil))).transact(xa)

    def findOffer(offerId: String, userId: String): Task[Option[CardOffer]] =
      (for
        row  <- (offerSelect ++ fr"WHERE o.id = $offerId AND (o.seller_id = $userId OR o.buyer_id = $userId)")
                  .query[OfferRow].option
        msgs <- row.fold(List.empty[OfferMessage].pure[ConnectionIO]) { _ =>
                  sql"""SELECT m.id, m.sender_id, u.username, m.body, m.created_at
                        FROM offer_messages m JOIN users u ON u.id = m.sender_id
                        WHERE m.offer_id = $offerId ORDER BY m.created_at"""
                    .query[(String, String, String, String, Instant)].to[List]
                    .map(_.map(OfferMessage.apply.tupled))
                }
      yield row.map(toOffer(userId, msgs))).transact(xa)

    def offerParties(offerId: String): Task[Option[(String, String, String)]] =
      sql"SELECT seller_id, buyer_id, status FROM card_offers WHERE id = $offerId"
        .query[(String, String, String)].option.transact(xa)

    /** Bumps updated_at (so the other side sees it as unread) and marks it
     *  read for the actor, who obviously already knows. */
    private def touch(offerId: String, actorId: String): ConnectionIO[Int] =
      sql"""UPDATE card_offers SET updated_at = NOW(),
              seller_read_at = CASE WHEN seller_id = $actorId THEN NOW() ELSE seller_read_at END,
              buyer_read_at  = CASE WHEN buyer_id  = $actorId THEN NOW() ELSE buyer_read_at  END
            WHERE id = $offerId""".update.run

    def setStatus(offerId: String, from: String, to: String, actorId: String): Task[Boolean] =
      sql"UPDATE card_offers SET status = $to WHERE id = $offerId AND status = $from".update.run
        .flatMap(n => if n == 1 then touch(offerId, actorId).as(true) else false.pure[ConnectionIO])
        .transact(xa)

    def addMessage(offerId: String, senderId: String, body: String): Task[Unit] =
      (sql"INSERT INTO offer_messages (offer_id, sender_id, body) VALUES ($offerId, $senderId, $body)".update.run *>
        touch(offerId, senderId)).void.transact(xa)

    def markRead(offerId: String, userId: String): Task[Unit] =
      sql"""UPDATE card_offers SET
              seller_read_at = CASE WHEN seller_id = $userId THEN NOW() ELSE seller_read_at END,
              buyer_read_at  = CASE WHEN buyer_id  = $userId THEN NOW() ELSE buyer_read_at  END
            WHERE id = $offerId""".update.run.void.transact(xa)

    def unreadCount(userId: String, game: String): Task[Int] =
      sql"""SELECT COUNT(*)::int FROM card_offers
            WHERE game_id = $game AND (
                  (seller_id = $userId AND (seller_read_at IS NULL OR seller_read_at < updated_at))
               OR (buyer_id  = $userId AND (buyer_read_at  IS NULL OR buyer_read_at  < updated_at)))"""
        .query[Int].unique.transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, TradingRepository] =
    ZLayer.fromFunction(new Live(_))
