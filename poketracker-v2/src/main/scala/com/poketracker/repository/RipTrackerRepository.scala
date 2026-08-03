/**
 * FILE: RipTrackerRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/RipTrackerRepository.scala
 *
 * PURPOSE:
 *   All database operations for the Rip Tracker feature: sealed products
 *   and their guaranteed contents/pull rates, and rip (box-opening)
 *   sessions/packs/pulls. Mirrors CardRepository/CollectionRepository's
 *   pattern — this is the only file with SQL for these eight tables
 *   (Migration 004 in sql/schema.sql).
 *
 * NOT WIRED INTO Main.scala YET. Migration 004 has not been run against
 * production — see AGENTS.md's migration-before-deploy rule. Every query
 * here will fail with "relation does not exist" against the current live
 * schema, same as the earlier card_prices.variant outage. Do not add this
 * repository's layer to Main.scala's dependency graph, and do not route
 * live traffic to it, until Migration 004 has actually been run.
 *
 * USED BY: (future) RipTrackerService, once wired
 * DEPENDS ON: Doobie, ZIO, PostgreSQL, RipTracker models
 */

package com.poketracker.repository

import com.poketracker.models.*
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*
import zio.json.*
import java.time.Instant

/**
 * TRAIT: RipTrackerRepository
 * PURPOSE: Interface for all Rip Tracker data access.
 */
trait RipTrackerRepository:

  /** Fetches one sealed product by ID. */
  def findSealedProduct(id: String): Task[Option[SealedProduct]]

  /** Every sealed product for a set, e.g. to populate a "pick a product" list. */
  def findSealedProductsForSet(setId: String): Task[List[SealedProduct]]

  /** Every pack template for a product (usually one, sometimes more for variants). */
  def findPackTemplates(sealedProductId: String): Task[List[PackTemplate]]

  /** Every guaranteed non-pack insert (promos, sealed inserts) for a product. */
  def findProductInserts(sealedProductId: String): Task[List[ProductInsert]]

  /** Every pack-level guarantee for a product. Empty for ungoverned (has_guarantee=false) products. */
  def findProductGuarantees(sealedProductId: String): Task[List[ProductGuarantee]]

  /** The full pull-rate table for a product — every card with published/community odds. */
  def findPullRates(sealedProductId: String): Task[List[PullRate]]

  /**
   * Creates a rip session AND its rip_packs in one transaction, generating
   * one RipPack per index from 0 until `packCount`.
   * @param id               Session ID (caller-generated, so it can be
   *                         returned immediately without a round trip).
   * @param userId           Who's running this rip.
   * @param sealedProductId  Which product is being opened.
   * @param packCount        How many packs to generate.
   * @return                 The created session and its generated packs.
   */
  def createSessionWithPacks(
    id:              String,
    userId:          String,
    sealedProductId: String,
    packCount:       Int
  ): Task[(RipSession, List[RipPack])]

  /** Fetches one rip session by ID. */
  def findSession(id: String): Task[Option[RipSession]]

  /** Which session a pack belongs to — the only path from a pack ID (what
   *  the pulls endpoint receives) back to the userId a pull should be
   *  recorded against. */
  def findSessionIdForPack(ripPackId: String): Task[Option[String]]

  /** Every pack in a session, ordered by pack index. */
  def findPacksForSession(ripSessionId: String): Task[List[RipPack]]

  /** Every pull recorded across every pack in a session, newest first. */
  def findPullsForSession(ripSessionId: String): Task[List[Pull]]

  /**
   * Records one pull into a pack.
   * @param id                  Pull ID (caller-generated).
   * @param ripPackId           Which pack this card came from.
   * @param cardId              The card pulled.
   * @param condition           Logged condition, e.g. "NM".
   * @param collectionEntryId   Provenance link to the collection entry this
   *                            pull added to.
   * @return                    The created Pull.
   */
  def insertPull(
    id:                String,
    ripPackId:         String,
    cardId:            String,
    condition:         String,
    collectionEntryId: Option[String]
  ): Task[Pull]

object RipTrackerRepository:

  final class Live(xa: Transactor[Task]) extends RipTrackerRepository:

    /** Parses a PackTemplate row's JSONB slots column. Falls back to an
     *  empty slot list if the stored JSON is somehow malformed rather than
     *  failing the whole query over one bad row. */
    private def parseSlots(json: String): List[PackSlot] =
      json.fromJson[List[PackSlot]].getOrElse(Nil)

    def findSealedProduct(id: String): Task[Option[SealedProduct]] =
      sql"""
        SELECT id, name, set_id, kind, pack_count, has_guarantee,
               current_sealed_price, sealed_price_source, sealed_price_updated_at,
               created_at, updated_at
        FROM sealed_products
        WHERE id = $id
      """
        .query[(String, String, String, String, Int, Boolean,
                Option[Double], Option[String], Option[Instant], Instant, Instant)]
        .option
        .map(_.map(SealedProduct.apply.tupled))
        .transact(xa)

    def findSealedProductsForSet(setId: String): Task[List[SealedProduct]] =
      sql"""
        SELECT id, name, set_id, kind, pack_count, has_guarantee,
               current_sealed_price, sealed_price_source, sealed_price_updated_at,
               created_at, updated_at
        FROM sealed_products
        WHERE set_id = $setId
        ORDER BY name
      """
        .query[(String, String, String, String, Int, Boolean,
                Option[Double], Option[String], Option[Instant], Instant, Instant)]
        .to[List]
        .map(_.map(SealedProduct.apply.tupled))
        .transact(xa)

    def findPackTemplates(sealedProductId: String): Task[List[PackTemplate]] =
      sql"""
        SELECT id, sealed_product_id, name, slots::text, created_at
        FROM pack_templates
        WHERE sealed_product_id = $sealedProductId
      """
        .query[(String, String, String, String, Instant)]
        .to[List]
        .map(_.map { case (id, pid, name, slotsJson, createdAt) =>
          PackTemplate(id, pid, name, parseSlots(slotsJson), createdAt)
        })
        .transact(xa)

    def findProductInserts(sealedProductId: String): Task[List[ProductInsert]] =
      sql"""
        SELECT id, sealed_product_id, card_id, description, guaranteed, quantity
        FROM product_inserts
        WHERE sealed_product_id = $sealedProductId
      """
        .query[(String, String, Option[String], Option[String], Boolean, Int)]
        .to[List]
        .map(_.map(ProductInsert.apply.tupled))
        .transact(xa)

    def findProductGuarantees(sealedProductId: String): Task[List[ProductGuarantee]] =
      sql"""
        SELECT id, sealed_product_id, rarity, card_id, quantity
        FROM product_guarantees
        WHERE sealed_product_id = $sealedProductId
      """
        .query[(String, String, Option[String], Option[String], Int)]
        .to[List]
        .map(_.map(ProductGuarantee.apply.tupled))
        .transact(xa)

    def findPullRates(sealedProductId: String): Task[List[PullRate]] =
      sql"""
        SELECT id, card_id, sealed_product_id, per_pack_probability, source, sample_size, created_at
        FROM pull_rates
        WHERE sealed_product_id = $sealedProductId
      """
        .query[(String, String, String, Double, String, Option[Int], Instant)]
        .to[List]
        .map(_.map(PullRate.apply.tupled))
        .transact(xa)

    def createSessionWithPacks(
      id:              String,
      userId:          String,
      sealedProductId: String,
      packCount:       Int
    ): Task[(RipSession, List[RipPack])] =
      val now = Instant.now()
      val insertSession = sql"""
        INSERT INTO rip_sessions (id, user_id, sealed_product_id, status, created_at)
        VALUES ($id, $userId, $sealedProductId, 'in_progress', $now)
      """.update.run

      // One RipPack per index — generated here rather than by the caller so
      // "how many packs does this product have" stays a single source of
      // truth (SealedProduct.packCount), not duplicated into request bodies.
      val packIds = List.fill(packCount)(java.util.UUID.randomUUID().toString)
      val insertPacks = (packIds.zipWithIndex).traverse_ { case (packId, idx) =>
        sql"""
          INSERT INTO rip_packs (id, rip_session_id, pack_index)
          VALUES ($packId, $id, $idx)
        """.update.run
      }

      (insertSession *> insertPacks).transact(xa).as(
        (
          RipSession(id, userId, sealedProductId, RipSessionStatus.InProgress, now),
          packIds.zipWithIndex.map { case (packId, idx) => RipPack(packId, id, idx) }
        )
      )

    def findSession(id: String): Task[Option[RipSession]] =
      sql"""
        SELECT id, user_id, sealed_product_id, status, created_at
        FROM rip_sessions
        WHERE id = $id
      """
        .query[(String, String, String, String, Instant)]
        .option
        .map(_.map { case (id, userId, productId, status, createdAt) =>
          val parsedStatus = if status == "completed" then RipSessionStatus.Completed else RipSessionStatus.InProgress
          RipSession(id, userId, productId, parsedStatus, createdAt)
        })
        .transact(xa)

    def findSessionIdForPack(ripPackId: String): Task[Option[String]] =
      sql"""
        SELECT rip_session_id FROM rip_packs WHERE id = $ripPackId
      """
        .query[String]
        .option
        .transact(xa)

    def findPacksForSession(ripSessionId: String): Task[List[RipPack]] =
      sql"""
        SELECT id, rip_session_id, pack_index
        FROM rip_packs
        WHERE rip_session_id = $ripSessionId
        ORDER BY pack_index
      """
        .query[(String, String, Int)]
        .to[List]
        .map(_.map(RipPack.apply.tupled))
        .transact(xa)

    def findPullsForSession(ripSessionId: String): Task[List[Pull]] =
      sql"""
        SELECT pl.id, pl.rip_pack_id, pl.card_id, pl.condition, pl.collection_entry_id, pl.created_at
        FROM pulls pl
        JOIN rip_packs pk ON pk.id = pl.rip_pack_id
        WHERE pk.rip_session_id = $ripSessionId
        ORDER BY pl.created_at DESC
      """
        .query[(String, String, String, String, Option[String], Instant)]
        .to[List]
        .map(_.map { case (id, packId, cardId, cond, entryId, createdAt) =>
          Pull(id, packId, cardId, cond, entryId, createdAt)
        })
        .transact(xa)

    def insertPull(
      id:                String,
      ripPackId:         String,
      cardId:            String,
      condition:         String,
      collectionEntryId: Option[String]
    ): Task[Pull] =
      val now = Instant.now()
      sql"""
        INSERT INTO pulls (id, rip_pack_id, card_id, condition, collection_entry_id, created_at)
        VALUES ($id, $ripPackId, $cardId, $condition, $collectionEntryId, $now)
      """.update.run.transact(xa)
        .as(Pull(id, ripPackId, cardId, condition, collectionEntryId, now))

  val layer: ZLayer[Transactor[Task], Nothing, RipTrackerRepository] =
    ZLayer.fromFunction(new Live(_))
