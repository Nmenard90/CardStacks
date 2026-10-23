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
  /** (sellerUserId, messengerUrl) — only when that shop is switched on. */
  def findPublicSeller(slug: String): Task[Option[(String, String)]]
  def create(sellerUserId: String, input: ShopRequestInput): Task[ShopRequest]
  def list(sellerUserId: String): Task[List[ShopRequest]]
  def setStatus(sellerUserId: String, id: String, status: String): Task[Unit]

object ShopRepository:
  final class Live(xa: Transactor[Task]) extends ShopRepository:
    private type Row = (String, String, String, String, String, String, String, Instant)

    private def toRequest(r: Row): ShopRequest =
      val (id, name, contact, msg, kind, itemsJson, status, at) = r
      ShopRequest(id, name, contact, msg, kind, itemsJson.fromJson[List[ShopRequestItem]].getOrElse(Nil), status, at)

    def getSettings(userId: String): Task[Option[ShopSettings]] =
      sql"SELECT slug,enabled,messenger_url FROM shop_settings WHERE user_id=$userId"
        .query[(String, Boolean, String)].option.map(_.map(ShopSettings.apply.tupled)).transact(xa)

    def saveSettings(userId: String, s: ShopSettings): Task[Unit] =
      val now = Instant.now()
      sql"""INSERT INTO shop_settings(user_id,slug,enabled,messenger_url,updated_at)
        VALUES($userId,${s.slug},${s.enabled},${s.messengerUrl},$now)
        ON CONFLICT (user_id) DO UPDATE
          SET slug=EXCLUDED.slug, enabled=EXCLUDED.enabled,
              messenger_url=EXCLUDED.messenger_url, updated_at=EXCLUDED.updated_at"""
        .update.run.transact(xa).unit

    def findPublicSeller(slug: String): Task[Option[(String, String)]] =
      sql"SELECT user_id,messenger_url FROM shop_settings WHERE slug=$slug AND enabled=TRUE"
        .query[(String, String)].option.transact(xa)

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

  val layer: ZLayer[Transactor[Task], Nothing, ShopRepository] = ZLayer.fromFunction(new Live(_))
