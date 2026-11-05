/**
 * ShopRepository — storage for each user's shop switch (shop_settings) and
 * the buyer requests sent from their public page (shop_requests).
 * Tables: sql/migration_017_shop_requests.sql.
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

trait ShopRepository:
  def getSettings(userId: String): Task[Option[ShopSettings]]
  /** Fails with a unique-violation if another user already owns the slug. */
  def saveSettings(userId: String, s: ShopSettings): Task[Unit]
  /** (sellerUserId, messengerUrl, displayName, bio), only for enabled shops. */
  def findPublicSeller(slug: String): Task[Option[(String, String, String, String)]]
  /** The enabled shop of whoever owned an old share-link slug (/s/<slug>), so
   *  links handed out before trading moved into the shop still lead somewhere. */
  def shopSlugForShareLink(shareSlug: String): Task[Option[String]]
  /** The email someone signs in with, for request and chat emails; None for a demo (anonymous) account. */
  def accountEmail(userId: String): Task[Option[String]]
  /** The username of a real (not demo) account, shown to the seller as the buyer's name; None for a demo account. */
  def accountName(userId: String): Task[Option[String]]
  /** Saves a new request; `buyerUserId` is the signed-in buyer (None only for requests from before chat). */
  def create(sellerUserId: String, input: ShopRequestInput, buyerUserId: Option[String]): Task[ShopRequest]
  /** "Ask for photos" from a card tile: adds the card to this buyer's open photo request to this seller (making one
   *  when there is none). The Boolean is false when they had already asked for that card and condition. */
  def askPhotos(sellerUserId: String, buyerUserId: String, buyerName: String, item: ShopRequestItem): Task[(ShopRequest, Boolean)]
  /** The seller's inbox, newest first, each with `unread` = the buyer wrote since the seller last opened it. */
  def list(sellerUserId: String): Task[List[ShopRequest]]
  /** Requests a buyer sent, newest first: (request, shop slug, shop name, unread = the seller wrote since they looked). */
  def listSent(buyerUserId: String): Task[List[(ShopRequest, String, String, Boolean)]]
  /** One request this buyer sent: (request, seller's user id, shop slug, shop name), or None when it isn't theirs. */
  def findSent(buyerUserId: String, id: String): Task[Option[(ShopRequest, String, String, String)]]
  /** A request's chat, oldest first: (id, sender's user id, body, sent at). */
  def messages(requestId: String): Task[List[(String, String, String, Instant)]]
  /** Adds a chat message. When the seller writes on a new request it counts as answered. */
  def addMessage(requestId: String, senderUserId: String, body: String): Task[Unit]
  /** Marks the chat read for whichever side `userId` is on. */
  def markRead(requestId: String, userId: String): Task[Unit]
  /** One of this seller's requests by its id (the buyer's link), or None. */
  def find(sellerUserId: String, id: String): Task[Option[ShopRequest]]
  def setStatus(sellerUserId: String, id: String, status: String): Task[Unit]
  /** Changes the request's card at `index` with `change` (Left = message for the seller), in one transaction so two
   *  quick taps can't undo each other. None when the request isn't this seller's or has no card there. */
  def updateItem(sellerUserId: String, id: String, index: Int, change: ShopRequestItem => Either[String, ShopRequestItem]): Task[Option[Either[String, ShopRequestItem]]]
  /** Completes a sale: takes each card's found copies that aren't sold yet out of the seller's collection (only
   *  those, so a missing card stays, and never twice), records them as sold and marks the request done, all in one
   *  transaction. None when the request isn't this seller's. */
  def sell(sellerUserId: String, id: String): Task[Option[SaleResult]]
  /** A refund or a sale that fell through: puts the sold copies of the card at `index` (every card's, when None)
   *  back in the seller's collection, in one transaction. None when the request isn't this seller's. */
  def putBack(sellerUserId: String, id: String, index: Option[Int]): Task[Option[ShopRequest]]
  /** Which photos a seller has (no image bytes). */
  def listPhotos(userId: String): Task[List[ShopPhotoRef]]
  /** (jpeg bytes, last-changed epoch millis) for one photo. */
  def getPhoto(userId: String, cardId: String, condition: String, side: String): Task[Option[(Array[Byte], Long)]]
  /** Adds or replaces a photo. False (nothing stored) when the seller is at the photo limit and this would be a new one. */
  def savePhoto(userId: String, cardId: String, condition: String, side: String, jpeg: Array[Byte]): Task[Boolean]
  def deletePhoto(userId: String, cardId: String, condition: String, side: String): Task[Unit]

object ShopRepository:
  /** Most photos one seller can keep (a stack of 200 cards with a front and back each). */
  val MaxPhotosPerUser = 400

  final class Live(xa: Transactor[Task]) extends ShopRepository:
    private type Row = (String, String, String, String, String, String, String, Instant, Option[String])

    /** The request columns, in Row's order; `p` is a table alias prefix such as "r.". */
    private def cols(p: String = ""): Fragment =
      Fragment.const(List("id", "buyer_name", "buyer_contact", "message", "kind", "items::text", "status", "created_at", "buyer_user_id")
        .map(p + _).mkString(","))

    private def toRequest(r: Row): ShopRequest =
      val (id, name, contact, msg, kind, itemsJson, status, at, buyer) = r
      ShopRequest(id, name, contact, msg, kind, itemsJson.fromJson[List[ShopRequestItem]].getOrElse(Nil), status, at, buyer)

    /** True when the other side wrote after `readCol` (the reader's last look); `fromSeller` picks whose messages count. */
    private def unreadFr(readCol: String, fromSeller: Boolean): Fragment =
      val who = if fromSeller then fr"m.sender_user_id = r.seller_user_id" else fr"m.sender_user_id <> r.seller_user_id"
      fr"EXISTS (SELECT 1 FROM shop_request_messages m WHERE m.request_id = r.id AND" ++ who ++
        Fragment.const(s"AND m.created_at > COALESCE(r.$readCol, '-infinity'::timestamptz))")

    def getSettings(userId: String): Task[Option[ShopSettings]] =
      sql"SELECT slug,enabled,messenger_url,display_name,bio FROM shop_settings WHERE user_id=$userId"
        .query[(String, Boolean, String, String, String)].option.map(_.map(ShopSettings.apply.tupled)).transact(xa)

    def saveSettings(userId: String, s: ShopSettings): Task[Unit] =
      val now = Instant.now()
      sql"""INSERT INTO shop_settings(user_id,slug,enabled,messenger_url,display_name,bio,updated_at)
        VALUES($userId,${s.slug},${s.enabled},${s.messengerUrl},${s.displayName},${s.bio},$now)
        ON CONFLICT (user_id) DO UPDATE
          SET slug=EXCLUDED.slug, enabled=EXCLUDED.enabled,
              messenger_url=EXCLUDED.messenger_url, display_name=EXCLUDED.display_name,
              bio=EXCLUDED.bio, updated_at=EXCLUDED.updated_at"""
        .update.run.transact(xa).unit

    def findPublicSeller(slug: String): Task[Option[(String, String, String, String)]] =
      sql"SELECT user_id,messenger_url,display_name,bio FROM shop_settings WHERE slug=$slug AND enabled=TRUE"
        .query[(String, String, String, String)].option.transact(xa)

    def shopSlugForShareLink(shareSlug: String): Task[Option[String]] =
      sql"""SELECT s.slug FROM share_profiles p JOIN shop_settings s ON s.user_id = p.user_id
            WHERE p.slug = $shareSlug AND s.enabled = TRUE"""
        .query[String].option.transact(xa)

    def accountEmail(userId: String): Task[Option[String]] =
      sql"SELECT email FROM users WHERE id=$userId AND is_anonymous=FALSE"
        .query[String].option.map(_.map(_.trim).filter(_.contains("@"))).transact(xa)

    def accountName(userId: String): Task[Option[String]] =
      sql"SELECT username FROM users WHERE id=$userId AND is_anonymous=FALSE".query[String].option.transact(xa)

    /** Inserts a request; the buyer has read their own request, so only the seller's later messages count as unread. */
    private def insert(sellerUserId: String, input: ShopRequestInput, buyerUserId: Option[String], kind: String): ConnectionIO[ShopRequest] =
      val id    = java.util.UUID.randomUUID().toString
      val now   = Instant.now()
      val items = input.items.toJson
      val read  = buyerUserId.map(_ => now)
      sql"""INSERT INTO shop_requests(id,seller_user_id,buyer_name,buyer_contact,message,kind,items,status,created_at,buyer_user_id,buyer_read_at)
        VALUES($id,$sellerUserId,${input.buyerName},${input.buyerContact},${input.message},$kind,$items::jsonb,'new',$now,$buyerUserId,$read)"""
        .update.run
        .as(ShopRequest(id, input.buyerName, input.buyerContact, input.message, kind, input.items, "new", now, buyerUserId))

    def create(sellerUserId: String, input: ShopRequestInput, buyerUserId: Option[String]): Task[ShopRequest] =
      insert(sellerUserId, input, buyerUserId, if input.items.isEmpty then "chat" else "buy").transact(xa)

    def askPhotos(sellerUserId: String, buyerUserId: String, buyerName: String, item: ShopRequestItem): Task[(ShopRequest, Boolean)] =
      (sql"SELECT " ++ cols() ++ fr"""FROM shop_requests
         WHERE seller_user_id=$sellerUserId AND buyer_user_id=$buyerUserId AND kind='photos' AND status<>'done'
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE""")
        .query[Row].option.map(_.map(toRequest)).flatMap {
          case Some(r) if r.items.exists(i => i.cardId == item.cardId && i.condition == item.condition) => FC.pure((r, false))
          case Some(r) =>
            val items = r.items :+ item
            sql"UPDATE shop_requests SET items=${items.toJson}::jsonb, status='new' WHERE id=${r.id}"
              .update.run.as((r.copy(items = items, status = "new"), true))
          case None =>
            insert(sellerUserId, ShopRequestInput(buyerName, "", "", List(item)), Some(buyerUserId), "photos").map((_, true))
        }.transact(xa)

    def list(sellerUserId: String): Task[List[ShopRequest]] =
      (sql"SELECT " ++ cols("r.") ++ fr"," ++ unreadFr("seller_read_at", fromSeller = false) ++
        fr"FROM shop_requests r WHERE r.seller_user_id=$sellerUserId ORDER BY r.created_at DESC LIMIT 200")
        .query[(Row, Boolean)].to[List].map(_.map((row, unread) => toRequest(row).copy(unread = unread))).transact(xa)

    def listSent(buyerUserId: String): Task[List[(ShopRequest, String, String, Boolean)]] =
      (sql"SELECT " ++ cols("r.") ++ fr", COALESCE(s.slug, ''), COALESCE(s.display_name, ''), " ++ unreadFr("buyer_read_at", fromSeller = true) ++
        fr"""FROM shop_requests r LEFT JOIN shop_settings s ON s.user_id = r.seller_user_id
            WHERE r.buyer_user_id=$buyerUserId ORDER BY r.created_at DESC LIMIT 200""")
        .query[(Row, String, String, Boolean)].to[List]
        .map(_.map((row, slug, name, unread) => (toRequest(row), slug, name, unread))).transact(xa)

    def findSent(buyerUserId: String, id: String): Task[Option[(ShopRequest, String, String, String)]] =
      (sql"SELECT " ++ cols("r.") ++ fr", r.seller_user_id, COALESCE(s.slug, ''), COALESCE(s.display_name, '')" ++
        fr"""FROM shop_requests r LEFT JOIN shop_settings s ON s.user_id = r.seller_user_id
            WHERE r.id=$id AND r.buyer_user_id=$buyerUserId""")
        .query[(Row, String, String, String)].option
        .map(_.map((row, seller, slug, name) => (toRequest(row), seller, slug, name))).transact(xa)

    def messages(requestId: String): Task[List[(String, String, String, Instant)]] =
      sql"""SELECT id,sender_user_id,body,created_at FROM shop_request_messages
            WHERE request_id=$requestId ORDER BY created_at LIMIT 500"""
        .query[(String, String, String, Instant)].to[List].transact(xa)

    def addMessage(requestId: String, senderUserId: String, body: String): Task[Unit] =
      (sql"INSERT INTO shop_request_messages(request_id,sender_user_id,body) VALUES($requestId,$senderUserId,$body)".update.run *>
        sql"UPDATE shop_requests SET status='answered' WHERE id=$requestId AND seller_user_id=$senderUserId AND status='new'".update.run)
        .void.transact(xa)

    def markRead(requestId: String, userId: String): Task[Unit] =
      sql"""UPDATE shop_requests SET
              seller_read_at = CASE WHEN seller_user_id = $userId THEN NOW() ELSE seller_read_at END,
              buyer_read_at  = CASE WHEN buyer_user_id  = $userId THEN NOW() ELSE buyer_read_at  END
            WHERE id = $requestId""".update.run.void.transact(xa)

    def find(sellerUserId: String, id: String): Task[Option[ShopRequest]] =
      (sql"SELECT " ++ cols() ++ fr"FROM shop_requests WHERE id=$id AND seller_user_id=$sellerUserId")
        .query[Row].option.map(_.map(toRequest)).transact(xa)

    def setStatus(sellerUserId: String, id: String, status: String): Task[Unit] =
      sql"UPDATE shop_requests SET status=$status WHERE id=$id AND seller_user_id=$sellerUserId"
        .update.run.transact(xa).unit

    def updateItem(sellerUserId: String, id: String, index: Int, change: ShopRequestItem => Either[String, ShopRequestItem]): Task[Option[Either[String, ShopRequestItem]]] =
      val run = for
        json   <- sql"SELECT items::text FROM shop_requests WHERE id=$id AND seller_user_id=$sellerUserId FOR UPDATE".query[String].option
        items   = json.flatMap(_.fromJson[List[ShopRequestItem]].toOption).getOrElse(Nil)
        result <- (items.lift(index) match
          case None       => FC.pure(None)
          case Some(item) => change(item) match
            case Left(msg)      => FC.pure(Some(Left(msg)))
            case Right(updated) =>
              val next = items.updated(index, updated).toJson
              sql"UPDATE shop_requests SET items=$next::jsonb WHERE id=$id AND seller_user_id=$sellerUserId"
                .update.run.map(_ => Some(Right(updated)))
        ): ConnectionIO[Option[Either[String, ShopRequestItem]]]
      yield result
      run.transact(xa)

    private def requestForUpdate(sellerUserId: String, id: String): ConnectionIO[Option[ShopRequest]] =
      (sql"SELECT " ++ cols() ++ fr"FROM shop_requests WHERE id=$id AND seller_user_id=$sellerUserId FOR UPDATE")
        .query[Row].option.map(_.map(toRequest))

    private def saveItems(sellerUserId: String, id: String, items: List[ShopRequestItem], status: String): ConnectionIO[Unit] =
      sql"UPDATE shop_requests SET items=${items.toJson}::jsonb, status=$status WHERE id=$id AND seller_user_id=$sellerUserId"
        .update.run.void

    /** Takes `due` copies for a card: its real condition first, then the condition the buyer picked (the seller may
     *  have corrected it while the collection still lists the copy the old way). Returns how many came out. */
    private def takeFound(userId: String, item: ShopRequestItem, due: Int): ConnectionIO[Int] =
      CollectionRepository.takeCopiesIO(userId, item.cardId, item.condition, due).flatMap { got =>
        item.askedCondition.filter(_ => got < due)
          .fold(FC.pure(got))(asked => CollectionRepository.takeCopiesIO(userId, item.cardId, asked, due - got).map(got + _))
      }

    def sell(sellerUserId: String, id: String): Task[Option[SaleResult]] =
      requestForUpdate(sellerUserId, id).flatMap {
        case None => FC.pure(None)
        case Some(request) =>
          request.items.traverse { item =>
            val due = item.found - item.soldQty
            if due <= 0 then FC.pure((item, 0, None))
            else takeFound(sellerUserId, item, due).map { taken =>
              val sold = item.soldQty + taken
              (item.copy(sold = Option.when(sold > 0)(sold)), taken,
                Option.when(taken < due)(SaleShortfall(item.name, item.number, item.condition, due, taken)))
            }
          }.flatMap { results =>
            val items = results.map(_._1)
            saveItems(sellerUserId, id, items, "done")
              .as(Some(SaleResult(request.copy(items = items, status = "done"), results.map(_._2).sum, results.flatMap(_._3))))
          }
      }.transact(xa)

    def putBack(sellerUserId: String, id: String, index: Option[Int]): Task[Option[ShopRequest]] =
      requestForUpdate(sellerUserId, id).flatMap {
        case None => FC.pure(None)
        case Some(request) =>
          request.items.zipWithIndex.traverse { (item, n) =>
            if index.forall(_ == n) && item.soldQty > 0 then
              CollectionRepository.returnCopiesIO(sellerUserId, item.cardId, item.condition, item.soldQty).as(item.copy(sold = None))
            else FC.pure(item)
          }.flatMap(items => saveItems(sellerUserId, id, items, request.status).as(Some(request.copy(items = items))))
      }.transact(xa)

    def listPhotos(userId: String): Task[List[ShopPhotoRef]] =
      sql"SELECT card_id,condition,side,updated_at FROM shop_photos WHERE user_id=$userId ORDER BY card_id,condition,side"
        .query[(String, String, String, Instant)].to[List]
        .map(_.map((c, k, s, at) => ShopPhotoRef(c, k, s, at.toEpochMilli))).transact(xa)

    def getPhoto(userId: String, cardId: String, condition: String, side: String): Task[Option[(Array[Byte], Long)]] =
      sql"SELECT image,updated_at FROM shop_photos WHERE user_id=$userId AND card_id=$cardId AND condition=$condition AND side=$side"
        .query[(Array[Byte], Instant)].option.map(_.map((bytes, at) => (bytes, at.toEpochMilli))).transact(xa)

    def savePhoto(userId: String, cardId: String, condition: String, side: String, jpeg: Array[Byte]): Task[Boolean] =
      val now = Instant.now()
      val find  = sql"SELECT 1 FROM shop_photos WHERE user_id=$userId AND card_id=$cardId AND condition=$condition AND side=$side".query[Int].option
      val count = sql"SELECT COUNT(*) FROM shop_photos WHERE user_id=$userId".query[Long].unique
      val upsert =
        sql"""INSERT INTO shop_photos(user_id,card_id,condition,side,image,content_type,updated_at)
          VALUES($userId,$cardId,$condition,$side,$jpeg,'image/jpeg',$now)
          ON CONFLICT (user_id,card_id,condition,side) DO UPDATE
            SET image=EXCLUDED.image, updated_at=EXCLUDED.updated_at""".update.run
      // One transaction: stay under the per-seller limit unless this replaces a photo they already have.
      (for
        existing <- find
        total    <- count
        ok        = existing.isDefined || total < MaxPhotosPerUser
        _        <- if ok then upsert.map(_ => ()) else doobie.free.connection.unit
      yield ok).transact(xa)

    def deletePhoto(userId: String, cardId: String, condition: String, side: String): Task[Unit] =
      sql"DELETE FROM shop_photos WHERE user_id=$userId AND card_id=$cardId AND condition=$condition AND side=$side"
        .update.run.transact(xa).unit

  val layer: ZLayer[Transactor[Task], Nothing, ShopRepository] = ZLayer.fromFunction(new Live(_))
