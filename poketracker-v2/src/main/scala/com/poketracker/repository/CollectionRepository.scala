/**
 * FILE: CollectionRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/CollectionRepository.scala
 *
 * PURPOSE:
 *   Handles all database operations for user card collections.
 *   A collection is the set of cards a user owns, with per-condition quantities.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   cats.syntax.all.*
 *     Provides .void (discard return value) and other Cats syntax extensions.
 *
 *   io.circe / zio.json
 *     We use zio.json for API responses but store conditions as JSONB in Postgres.
 *     We use the raw string approach — store as JSON text, parse on read.
 *
 *   doobie.postgres.circe.jsonb.implicits.*  (NOT used here — we use manual JSON)
 *     We handle JSONB as raw strings to avoid adding circe as a dependency.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: CollectionService
 * DEPENDS ON: Doobie, ZIO, Collection model
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

/**
 * TRAIT: CollectionRepository
 * PURPOSE: Interface for all collection data access operations.
 */
trait CollectionRepository:

  /**
   * METHOD: findByUser
   * PURPOSE: Fetches all collection entries for a user.
   *          Returns the user's entire collection in one query.
   * @param userId  The user whose collection to fetch
   * @return        List of all cards the user owns with quantities
   */
  def findByUser(userId: String): Task[List[CollectionEntry]]

  /**
   * METHOD: findEntry
   * PURPOSE: Fetches a single collection entry for a specific card.
   * @param userId  The user
   * @param cardId  The card
   * @return        Some(entry) if the user owns this card, None if not
   */
  def findEntry(userId: String, cardId: String): Task[Option[CollectionEntry]]

  /**
   * METHOD: upsertEntry
   * PURPOSE: Saves a collection entry — inserts if new, updates if existing.
   * @param entry  The collection entry to save
   * @return       Unit
   */
  def upsertEntry(entry: CollectionEntry): Task[Unit]

  /**
   * METHOD: deleteEntry
   * PURPOSE: Removes a card from a user's collection entirely.
   *          Called when a user sets all quantities to zero.
   * @param userId  The user
   * @param cardId  The card to remove
   * @return        Unit
   */
  def deleteEntry(userId: String, cardId: String): Task[Unit]

  /**
   * METHOD: bulkUpsert
   * PURPOSE: Saves multiple collection entries in a single database transaction.
   *          Much faster than calling upsertEntry repeatedly for each card.
   *          Used when importing a collection from CSV.
   * @param entries  The entries to save
   * @return         Unit
   */
  def bulkUpsert(entries: List[CollectionEntry]): Task[Unit]

  /**
   * METHOD: findByUserWithCards
   * PURPOSE: Fetches every collection entry for a user joined with full card
   *          details from the cards and card_prices tables.
   *          Used by GET /api/collection/:userId/owned to avoid N+1 per-card
   *          lookups on the frontend.  Entries whose card no longer exists in
   *          the cards table are silently excluded (INNER JOIN).
   * @param userId  The user whose collection to fetch
   * @return        All owned cards with enriched card data, newest first
   */
  def findByUserWithCards(userId: String): Task[List[OwnedCard]]

object CollectionRepository:

  final class Live(xa: Transactor[Task]) extends CollectionRepository:

    def findByUser(userId: String): Task[List[CollectionEntry]] =
      sql"""
        SELECT id, user_id, card_id, conditions, selected_cond, updated_at
        FROM collection_entries
        WHERE user_id = $userId
        ORDER BY updated_at DESC
      """
        .query[(String, String, String, String, String, Instant)]
        .to[List]
        .map(_.flatMap { case (id, uid, cardId, condJson, selCond, updatedAt) =>
          // Parse the JSONB conditions column from JSON string.
          // If parsing fails (corrupted data), skip the row rather than crashing.
          condJson.fromJson[List[ConditionCount]].toOption.map { conditions =>
            CollectionEntry(id, uid, cardId, conditions, selCond, updatedAt)
          }
        })
        .transact(xa)

    def findEntry(userId: String, cardId: String): Task[Option[CollectionEntry]] =
      sql"""
        SELECT id, user_id, card_id, conditions, selected_cond, updated_at
        FROM collection_entries
        WHERE user_id = $userId AND card_id = $cardId
      """
        .query[(String, String, String, String, String, Instant)]
        .option
        .map(_.flatMap { case (id, uid, cid, condJson, selCond, updatedAt) =>
          condJson.fromJson[List[ConditionCount]].toOption.map { conditions =>
            CollectionEntry(id, uid, cid, conditions, selCond, updatedAt)
          }
        })
        .transact(xa)

    def upsertEntry(entry: CollectionEntry): Task[Unit] =
      // Serialize the conditions list to JSON for storage in the JSONB column.
      val condJson = entry.conditions.toJson
      sql"""
        INSERT INTO collection_entries
          (id, user_id, card_id, conditions, selected_cond, updated_at)
        VALUES
          (${entry.id}, ${entry.userId}, ${entry.cardId},
           $condJson::jsonb, ${entry.selectedCond}, NOW())
        ON CONFLICT (user_id, card_id) DO UPDATE SET
          conditions    = EXCLUDED.conditions,
          selected_cond = EXCLUDED.selected_cond,
          updated_at    = NOW()
      """
        .update.run.void.transact(xa)

    def deleteEntry(userId: String, cardId: String): Task[Unit] =
      sql"""
        DELETE FROM collection_entries
        WHERE user_id = $userId AND card_id = $cardId
      """
        .update.run.void.transact(xa)

    def bulkUpsert(entries: List[CollectionEntry]): Task[Unit] =
      // Run all upserts in a single transaction.
      // If any one fails, the entire batch is rolled back — no partial saves.
      // .traverse_ runs an effect for each item and discards the results.
      entries.traverse_ { entry =>
        val condJson = entry.conditions.toJson
        sql"""
          INSERT INTO collection_entries
            (id, user_id, card_id, conditions, selected_cond, updated_at)
          VALUES
            (${entry.id}, ${entry.userId}, ${entry.cardId},
             $condJson::jsonb, ${entry.selectedCond}, NOW())
          ON CONFLICT (user_id, card_id) DO UPDATE SET
            conditions    = EXCLUDED.conditions,
            selected_cond = EXCLUDED.selected_cond,
            updated_at    = NOW()
        """
          .update.run.void
      }.transact(xa)

    def findByUserWithCards(userId: String): Task[List[OwnedCard]] =
      sql"""
        SELECT
          ce.card_id, ce.conditions, ce.selected_cond, ce.updated_at,
          c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
          c.image_small, c.image_large,
          p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
        LEFT JOIN card_prices p ON p.card_id = ce.card_id AND p.variant = 'Normal'
        WHERE ce.user_id = $userId
        ORDER BY ce.updated_at DESC
      """
        .query[(String, String, String, Instant,
                String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])]
        .to[List]
        .map(_.flatMap {
          case (cardId, condJson, selCond, updatedAt,
                cId, setId, name, number, rarity, artist,
                imgSmall, imgLarge,
                nm, lp, mp, hp, dmg) =>
            condJson.fromJson[List[ConditionCount]].toOption.map { conditions =>
              val prices = if nm.orElse(lp).orElse(mp).orElse(hp).orElse(dmg).isDefined
                           then Some(CardPrices(nm, lp, mp, hp, dmg))
                           else None
              OwnedCard(
                cardId       = cardId,
                conditions   = conditions,
                selectedCond = selCond,
                updatedAt    = updatedAt,
                card         = Card(cId, setId, name, number, rarity, artist,
                                    CardImage(imgSmall, imgLarge), prices)
              )
            }
        })
        .transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, CollectionRepository] =
    ZLayer.fromFunction(new Live(_))
