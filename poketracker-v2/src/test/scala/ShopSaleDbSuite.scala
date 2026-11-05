/**
 * Completing a shop sale against an isolated Postgres with schema.sql and migrations applied: only the found copies
 * leave the collection, never twice, from the right places, and put back restores them. Opt in with
 * SHOP_SALE_IT_DB_URL; never point this fixture-writing suite at production.
 */
package com.poketracker

import cats.syntax.all.*
import com.poketracker.api.ShopRoutes
import com.poketracker.models.*
import com.poketracker.repository.{CollectionRepository, ShopRepository}
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*
import java.time.Instant
import java.util.UUID

class ShopSaleDbSuite extends munit.FunSuite:
  private val url = sys.env.get("SHOP_SALE_IT_DB_URL")
  override def munitTests() = if url.isEmpty then Nil else super.munitTests()

  private lazy val xa = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get, user = "postgres", password = "", logHandler = None)
  private lazy val shop = ShopRepository.Live(xa)
  private lazy val collection = CollectionRepository.Live(xa)
  private val seller = "sale-test-seller"
  private val other  = "sale-test-other"
  private val setId  = "sale-test-set"

  private def run[A](effect: Task[A]): A = Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(effect).getOrThrowFiberFailure() }
  private def db[A](query: ConnectionIO[A]): A = run(query.transact(xa))
  private def count(condition: String, quantity: Int) = ConditionCount(condition, quantity, None)

  override def beforeAll(): Unit = if url.nonEmpty then
    require(url.get.startsWith("jdbc:postgresql://127.0.0.1:"), "Use an isolated local database")
    db((List(seller, other).traverse_(id =>
      sql"INSERT INTO users(id,username,supabase_user_id,email) VALUES($id,$id,$id,${id + "@example.test"})".update.run.void) *>
      sql"""INSERT INTO card_sets(id,name,series,printed_total,total,release_date,symbol_url,logo_url)
        VALUES($setId,'Sale test','Test',1,1,'2026-01-01','','')""".update.run).void)

  override def afterAll(): Unit = if url.nonEmpty then
    db((sql"DELETE FROM shop_requests WHERE seller_user_id IN ($seller,$other)".update.run *>
      sql"DELETE FROM users WHERE id IN ($seller,$other)".update.run *>
      sql"DELETE FROM cards WHERE set_id=$setId".update.run *>
      sql"DELETE FROM card_sets WHERE id=$setId".update.run).void)

  /** A card the seller owns, auto-filed into its set box like any added card. */
  private def owned(conditions: ConditionCount*): String =
    val cardId = UUID.randomUUID().toString
    db(sql"INSERT INTO cards(id,set_id,name,number,image_small,image_large) VALUES($cardId,$setId,'Sale card','1','','')".update.run)
    run(collection.upsertEntry(CollectionEntry(UUID.randomUUID().toString, seller, cardId, conditions.toList, "NM", Instant.now())))
    cardId

  private def held(cardId: String): List[(String, Int)] =
    run(collection.findEntry(seller, cardId)).toList.flatMap(_.conditions.map(c => (c.condition, c.quantity)))

  private def request(items: ShopRequestItem*): ShopRequest =
    run(shop.create(seller, ShopRequestInput("Buyer", "buyer@example.test", "", items.toList), None))

  private def mark(req: ShopRequest, index: Int, change: ShopRequestItemChange) =
    run(shop.updateItem(seller, req.id, index, ShopRoutes.applyItemChange(_, change))).get.toOption.get

  private def item(cardId: String, condition: String, qty: Int) = ShopRequestItem(cardId, "Sale card", "1", condition, qty)

  test("a sale takes only the found cards, says which came up short, and never takes twice") {
    val found   = owned(count("NM", 3))
    val missing = owned(count("NM", 1))
    val partly  = owned(count("LP", 5))
    val gone    = owned(count("NM", 1))
    val req = request(item(found, "NM", 2), item(missing, "NM", 1), item(partly, "LP", 3), item(gone, "NM", 2))
    mark(req, 0, ShopRequestItemChange(pulled = Some(true)))
    mark(req, 2, ShopRequestItemChange(foundQty = Some(2)))
    mark(req, 3, ShopRequestItemChange(pulled = Some(true)))

    val sale = run(shop.sell(seller, req.id)).get
    assertEquals(sale.taken, 2 + 2 + 1)
    assertEquals(sale.short.map(s => (s.wanted, s.taken)), List((2, 1)))
    assertEquals(sale.request.status, "done")
    assertEquals(sale.request.items.map(_.soldQty), List(2, 0, 2, 1))
    assertEquals(held(found), List(("NM", 1)))
    assertEquals(held(missing), List(("NM", 1)))
    assertEquals(held(partly), List(("LP", 3)))
    assertEquals(held(gone), Nil)

    // Pressing it again (or a retry) takes nothing more.
    assertEquals(run(shop.sell(seller, req.id)).get.taken, 0)
    assertEquals(held(found), List(("NM", 1)))
    // Someone else can't complete this seller's sale.
    assertEquals(run(shop.sell(other, req.id)), None)
  }

  test("a card re-graded on the pull list comes out of the copy the collection still lists the old way") {
    val cardId = owned(count("NM", 1), count("MP", 1))
    val req = request(item(cardId, "NM", 1))
    mark(req, 0, ShopRequestItemChange(condition = Some("LP"), pulled = Some(true)))
    assertEquals(run(shop.sell(seller, req.id)).get.taken, 1)
    assertEquals(held(cardId), List(("MP", 1)))
  }

  test("the auto-filed copy goes first, so a card kept in a binder pocket stays there") {
    val cardId = owned(count("NM", 2))
    val lot = db(sql"SELECT id FROM inventory_lots WHERE user_id=$seller AND card_id=$cardId".query[String].unique)
    val binder = UUID.randomUUID().toString
    val slot = UUID.randomUUID().toString
    db((sql"UPDATE card_allocations SET quantity=1 WHERE lot_id=$lot".update.run *>
      sql"INSERT INTO binders(id,user_id,name) VALUES($binder,$seller,'Sale binder')".update.run *>
      sql"INSERT INTO binder_slots(id,binder_id,slot_index,card_id,card_name,image_url) VALUES($slot,$binder,0,$cardId,'Sale card','img')".update.run *>
      sql"INSERT INTO card_allocations(lot_id,binder_slot_id,quantity) VALUES($lot,$slot,1)".update.run).void)
    val req = request(item(cardId, "NM", 1))
    mark(req, 0, ShopRequestItemChange(pulled = Some(true)))
    run(shop.sell(seller, req.id))
    assertEquals(held(cardId), List(("NM", 1)))
    assertEquals(db(sql"SELECT card_id FROM binder_slots WHERE id=$slot".query[Option[String]].unique), Some(cardId))
    assertEquals(db(sql"SELECT COALESCE(SUM(quantity),0) FROM card_allocations WHERE lot_id=$lot".query[Long].unique), 1L)

    // Selling the last copy empties the pocket too.
    val again = request(item(cardId, "NM", 1))
    mark(again, 0, ShopRequestItemChange(pulled = Some(true)))
    run(shop.sell(seller, again.id))
    assertEquals(held(cardId), Nil)
    assertEquals(db(sql"SELECT card_id FROM binder_slots WHERE id=$slot".query[Option[String]].unique), None)
  }

  test("put back returns one card or the whole order, and a sold card can't be changed until it is back") {
    val a = owned(count("NM", 2))
    val b = owned(count("LP", 1))
    val req = request(item(a, "NM", 2), item(b, "LP", 1))
    mark(req, 0, ShopRequestItemChange(pulled = Some(true)))
    mark(req, 1, ShopRequestItemChange(pulled = Some(true)))
    run(shop.sell(seller, req.id))
    assertEquals((held(a), held(b)), (Nil, Nil))
    assert(run(shop.updateItem(seller, req.id, 0, ShopRoutes.applyItemChange(_, ShopRequestItemChange(pulled = Some(false))))).get.isLeft)

    val one = run(shop.putBack(seller, req.id, Some(1))).get
    assertEquals(one.items.map(_.soldQty), List(2, 0))
    assertEquals((held(a), held(b)), (Nil, List(("LP", 1))))

    run(shop.putBack(seller, req.id, None))
    assertEquals(held(a), List(("NM", 2)))
    // Putting back twice adds nothing.
    run(shop.putBack(seller, req.id, None))
    assertEquals((held(a), held(b)), (List(("NM", 2)), List(("LP", 1))))
    assertEquals(run(shop.putBack(other, req.id, None)), None)
  }
