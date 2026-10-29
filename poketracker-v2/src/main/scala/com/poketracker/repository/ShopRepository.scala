/**
 * ShopRepository — storage for each user's shop switch (shop_settings) and
 * the buyer requests sent from their public page (shop_requests).
 * Tables: sql/migration_017_shop_requests.sql.
 */
package com.poketracker.repository

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
  def create(sellerUserId: String, input: ShopRequestInput): Task[ShopRequest]
  def list(sellerUserId: String): Task[List[ShopRequest]]
  def setStatus(sellerUserId: String, id: String, status: String): Task[Unit]
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
    private type Row = (String, String, String, String, String, String, String, Instant)

    private def toRequest(r: Row): ShopRequest =
      val (id, name, contact, msg, kind, itemsJson, status, at) = r
      ShopRequest(id, name, contact, msg, kind, itemsJson.fromJson[List[ShopRequestItem]].getOrElse(Nil), status, at)

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

    def create(sellerUserId: String, input: ShopRequestInput): Task[ShopRequest] =
      val id    = java.util.UUID.randomUUID().toString
      val now   = Instant.now()
      val kind  = if input.items.isEmpty then "chat" else "buy"
      val items = input.items.toJson
      sql"""INSERT INTO shop_requests(id,seller_user_id,buyer_name,buyer_contact,message,kind,items,status,created_at)
        VALUES($id,$sellerUserId,${input.buyerName},${input.buyerContact},${input.message},$kind,$items::jsonb,'new',$now)"""
        .update.run.transact(xa)
        .as(ShopRequest(id, input.buyerName, input.buyerContact, input.message, kind, input.items, "new", now))

    def list(sellerUserId: String): Task[List[ShopRequest]] =
      sql"""SELECT id,buyer_name,buyer_contact,message,kind,items::text,status,created_at
        FROM shop_requests WHERE seller_user_id=$sellerUserId ORDER BY created_at DESC LIMIT 200"""
        .query[Row].to[List].map(_.map(toRequest)).transact(xa)

    def setStatus(sellerUserId: String, id: String, status: String): Task[Unit] =
      sql"UPDATE shop_requests SET status=$status WHERE id=$id AND seller_user_id=$sellerUserId"
        .update.run.transact(xa).unit

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
