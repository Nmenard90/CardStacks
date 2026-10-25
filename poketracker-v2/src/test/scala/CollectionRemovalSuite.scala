/**
 * Regression checks for Explore's zero-quantity saves against an isolated
 * Postgres with schema.sql and migrations applied. Opt in with
 * COLLECTION_IT_DB_URL; never point this fixture-writing suite at production.
 * Tests use CollectionService and the owned-card feed also used by the shop.
 */
package com.poketracker

import cats.syntax.all.*
import com.poketracker.models.{CollectionEntry, ConditionCount}
import com.poketracker.repository.{CardRepository, CollectionRepository}
import com.poketracker.service.CollectionService
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*
import java.time.Instant
import java.util.UUID

class CollectionRemovalSuite extends munit.FunSuite:
  private val url = sys.env.get("COLLECTION_IT_DB_URL")
  override def munitTests() = if url.isEmpty then Nil else super.munitTests()

  private lazy val xa = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get,
    user = "postgres", password = "", logHandler = None)
  private lazy val repo = CollectionRepository.Live(xa)
  private lazy val svc = CollectionService.Live(repo, CardRepository.Live(xa))
  private val owner = "zero-qty-owner"
  private val other = "zero-qty-other"
  private val setId = "zero-qty-set"

  private def run[A](effect: Task[A]): A =
    Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(effect).getOrThrowFiberFailure() }
  private def db[A](query: ConnectionIO[A]): A = run(query.transact(xa))
  private def count(condition: String, quantity: Int = 1) = ConditionCount(condition, quantity, None)
  private def entry(cardId: String, conditions: List[ConditionCount], userId: String = owner) =
    CollectionEntry(UUID.randomUUID().toString, userId, cardId, conditions, "NM", Instant.now())

  override def beforeAll(): Unit = if url.nonEmpty then
    require(url.get.startsWith("jdbc:postgresql://127.0.0.1:"), "Use an isolated local database")
    db((List(owner, other).traverse_(id =>
      sql"INSERT INTO users(id,username,supabase_user_id,email) VALUES($id,$id,$id,${id + "@example.test"})".update.run.void) *>
      sql"""INSERT INTO card_sets(id,name,series,printed_total,total,release_date,symbol_url,logo_url)
        VALUES($setId,'Removal test','Test',1,1,'2026-01-01','','')""".update.run).void)

  override def afterAll(): Unit = if url.nonEmpty then
    db((sql"DELETE FROM users WHERE id IN ($owner,$other)".update.run *>
      sql"DELETE FROM card_sets WHERE id=$setId".update.run).void)

  /** Creates a real auto-filed owned card, including its inventory lot. */
  private def fixture(conditions: List[ConditionCount] = List(count("NM"))): String =
    val cardId = UUID.randomUUID().toString
    db(sql"""INSERT INTO cards(id,set_id,name,number,image_small,image_large)
      VALUES($cardId,$setId,'Test card','1','','')""".update.run)
    run(repo.upsertEntry(entry(cardId, conditions)))
    cardId

  /** A zero save must disappear from both saved ownership and the shop feed. */
  private def assertRemoved(cardId: String): Unit =
    assertEquals(run(repo.findEntry(owner, cardId)), None)
    assert(!run(svc.getOwnedCards(owner, "pokemon")).exists(_.card.id == cardId))
    assertEquals(db(sql"SELECT COUNT(*) FROM inventory_lots WHERE user_id=$owner AND card_id=$cardId".query[Long].unique), 0L)
    assertEquals(db(sql"SELECT COUNT(*) FROM cards WHERE id=$cardId".query[Long].unique), 1L)

  test("1 to 0 removes an auto-filed card from ownership, storage and shop; retry is harmless") {
    val cardId = fixture()
    val allocation = db(sql"""SELECT a.id FROM card_allocations a JOIN inventory_lots l ON l.id=a.lot_id
      WHERE l.user_id=$owner AND l.card_id=$cardId""".query[String].unique)
    assertEquals(run(svc.updateEntry(owner, cardId, Nil, "NM")), None)
    assertRemoved(cardId)
    assertEquals(db(sql"SELECT COUNT(*) FROM card_allocations WHERE id=$allocation".query[Long].unique), 0L)
    run(svc.updateEntry(owner, cardId, List(count("NM", 0)), "NM"))
    assertRemoved(cardId)
  }

  test("zero clears binder placements and legacy mirrors without removing another user's copy") {
    val cardId = fixture()
    run(repo.upsertEntry(entry(cardId, List(count("NM")), other)))
    val binder = UUID.randomUUID().toString
    val slot = UUID.randomUUID().toString
    val legacySlot = UUID.randomUUID().toString
    val lot = db(sql"SELECT id FROM inventory_lots WHERE user_id=$owner AND card_id=$cardId".query[String].unique)
    db((sql"DELETE FROM card_allocations WHERE lot_id=$lot".update.run *>
      sql"INSERT INTO binders(id,user_id,name) VALUES($binder,$owner,'Test binder')".update.run *>
      sql"""INSERT INTO binder_slots(id,binder_id,slot_index,card_id,card_name,image_url) VALUES
        ($slot,$binder,0,$cardId,'Test card','image'),($legacySlot,$binder,1,$cardId,'Test card','image')""".update.run *>
      sql"INSERT INTO card_allocations(lot_id,binder_slot_id,quantity) VALUES($lot,$slot,1)".update.run).void)
    run(svc.updateEntry(owner, cardId, Nil, "NM"))
    assertRemoved(cardId)
    assertEquals(db(sql"""SELECT COUNT(*) FROM binder_slots WHERE binder_id=$binder
      AND (card_id IS NOT NULL OR card_name IS NOT NULL OR image_url IS NOT NULL)""".query[Long].unique), 0L)
    assertEquals(run(repo.findEntry(other, cardId)).map(_.totalQuantity), Some(1))
    assert(run(svc.getOwnedCards(other, "pokemon")).exists(_.card.id == cardId))
  }

  test("zero removes a display allocation but keeps the empty display slot") {
    val cardId = fixture()
    val lot = db(sql"SELECT id FROM inventory_lots WHERE user_id=$owner AND card_id=$cardId".query[String].unique)
    val space = UUID.randomUUID().toString
    val display = UUID.randomUUID().toString
    val slot = UUID.randomUUID().toString
    db((sql"DELETE FROM card_allocations WHERE lot_id=$lot".update.run *>
      sql"INSERT INTO collection_spaces(id,user_id,name) VALUES($space,$owner,'Test room')".update.run *>
      sql"INSERT INTO display_cases(id,space_id,name) VALUES($display,$space,'Test display')".update.run *>
      sql"INSERT INTO display_slots(id,display_case_id,shelf_index,slot_index) VALUES($slot,$display,0,0)".update.run *>
      sql"INSERT INTO card_allocations(lot_id,display_slot_id,quantity) VALUES($lot,$slot,1)".update.run).void)
    run(svc.updateEntry(owner, cardId, Nil, "NM"))
    assertRemoved(cardId)
    assertEquals(db(sql"SELECT COUNT(*) FROM card_allocations WHERE display_slot_id=$slot".query[Long].unique), 0L)
    assertEquals(db(sql"SELECT COUNT(*) FROM display_slots WHERE id=$slot".query[Long].unique), 1L)
  }

  test("zeroing one print clears its manual placement and preserves the other print") {
    val cardId = fixture(List(count("NM"), count("LP · reverse", 2)))
    val lot = db(sql"""SELECT id FROM inventory_lots
      WHERE user_id=$owner AND card_id=$cardId AND variant_key='standard'""".query[String].unique)
    // Moving the stack to a manually named box used to make zeroing fail too.
    db(sql"""UPDATE storage_boxes SET box_type='manual' WHERE id IN (
      SELECT d.box_id FROM storage_drawers d JOIN card_allocations a ON a.drawer_id=d.id WHERE a.lot_id=$lot)""".update.run)
    run(svc.updateEntry(owner, cardId, List(count("LP · reverse", 2)), "LP"))
    assertEquals(db(sql"SELECT quantity FROM inventory_lots WHERE id=$lot".query[Int].unique), 0)
    assertEquals(db(sql"SELECT COUNT(*) FROM card_allocations WHERE lot_id=$lot".query[Long].unique), 0L)
    val owned = run(svc.getOwnedCards(owner, "pokemon")).find(_.card.id == cardId).get
    assertEquals(owned.conditions.map(c => (c.condition, c.quantity)), List(("LP · reverse", 2)))
  }

  test("bulk clear uses the same zero-removal behavior and leaves unrelated cards alone") {
    val removed = fixture()
    val kept = fixture()
    run(svc.bulkUpdate(owner, List((removed, Nil, "NM"))))
    assertRemoved(removed)
    assertEquals(run(repo.findEntry(owner, kept)).map(_.totalQuantity), Some(1))
  }
