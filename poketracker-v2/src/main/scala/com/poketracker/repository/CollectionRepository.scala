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
  def findByUser(userId: String, game: String): Task[List[CollectionEntry]]
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
  def findByUserWithCards(userId: String, game: String): Task[List[OwnedCard]]

object CollectionRepository:

  /** Every set a user owns any card from auto-files into one compartment
    * tagged `auto_set_id=<setId>`. The tag lives on the compartment, not
    * the box, so it keeps working after that compartment is merged into a
    * bigger box. If there isn't one yet, a box named after the real set
    * ("Scarlet & Violet", not a generic "Unsorted") is created lazily —
    * box_type=`auto_set:<setId>` still marks it as auto-created for the
    * UI. An untagged compartment in such a box (one created before
    * migration 013's backfill) is adopted and tagged rather than
    * duplicated. Picks the oldest match if more than one ever exists (e.g.
    * a rare concurrent-create race) so the system converges on one. */
  private[repository] def ensureSetDrawer(userId: String, cardId: String): ConnectionIO[Option[String]] =
    sql"SELECT c.set_id, cs.name FROM cards c LEFT JOIN card_sets cs ON cs.id=c.set_id WHERE c.id=$cardId"
      .query[(String, Option[String])].option.flatMap {
        case None => (None: Option[String]).pure[ConnectionIO]
        case Some((setId, setNameOpt)) =>
          val boxType = s"auto_set:$setId"
          val boxName = setNameOpt.getOrElse(setId)
          sql"""SELECT d.id FROM storage_drawers d JOIN storage_boxes b ON b.id=d.box_id
            WHERE b.user_id=$userId AND d.auto_set_id=$setId ORDER BY d.created_at LIMIT 1"""
            .query[String].option.flatMap {
              case Some(id) => Some(id).pure[ConnectionIO]
              case None =>
                sql"""SELECT d.id FROM storage_drawers d JOIN storage_boxes b ON b.id=d.box_id
                  WHERE b.user_id=$userId AND b.box_type=$boxType ORDER BY d.created_at LIMIT 1"""
                  .query[String].option.flatMap {
                    case Some(id) =>
                      sql"UPDATE storage_drawers SET auto_set_id=$setId WHERE id=$id".update.run.as(Some(id))
                    case None =>
                      val boxId = java.util.UUID.randomUUID().toString
                      val drawerId = java.util.UUID.randomUUID().toString
                      for
                        nextPos <- sql"SELECT COALESCE(MAX(position)+1,0) FROM storage_boxes WHERE user_id=$userId".query[Int].unique
                        _ <- sql"""INSERT INTO storage_boxes(id,user_id,name,kind,box_type,capacity,color,position,created_at,updated_at,game_id)
                          VALUES($boxId,$userId,$boxName,'box',$boxType,0,'#B99B67',$nextPos,NOW(),NOW(),
                            COALESCE((SELECT game_id FROM card_sets WHERE id=$setId),'pokemon'))""".update.run
                        _ <- sql"""INSERT INTO storage_drawers(id,box_id,name,position,auto_set_id,created_at,updated_at)
                          VALUES($drawerId,$boxId,'Main compartment',0,$setId,NOW(),NOW())""".update.run
                      yield Some(drawerId)
                  }
            }
      }

  /** Keeps this lot's share of its set's auto-box drawer equal to whatever
    * quantity isn't already placed somewhere else (a different drawer, a
    * binder slot, a display slot) — so adding copies auto-files the
    * surplus into "that card's set" box, and removing copies frees
    * auto-filed ones first rather than tripping inventory_lots' "can't
    * reduce below allocated" trigger on copies the user deliberately
    * moved elsewhere.
    *
    * @param shrinkOnly Never grows the allocation, only shrinks it toward
    *   the target — used in a pass BEFORE inventory_lots.quantity is
    *   updated, so a decrease never leaves more allocated than owned even
    *   for the instant between statements. The normal (non-shrink) pass
    *   after the quantity update then grows it if the total increased. */
  private[repository] def reconcileAutoAllocation(
    userId: String, cardId: String, key: ConditionKey,
    totalQty: Int, shrinkOnly: Boolean,
  ): ConnectionIO[Unit] =
    sql"""SELECT id FROM inventory_lots WHERE user_id=$userId AND card_id=$cardId
      AND variant_key=${key.variant} AND edition=${key.edition} AND language='en' AND condition=${key.condition}"""
      .query[String].option.flatMap {
        case None => ().pure[ConnectionIO]
        case Some(lotId) =>
          ensureSetDrawer(userId, cardId).flatMap {
            case None => ().pure[ConnectionIO] // card's set vanished from the catalog — nothing to file into
            case Some(autoDrawer) =>
              for
                elsewhere <- sql"""SELECT COALESCE(SUM(quantity),0) FROM card_allocations
                  WHERE lot_id=$lotId AND drawer_id IS DISTINCT FROM $autoDrawer""".query[Int].unique
                current   <- sql"SELECT id,quantity FROM card_allocations WHERE lot_id=$lotId AND drawer_id=$autoDrawer"
                  .query[(String,Int)].option
                target     = math.max(0, totalQty - elsewhere)
                desired    = if shrinkOnly then math.min(current.map(_._2).getOrElse(0), target) else target
                _ <- (current, desired) match
                  case (None, 0)               => ().pure[ConnectionIO]
                  case (None, d)                =>
                    val id = java.util.UUID.randomUUID().toString
                    sql"""INSERT INTO card_allocations(id,lot_id,drawer_id,quantity,created_at,updated_at)
                      VALUES($id,$lotId,$autoDrawer,$d,NOW(),NOW())""".update.run.void
                  case (Some((_, cur)), d) if cur == d => ().pure[ConnectionIO]
                  case (Some((id, _)), 0)      => sql"DELETE FROM card_allocations WHERE id=$id".update.run.void
                  case (Some((id, _)), d)      => sql"UPDATE card_allocations SET quantity=$d,updated_at=NOW() WHERE id=$id".update.run.void
              yield ()
          }
      }

  /** Removing owned copies also removes their physical placements. Binder
    * slots mirror their card separately, so clear that mirror before the
    * allocation disappears; drawer/display views read allocations directly. */
  private[repository] def clearLotPlacements(lotId: String): ConnectionIO[Unit] =
    sql"""UPDATE binder_slots bs SET card_id=NULL,card_name=NULL,image_url=NULL
      FROM card_allocations a WHERE a.lot_id=$lotId AND a.binder_slot_id=bs.id""".update.run.void *>
      sql"DELETE FROM card_allocations WHERE lot_id=$lotId".update.run.void

  /** Keeps the normalized allocation inventory aligned with the legacy
    * condition JSON: one lot per (print, edition, condition). A key with no
    * print suffix is the card's default print ("standard"); "NM · reverse"
    * is its own lot, so reverse copies are tracked and placed separately. */
  private[repository] def syncInventoryLots(entry: CollectionEntry): ConnectionIO[Unit] =
    val active = entry.conditions.filter(_.quantity > 0)
    for
      _ <- active.traverse_ { conditionCount =>
        val key = ConditionKey.parse(conditionCount.condition)
        reconcileAutoAllocation(entry.userId, entry.cardId, key, conditionCount.quantity, shrinkOnly = true) *>
        sql"""INSERT INTO inventory_lots
          (user_id,card_id,variant_key,edition,language,condition,quantity)
          VALUES (${entry.userId},${entry.cardId},${key.variant},${key.edition},'en',${key.condition},${conditionCount.quantity})
          ON CONFLICT (user_id,card_id,variant_key,edition,language,condition)
          DO UPDATE SET quantity=EXCLUDED.quantity,updated_at=NOW()""".update.run.void *>
        reconcileAutoAllocation(entry.userId, entry.cardId, key, conditionCount.quantity, shrinkOnly = false)
      }
      keepKeys = active.map(cc => ConditionKey.parse(cc.condition)).toSet
      existing <- sql"""SELECT id,variant_key,edition,condition FROM inventory_lots
        WHERE user_id=${entry.userId} AND card_id=${entry.cardId} AND language='en' AND quantity > 0
        FOR UPDATE"""
        .query[(String,String,String,String)].to[List]
      _ <- existing.filterNot { case (_,variant,edition,condition) => keepKeys(ConditionKey(condition, edition, variant)) }.traverse_ {
        case (id,_,_,_) =>
          clearLotPlacements(id) *>
          sql"UPDATE inventory_lots SET quantity=0,updated_at=NOW() WHERE id=$id".update.run.void
      }
    yield ()

  /** Shared by individual and bulk zero-quantity saves, in one transaction. */
  private[repository] def deleteEntryIO(userId: String, cardId: String): ConnectionIO[Unit] =
    for
      lots <- sql"SELECT id FROM inventory_lots WHERE user_id=$userId AND card_id=$cardId FOR UPDATE"
        .query[String].to[List]
      _ <- lots.traverse_(clearLotPlacements)
      // Older binders can contain a card without a linked allocation.
      _ <- sql"""UPDATE binder_slots bs SET card_id=NULL,card_name=NULL,image_url=NULL
        FROM binders b WHERE bs.binder_id=b.id AND b.user_id=$userId AND bs.card_id=$cardId""".update.run
      _ <- sql"DELETE FROM inventory_lots WHERE user_id=$userId AND card_id=$cardId".update.run
      _ <- sql"DELETE FROM collection_entries WHERE user_id=$userId AND card_id=$cardId".update.run
    yield ()

  private[repository] def findEntryIO(userId: String, cardId: String): ConnectionIO[Option[CollectionEntry]] =
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

  private[repository] def saveEntryIO(entry: CollectionEntry): ConnectionIO[Unit] =
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
    """.update.run.void *> syncInventoryLots(entry)

  /** Frees placements of one lot until no more than `keep` copies are placed, before its quantity drops to `keep`:
    * the copies auto-filed in the set's box go first, then other boxes, then the display case, and binder pockets
    * last (a binder pocket's mirror is cleared with it). */
  private def releasePlacements(userId: String, cardId: String, key: ConditionKey, keep: Int): ConnectionIO[Unit] =
    sql"""SELECT a.id, a.quantity, a.binder_slot_id FROM card_allocations a
      JOIN inventory_lots l ON l.id = a.lot_id
      LEFT JOIN storage_drawers d ON d.id = a.drawer_id
      WHERE l.user_id=$userId AND l.card_id=$cardId AND l.variant_key=${key.variant} AND l.edition=${key.edition}
        AND l.language='en' AND l.condition=${key.condition}
      ORDER BY CASE WHEN d.auto_set_id IS NOT NULL THEN 0 WHEN a.drawer_id IS NOT NULL THEN 1
                    WHEN a.binder_slot_id IS NULL THEN 2 ELSE 3 END, a.created_at DESC
      FOR UPDATE OF a"""
      .query[(String, Int, Option[String])].to[List].flatMap { placed =>
        placed.foldLeft((placed.map(_._2).sum - keep).pure[ConnectionIO]) { case (excessIO, (id, qty, binderSlot)) =>
          excessIO.flatMap { excess =>
            if excess <= 0 then excess.pure[ConnectionIO]
            else if qty > excess then
              sql"UPDATE card_allocations SET quantity=${qty - excess},updated_at=NOW() WHERE id=$id".update.run.as(0)
            else
              binderSlot.fold(().pure[ConnectionIO])(slot =>
                sql"UPDATE binder_slots SET card_id=NULL,card_name=NULL,image_url=NULL WHERE id=$slot".update.run.void) *>
              sql"DELETE FROM card_allocations WHERE id=$id".update.run.as(excess - qty)
          }
        }.void
      }

  /** Takes up to `qty` copies of a card in `condition` (the full key, e.g. "LP · reverse") out of a user's
    * collection, as a sale does, and returns how many came out: fewer when the user has fewer left. Part of the
    * caller's transaction (ShopRepository sells and puts back with it). */
  private[poketracker] def takeCopiesIO(userId: String, cardId: String, condition: String, qty: Int): ConnectionIO[Int] =
    val key = ConditionKey.parse(condition)
    findEntryIO(userId, cardId).flatMap { found =>
      found.flatMap(e => e.conditions.find(c => ConditionKey.parse(c.condition) == key).map(e -> _)) match
        case None => 0.pure[ConnectionIO]
        case Some((entry, held)) =>
          val take = math.max(0, math.min(qty, held.quantity))
          val left = held.quantity - take
          val conditions = entry.conditions.flatMap(c => if c ne held then List(c) else if left > 0 then List(c.copy(quantity = left)) else Nil)
          if take == 0 then 0.pure[ConnectionIO]
          else if !conditions.exists(_.quantity > 0) then deleteEntryIO(userId, cardId).as(take)
          else releasePlacements(userId, cardId, key, left) *> saveEntryIO(entry.copy(conditions = conditions)).as(take)
    }

  /** Puts `qty` copies of a card in `condition` back into a user's collection (a refund, a sale that fell through).
    * They file into the card's set box like any added copy. Part of the caller's transaction. */
  private[poketracker] def returnCopiesIO(userId: String, cardId: String, condition: String, qty: Int): ConnectionIO[Unit] =
    val key = ConditionKey.parse(condition)
    if qty <= 0 then ().pure[ConnectionIO]
    else findEntryIO(userId, cardId).flatMap { found =>
      val entry = found.getOrElse(CollectionEntry(java.util.UUID.randomUUID().toString, userId, cardId, Nil, key.condition, Instant.now()))
      val conditions = entry.conditions.find(c => ConditionKey.parse(c.condition) == key) match
        case Some(held) => entry.conditions.map(c => if c eq held then c.copy(quantity = c.quantity + qty) else c)
        case None       => entry.conditions :+ ConditionCount(condition, qty, None)
      saveEntryIO(entry.copy(conditions = conditions))
    }

  final class Live(xa: Transactor[Task]) extends CollectionRepository:

    def findByUser(userId: String, game: String): Task[List[CollectionEntry]] =
      (sql"""
        SELECT ce.id, ce.user_id, ce.card_id, ce.conditions, ce.selected_cond, ce.updated_at
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id AND c.game_id = $game
        WHERE ce.user_id = $userId
        ORDER BY ce.updated_at DESC
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
      findEntryIO(userId, cardId).transact(xa)

    def upsertEntry(entry: CollectionEntry): Task[Unit] =
      saveEntryIO(entry).transact(xa)

    def deleteEntry(userId: String, cardId: String): Task[Unit] =
      deleteEntryIO(userId, cardId).transact(xa)

    def bulkUpsert(entries: List[CollectionEntry]): Task[Unit] =
      entries.traverse_ { entry =>
        if !entry.conditions.exists(_.quantity > 0) then deleteEntryIO(entry.userId, entry.cardId)
        else
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

    def findByUserWithCards(userId: String, game: String): Task[List[OwnedCard]] =
      sql"""
        SELECT
          ce.card_id, ce.conditions, ce.selected_cond, ce.updated_at, ce.drawer_id,
          c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
          c.image_small, c.image_large,
          p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
        LEFT JOIN card_prices p ON p.card_id = ce.card_id
        WHERE ce.user_id = $userId AND c.game_id = $game
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
