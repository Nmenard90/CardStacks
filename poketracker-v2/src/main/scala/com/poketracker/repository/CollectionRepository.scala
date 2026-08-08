/**
 * CollectionRepository — all database access for what users own. A
 * "collection entry" is one card a user owns, with a count per condition.
 *
 * USED BY: CollectionService
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

trait CollectionRepository:
  def findByUser(userId: String): Task[List[CollectionEntry]]
  def findEntry(userId: String, cardId: String): Task[Option[CollectionEntry]]
  def upsertEntry(entry: CollectionEntry): Task[Unit]
  def deleteEntry(userId: String, cardId: String): Task[Unit]

  /** All entries as one transaction — used for CSV imports; if any row fails, none are kept. */
  def bulkUpsert(entries: List[CollectionEntry]): Task[Unit]

  /**
   * Every owned card for a user, joined with the card's name/image/price so
   * the frontend gets it all in one request. A card since removed from the
   * catalog (no matching `cards` row) is silently dropped.
   */
  def findByUserWithCards(userId: String): Task[List[OwnedCard]]

object CollectionRepository:

  final class Live(xa: Transactor[Task]) extends CollectionRepository:

    /** Keeps the normalized allocation inventory aligned with the legacy
      * condition JSON. Legacy data has no owned variant, so it remains
      * "standard" until the user explicitly splits it in the room UI. */
    private def syncInventoryLots(entry: CollectionEntry): ConnectionIO[Unit] =
      val active = entry.conditions.filter(_.quantity > 0)
      for
        _ <- active.traverse_ { conditionCount =>
          val firstEdition = conditionCount.condition.endsWith(" 1st Ed")
          val edition = if firstEdition then "first_edition" else "unlimited"
          val condition = conditionCount.condition.stripSuffix(" 1st Ed")
          sql"""INSERT INTO inventory_lots
            (user_id,card_id,variant_key,edition,language,condition,quantity)
            VALUES (${entry.userId},${entry.cardId},'standard',$edition,'en',$condition,${conditionCount.quantity})
            ON CONFLICT (user_id,card_id,variant_key,edition,language,condition)
            DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=NOW()""".update.run.void
        }
        keepKeys = active.map { cc =>
          val edition = if cc.condition.endsWith(" 1st Ed") then "first_edition" else "unlimited"
          (edition, cc.condition.stripSuffix(" 1st Ed"))
        }.toSet
        existing <- sql"""SELECT id,edition,condition FROM inventory_lots
          WHERE user_id=${entry.userId} AND card_id=${entry.cardId} AND variant_key='standard' AND language='en'"""
          .query[(String,String,String)].to[List]
        _ <- existing.filterNot { case (_,edition,condition) => keepKeys((edition,condition)) }.traverse_ {
          case (id,_,_) => sql"UPDATE inventory_lots SET quantity=0,updated_at=NOW() WHERE id=$id".update.run.void
        }
      yield ()

    def findByUser(userId: String): Task[List[CollectionEntry]] =
      (sql"""
        SELECT id, user_id, card_id, conditions, selected_cond, updated_at
        FROM collection_entries
        WHERE user_id = $userId
        ORDER BY updated_at DESC
      """
        .query[(String, String, String, String, String, Instant)]
        .to[List]
        .map(_.flatMap { case (id, uid, cardId, condJson, selCond, updatedAt) =>
          // `conditions` is stored as jsonb text; a row that fails to parse is dropped.
          condJson.fromJson[List[ConditionCount]].toOption.map { conditions =>
            CollectionEntry(id, uid, cardId, conditions, selCond, updatedAt)
          }
        })
        .transact(xa))

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
      val condJson = entry.conditions.toJson

      (sql"""
        INSERT INTO collection_entries
          (id, user_id, card_id, conditions, selected_cond, updated_at)
        VALUES
          (${entry.id}, ${entry.userId}, ${entry.cardId},
           $condJson::jsonb, ${entry.selectedCond}, NOW())
        ON CONFLICT (user_id, card_id) DO UPDATE SET
          conditions    = EXCLUDED.conditions,
          selected_cond = EXCLUDED.selected_cond,
          updated_at    = NOW()
      """.update.run.void *> syncInventoryLots(entry)).transact(xa)

    def deleteEntry(userId: String, cardId: String): Task[Unit] =
      (for
        allocated <- sql"""SELECT COALESCE(SUM(a.quantity),0) FROM card_allocations a
          JOIN inventory_lots l ON l.id=a.lot_id WHERE l.user_id=$userId AND l.card_id=$cardId"""
          .query[Int].unique
        _ <- if allocated == 0 then ().pure[ConnectionIO]
             else FC.raiseError(RuntimeException(s"Move or remove $allocated allocated copies before deleting this card"))
        _ <- sql"DELETE FROM inventory_lots WHERE user_id=$userId AND card_id=$cardId".update.run
        _ <- sql"DELETE FROM collection_entries WHERE user_id=$userId AND card_id=$cardId".update.run
      yield ()).transact(xa)

    def bulkUpsert(entries: List[CollectionEntry]): Task[Unit] =
      entries.traverse_ { entry =>
        val condJson = entry.conditions.toJson
        (sql"""
          INSERT INTO collection_entries
            (id, user_id, card_id, conditions, selected_cond, updated_at)
          VALUES
            (${entry.id}, ${entry.userId}, ${entry.cardId},
             $condJson::jsonb, ${entry.selectedCond}, NOW())
          ON CONFLICT (user_id, card_id) DO UPDATE SET
            conditions    = EXCLUDED.conditions,
            selected_cond = EXCLUDED.selected_cond,
            updated_at    = NOW()
        """.update.run.void *> syncInventoryLots(entry))
      }.transact(xa)

    def findByUserWithCards(userId: String): Task[List[OwnedCard]] =
      sql"""
        SELECT
          ce.card_id, ce.conditions, ce.selected_cond, ce.updated_at, ce.drawer_id,
          c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
          c.image_small, c.image_large,
          p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
        LEFT JOIN card_prices p ON p.card_id = ce.card_id
        WHERE ce.user_id = $userId
        ORDER BY ce.updated_at DESC
      """
        .query[(String, String, String, Instant, Option[String],
                String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])]
        .to[List]
        .map(_.flatMap {
          case (cardId, condJson, selCond, updatedAt, drawerId,
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
                                    CardImage(imgSmall, imgLarge), prices, None),
                drawerId     = drawerId
              )
            }
        })
        .transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, CollectionRepository] =
    ZLayer.fromFunction(new Live(_))
