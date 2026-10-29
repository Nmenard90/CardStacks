/**
 * Checks RoomRepository.cardLocations ("where is this card kept?", My Shop's requests) against an isolated Postgres
 * with schema.sql and migrations applied. Opt in with COLLECTION_IT_DB_URL; never point it at production.
 */
package com.poketracker

import cats.syntax.all.*
import com.poketracker.models.{CollectionEntry, ConditionCount}
import com.poketracker.repository.{CollectionRepository, RoomRepository}
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*
import java.time.Instant
import java.util.UUID

class CardLocationsDbSuite extends munit.FunSuite:
  private val url = sys.env.get("COLLECTION_IT_DB_URL")
  override def munitTests() = if url.isEmpty then Nil else super.munitTests()

  private lazy val xa = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get,
    user = "postgres", password = "", logHandler = None)
  private lazy val collection = CollectionRepository.Live(xa)
  private lazy val rooms = RoomRepository.Live(xa)
  private val owner = "locations-owner"
  private val other = "locations-other"
  private val setId = "locations-set"

  private def run[A](effect: Task[A]): A =
    Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(effect).getOrThrowFiberFailure() }
  private def db[A](query: ConnectionIO[A]): A = run(query.transact(xa))

  override def beforeAll(): Unit = if url.nonEmpty then
    require(url.get.startsWith("jdbc:postgresql://127.0.0.1:"), "Use an isolated local database")
    db((List(owner, other).traverse_(id =>
      sql"INSERT INTO users(id,username,supabase_user_id,email) VALUES($id,$id,$id,${id + "@example.test"})".update.run.void) *>
      sql"""INSERT INTO card_sets(id,name,series,printed_total,total,release_date,symbol_url,logo_url)
        VALUES($setId,'Locations test','Test',1,1,'2026-01-01','','')""".update.run).void)

  override def afterAll(): Unit = if url.nonEmpty then
    db((sql"DELETE FROM users WHERE id IN ($owner,$other)".update.run *>
      sql"DELETE FROM card_sets WHERE id=$setId".update.run).void)

  /** An owned card, auto-filed into a box the way the site files new cards. */
  private def ownedCard(userId: String = owner, qty: Int = 2): String =
    val cardId = UUID.randomUUID().toString
    db(sql"""INSERT INTO cards(id,set_id,name,number,image_small,image_large)
      VALUES($cardId,$setId,'Located card','7','','') ON CONFLICT DO NOTHING""".update.run)
    run(collection.upsertEntry(CollectionEntry(UUID.randomUUID().toString, userId, cardId, List(ConditionCount("NM", qty, None)), "NM", Instant.now())))
    cardId

  test("a filed card is found in its box and compartment, with condition and count") {
    val cardId = ownedCard()
    val (box, drawer) = db(sql"""SELECT b.name, d.name FROM card_allocations a JOIN inventory_lots l ON l.id=a.lot_id
      JOIN storage_drawers d ON d.id=a.drawer_id JOIN storage_boxes b ON b.id=d.box_id
      WHERE l.user_id=$owner AND l.card_id=$cardId""".query[(String, String)].unique)
    val found = run(rooms.cardLocations(owner, List(cardId)))
    assertEquals(found.map(l => (l.kind, l.container, l.part, l.condition, l.quantity)), List(("box", box, Some(drawer), Some("NM"), 2)))
  }

  test("a binder pocket is found with its slot and pocket size; another collector's copies are not") {
    val cardId = ownedCard()
    ownedCard(other) // a separate card for the other user, so their box can't leak in below
    val binder = UUID.randomUUID().toString
    val otherBinder = UUID.randomUUID().toString
    db((sql"INSERT INTO binders(id,user_id,name,pocket_size) VALUES($binder,$owner,'Trade Binder','Nine'),($otherBinder,$other,'Not mine','Nine')".update.run *>
      sql"""INSERT INTO binder_slots(binder_id,slot_index,card_id,card_name) VALUES
        ($binder,22,$cardId,'Located card'),($otherBinder,0,$cardId,'Located card')""".update.run).void)
    val pockets = run(rooms.cardLocations(owner, List(cardId))).filter(_.kind == "binder")
    assertEquals(pockets.map(l => (l.container, l.slotIndex, l.pocketSize, l.condition)), List(("Trade Binder", Some(22), Some("Nine"), None)))
    assert(!run(rooms.cardLocations(owner, List(cardId))).exists(_.container == "Not mine"))
  }

  test("no card ids → no query, no places") {
    assertEquals(run(rooms.cardLocations(owner, Nil)), Nil)
  }
