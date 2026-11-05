/**
 * The shop request chat against an isolated Postgres with schema.sql and migrations (incl. 022) applied: unread works
 * both ways, a seller's reply answers a new request, "ask for photos" collects cards on one open request, and a buyer
 * only ever sees their own requests. Opt in with SHOP_CHAT_IT_DB_URL; never point this fixture-writing suite at
 * production.
 */
package com.poketracker

import cats.syntax.all.*
import com.poketracker.models.*
import com.poketracker.repository.ShopRepository
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*

class ShopChatDbSuite extends munit.FunSuite:
  private val url = sys.env.get("SHOP_CHAT_IT_DB_URL")
  override def munitTests() = if url.isEmpty then Nil else super.munitTests()

  private lazy val xa = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get, user = "postgres", password = "", logHandler = None)
  private lazy val shop = ShopRepository.Live(xa)
  private val seller = "chat-test-seller"
  private val buyer  = "chat-test-buyer"
  private val other  = "chat-test-other"
  private val users  = List(seller, buyer, other)

  private def run[A](effect: Task[A]): A = Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(effect).getOrThrowFiberFailure() }
  private def db[A](query: ConnectionIO[A]): A = run(query.transact(xa))

  override def beforeAll(): Unit = if url.nonEmpty then
    require(url.get.startsWith("jdbc:postgresql://127.0.0.1:"), "Use an isolated local database")
    db(users.traverse_(id =>
      sql"INSERT INTO users(id,username,supabase_user_id,email) VALUES($id,$id,$id,${id + "@example.test"})".update.run.void))
    run(shop.saveSettings(seller, ShopSettings("chat-test-shop", true, "", "Chat Test Shop", "")))

  override def afterAll(): Unit = if url.nonEmpty then
    db((sql"DELETE FROM shop_requests WHERE seller_user_id=$seller".update.run *>
      sql"DELETE FROM shop_settings WHERE user_id=$seller".update.run *>
      users.traverse_(id => sql"DELETE FROM users WHERE id=$id".update.run.void)).void)

  private val card = ShopRequestItem("chat-card-1", "Greavard", "65", "NM", 1)
  private def inbox(id: String) = run(shop.list(seller)).find(_.id == id).get
  private def sent(id: String)  = run(shop.listSent(buyer)).find(_._1.id == id).get

  test("a signed-in buyer's request starts read on their side and carries their account") {
    val r = run(shop.create(seller, ShopRequestInput(buyer, "", "Still have it?", List(card)), Some(buyer)))
    assertEquals(inbox(r.id).buyerUserId, Some(buyer))
    assertEquals(inbox(r.id).unread, false, "a new request is flagged by status, not as an unread chat")
    assertEquals(sent(r.id)._2, "chat-test-shop")
    assertEquals(sent(r.id)._3, "Chat Test Shop")
    assertEquals(sent(r.id)._4, false)
  }

  test("chat: each side's messages are unread for the other until they open it; a seller reply answers it") {
    val r = run(shop.create(seller, ShopRequestInput(buyer, "", "", List(card)), Some(buyer)))
    run(shop.addMessage(r.id, buyer, "Is it centered?"))
    assertEquals(inbox(r.id).unread, true)
    assertEquals(sent(r.id)._4, false, "your own message isn't unread for you")
    run(shop.markRead(r.id, seller))
    assertEquals(inbox(r.id).unread, false)
    run(shop.addMessage(r.id, seller, "Yes, photos coming"))
    assertEquals(inbox(r.id).status, "answered")
    assertEquals(sent(r.id)._4, true)
    run(shop.markRead(r.id, buyer))
    assertEquals(sent(r.id)._4, false)
    assertEquals(run(shop.messages(r.id)).map(_._3), List("Is it centered?", "Yes, photos coming"))
  }

  test("ask for photos: cards gather on one open photo request; asking again for the same card adds nothing") {
    val first  = run(shop.askPhotos(seller, buyer, buyer, card.copy(photos = Some(true))))
    val again  = run(shop.askPhotos(seller, buyer, buyer, card.copy(photos = Some(true))))
    val second = run(shop.askPhotos(seller, buyer, buyer, card.copy(cardId = "chat-card-2", photos = Some(true))))
    assertEquals((first._2, again._2, second._2), (true, false, true))
    assertEquals(Set(first._1.id, again._1.id, second._1.id).size, 1)
    assertEquals(inbox(first._1.id).kind, "photos")
    assertEquals(inbox(first._1.id).items.map(_.cardId), List("chat-card-1", "chat-card-2"))
    run(shop.setStatus(seller, first._1.id, "done"))
    val fresh = run(shop.askPhotos(seller, buyer, buyer, card.copy(photos = Some(true))))
    assert(fresh._1.id != first._1.id, "a closed photo request isn't reused")
  }

  test("a buyer only sees their own requests") {
    val r = run(shop.create(seller, ShopRequestInput(buyer, "", "mine", List(card)), Some(buyer)))
    assert(run(shop.findSent(buyer, r.id)).nonEmpty)
    assertEquals(run(shop.findSent(other, r.id)), None)
    assert(!run(shop.listSent(other)).exists(_._1.id == r.id))
    assertEquals(run(shop.findSent(buyer, r.id)).map(_._2), Some(seller))
  }
