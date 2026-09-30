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

    /** Every user gets one lazily-created "Unsorted" holding box (box_type=
      * `unsorted`, a free-text sentinel on an existing column, so this needs
      * no migration) that newly-owned surplus auto-files into. This used to
      * be one box per set (`auto_set:<setId>`), but that scattered a user's
      * cards across as many boxes as they owned sets from, fighting anyone
      * who deliberately keeps several sets together in one physical box —
      * a single consolidated holding box means a card always turns up in
      * exactly one predictable place, and the existing box multi-select
      * "move" tool is then the one consolidation step needed to file
      * everything into whatever boxes the user actually organizes by hand.
      * Picks the oldest such box if more than one ever exists (e.g. a rare
      * concurrent-create race) so the system converges on one over time. */
    private def ensureUnsortedDrawer(userId: String): ConnectionIO[String] =
      sql"""SELECT d.id FROM storage_drawers d JOIN storage_boxes b ON b.id=d.box_id
        WHERE b.user_id=$userId AND b.box_type='unsorted' ORDER BY d.created_at LIMIT 1"""
        .query[String].option.flatMap {
          case Some(id) => id.pure[ConnectionIO]
          case None =>
            val boxId = java.util.UUID.randomUUID().toString
            val drawerId = java.util.UUID.randomUUID().toString
            for
              nextPos <- sql"SELECT COALESCE(MAX(position)+1,0) FROM storage_boxes WHERE user_id=$userId".query[Int].unique
              _ <- sql"""INSERT INTO storage_boxes(id,user_id,name,kind,box_type,capacity,color,position,created_at,updated_at)
                VALUES($boxId,$userId,'Unsorted','box','unsorted',0,'#B99B67',$nextPos,NOW(),NOW())""".update.run
              _ <- sql"""INSERT INTO storage_drawers(id,box_id,name,position,created_at,updated_at)
                VALUES($drawerId,$boxId,'Main compartment',0,NOW(),NOW())""".update.run
            yield drawerId
        }

    /** Keeps this lot's share of the Unsorted drawer equal to whatever
      * quantity isn't already placed somewhere else (a different drawer, a
      * binder slot, a display slot) — so adding copies auto-files the
      * surplus into Unsorted, and removing copies frees auto-filed ones
      * first rather than tripping inventory_lots' "can't reduce below
      * allocated" trigger on copies the user deliberately moved elsewhere.
      *
      * @param shrinkOnly Never grows the allocation, only shrinks it toward
      *   the target — used in a pass BEFORE inventory_lots.quantity is
      *   updated, so a decrease never leaves more allocated than owned even
      *   for the instant between statements. The normal (non-shrink) pass
      *   after the quantity update then grows it if the total increased. */
    private def reconcileAutoAllocation(
      userId: String, cardId: String, edition: String, condition: String,
      totalQty: Int, shrinkOnly: Boolean,
    ): ConnectionIO[Unit] =
      sql"""SELECT id FROM inventory_lots WHERE user_id=$userId AND card_id=$cardId
        AND variant_key='standard' AND edition=$edition AND language='en' AND condition=$condition"""
        .query[String].option.flatMap {
          case None => ().pure[ConnectionIO]
          case Some(lotId) =>
            ensureUnsortedDrawer(userId).flatMap { autoDrawer =>
              for
                elsewhere <- sql"""SELECT COALESCE(SUM(quantity),0) FROM card_allocations
                  WHERE lot_id=$lotId AND drawer_id IS DISTINCT FROM $autoDrawer""".query[Int].unique
                // ORDER BY + LIMIT 1: a pre-existing duplicate for this lot+drawer
                // (e.g. from before the protection-mismatch fix) shouldn't make
                // this throw on >1 row instead of saving. Picks the oldest
                // deterministically; a leftover second row just stops being
                // touched by this reconcile pass instead of blocking it.
                current   <- sql"""SELECT id,quantity FROM card_allocations WHERE lot_id=$lotId AND drawer_id=$autoDrawer
                  ORDER BY created_at LIMIT 1""".query[(String,Int)].option
                target     = math.max(0, totalQty - elsewhere)
                desired    = if shrinkOnly then math.min(current.map(_._2).getOrElse(0), target) else target
                _ <- (current, desired) match
                  case (None, 0)               => ().pure[ConnectionIO]
                  case (None, d)                =>
                    val id = java.util.UUID.randomUUID().toString
                    // protection='raw' matches what placeCopies' merge-lookup
                    // treats as the default — leaving this NULL would make an
                    // auto-filed stack invisible to that dedup check, so a later
                    // explicit placement (protection='raw') for the same
                    // card+drawer would create a second, un-merged row instead
                    // of topping this one up.
                    sql"""INSERT INTO card_allocations(id,lot_id,drawer_id,quantity,protection,created_at,updated_at)
                      VALUES($id,$lotId,$autoDrawer,$d,'raw',NOW(),NOW())""".update.run.void
                  case (Some((_, cur)), d) if cur == d => ().pure[ConnectionIO]
                  case (Some((id, _)), 0)      => sql"DELETE FROM card_allocations WHERE id=$id".update.run.void
                  case (Some((id, _)), d)      => sql"UPDATE card_allocations SET quantity=$d,updated_at=NOW() WHERE id=$id".update.run.void
              yield ()
            }
        }

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
          reconcileAutoAllocation(entry.userId, entry.cardId, edition, condition, conditionCount.quantity, shrinkOnly = true) *>
          sql"""INSERT INTO inventory_lots
            (user_id,card_id,variant_key,edition,language,condition,quantity)
            VALUES (${entry.userId},${entry.cardId},'standard',$edition,'en',$condition,${conditionCount.quantity})
            ON CONFLICT (user_id,card_id,variant_key,edition,language,condition)
            DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=NOW()""".update.run.void *>
          reconcileAutoAllocation(entry.userId, entry.cardId, edition, condition, conditionCount.quantity, shrinkOnly = false)
        }
        keepKeys = active.map { cc =>
          val edition = if cc.condition.endsWith(" 1st Ed") then "first_edition" else "unlimited"
          (edition, cc.condition.stripSuffix(" 1st Ed"))
        }.toSet
        existing <- sql"""SELECT id,edition,condition FROM inventory_lots
          WHERE user_id=${entry.userId} AND card_id=${entry.cardId} AND variant_key='standard' AND language='en'"""
          .query[(String,String,String)].to[List]
        _ <- existing.filterNot { case (_,edition,condition) => keepKeys((edition,condition)) }.traverse_ {
          case (id,edition,condition) =>
            reconcileAutoAllocation(entry.userId, entry.cardId, edition, condition, 0, shrinkOnly = true) *>
            sql"UPDATE inventory_lots SET quantity=0,updated_at=NOW() WHERE id=$id".update.run.void
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
