/**
 * TradingDbSuite — end-to-end check of TradingService + TradingRepository
 * against a real Postgres that has schema.sql and migration 015 applied.
 *
 * Opt-in: skipped unless TRADING_IT_DB_URL is set (a throwaway database —
 * this suite inserts and deletes its own rows), e.g.
 *   TRADING_IT_DB_URL=jdbc:postgresql://localhost:55432/postgres
 *   TRADING_IT_DB_USER=postgres  TRADING_IT_DB_PASSWORD=
 */

package com.poketracker

import cats.syntax.all.*
import com.poketracker.repository.{TradingRepository, UserRepository}
import com.poketracker.service.{OfferLine, TradingError, TradingService}
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*

class TradingDbSuite extends munit.FunSuite:

  private val url = sys.env.get("TRADING_IT_DB_URL")

  override def munitTests() = if url.isEmpty then Nil else super.munitTests()

  private lazy val xa: Transactor[Task] = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get,
    user = sys.env.getOrElse("TRADING_IT_DB_USER", "postgres"),
    password = sys.env.getOrElse("TRADING_IT_DB_PASSWORD", ""), logHandler = None)

  private lazy val svc = TradingService.Live(TradingRepository.Live(xa), UserRepository.Live(xa))

  private def run[A](z: Task[A]): A =
    Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(z).getOrThrowFiberFailure() }

  private def failsWith(status: Int)(z: Task[?]): Unit =
    run(z.either) match
      case Left(TradingError(s, _)) => assertEquals(s, status)
      case other                    => fail(s"expected TradingError($status), got $other")

  private val seller = "it-seller"; private val buyer = "it-buyer"; private val demo = "it-demo"

  override def beforeAll(): Unit = if url.nonEmpty then run {
    val cleanup = sql"DELETE FROM users WHERE id IN ($seller, $buyer, $demo)".update.run *>
      sql"DELETE FROM card_sets WHERE id = 'itset'".update.run
    val user = (id: String, anon: Boolean) =>
      sql"""INSERT INTO users (id, supabase_user_id, username, email, is_anonymous)
            VALUES ($id, ${"sb-" + id}, $id, ${id + "@example.test"}, $anon)""".update.run
    val coll = (uid: String, cardId: String, json: String) =>
      sql"INSERT INTO collection_entries (user_id, card_id, conditions) VALUES ($uid, $cardId, $json::jsonb)".update.run
    (cleanup *>
      user(seller, false) *> user(buyer, false) *> user(demo, true) *>
      sql"""INSERT INTO card_sets (id, name, series, printed_total, total, release_date, symbol_url, logo_url)
            VALUES ('itset', 'IT Set', 'IT', 3, 3, '2026/01/01', '', '')""".update.run *>
      sql"""INSERT INTO cards (id, set_id, name, number, image_small, image_large) VALUES
            ('itset-1', 'itset', 'Pikachu', '1', 's1', 'l1'),
            ('itset-2', 'itset', 'Charizard', '2', 's2', 'l2'),
            ('itset-3', 'itset', 'Bulbasaur', '3', 's3', 'l3')""".update.run *>
      sql"INSERT INTO card_prices (card_id, price_nm, price_lp) VALUES ('itset-1', 2.50, 2.00), ('itset-2', 300.00, NULL)".update.run *>
      coll(seller, "itset-1", """[{"condition":"NM","quantity":3},{"condition":"LP","quantity":1}]""") *>
      coll(seller, "itset-2", """[{"condition":"NM 1st Ed","quantity":1}]""") *>
      coll(buyer, "itset-3", """[{"condition":"NM","quantity":2}]""")
    ).transact(xa).unit
  }

  override def afterAll(): Unit = if url.nonEmpty then run {
    (sql"DELETE FROM users WHERE id IN ($seller, $buyer, $demo)".update.run *>
      sql"DELETE FROM card_sets WHERE id = 'itset'".update.run).transact(xa).unit
  }

  test("share link: created lazily, stable, regenerable; demo accounts refused") {
    val a = run(svc.getShare(seller))
    assertEquals(a.slug.length, 12)
    assertEquals(run(svc.getShare(seller)).slug, a.slug)
    val b = run(svc.regenerateSlug(seller))
    assertNotEquals(b.slug, a.slug)
    failsWith(404)(svc.sharedProfile(a.slug))
    failsWith(403)(svc.getShare(demo))
  }

  test("trade list respects owned quantity and condition pricing") {
    failsWith(400)(svc.saveTradeItem(seller, "itset-1", "NM", 4, None, None))
    val list = run(svc.saveTradeItem(seller, "itset-1", "LP", 1, Some(3.0), Some("  minor edge wear ")))
    val item = list.find(_.card.condition == "LP").get
    assertEquals(item.card.marketPrice, Some(2.0))
    assertEquals(item.note, Some("minor edge wear"))
    run(svc.saveTradeItem(seller, "itset-2", "NM 1st Ed", 1, None, None))
    val all = run(svc.tradeList(seller))
    assertEquals(all.find(_.card.cardId == "itset-2").get.card.marketPrice, Some(300.0))
  }

  test("share page hides collection until made public, and turns off") {
    val slug = run(svc.getShare(seller)).slug
    val p = run(svc.sharedProfile(slug))
    assertEquals(p.username, seller)
    assertEquals(p.tradeList.size, 2)
    assertEquals(p.collection, None)
    run(svc.updateShare(seller, enabled = true, collectionPublic = true, bio = Some("hi")))
    val p2 = run(svc.sharedProfile(slug))
    assertEquals(p2.collection.map(_.map(c => (c.cardId, c.condition, c.quantity)).toSet),
      Some(Set(("itset-1", "NM", 3), ("itset-1", "LP", 1), ("itset-2", "NM 1st Ed", 1))))
    run(svc.updateShare(seller, enabled = false, collectionPublic = true, bio = Some("hi")))
    failsWith(404)(svc.sharedProfile(slug))
    run(svc.updateShare(seller, enabled = true, collectionPublic = false, bio = None))
  }

  test("offer validation") {
    val slug = run(svc.getShare(seller)).slug
    val want = List(OfferLine("itset-1", "LP", 1))
    failsWith(403)(svc.makeOffer(demo, slug, want, Nil, Some(5), None))
    failsWith(400)(svc.makeOffer(seller, slug, want, Nil, Some(5), None))                                // own cards
    failsWith(400)(svc.makeOffer(buyer, slug, Nil, Nil, Some(5), None))                                  // wants nothing
    failsWith(400)(svc.makeOffer(buyer, slug, want, Nil, None, None))                                    // offers nothing
    failsWith(400)(svc.makeOffer(buyer, slug, List(OfferLine("itset-1", "NM", 1)), Nil, Some(5), None))  // not listed, collection private
    failsWith(400)(svc.makeOffer(buyer, slug, List(OfferLine("itset-1", "LP", 2)), Nil, Some(5), None))  // more than listed
    failsWith(400)(svc.makeOffer(buyer, slug, want, List(OfferLine("itset-3", "NM", 3)), None, None))    // buyer doesn't own 3
    failsWith(404)(svc.makeOffer(buyer, "nope", want, Nil, Some(5), None))
  }

  test("offer lifecycle: thread, unread, status rules") {
    val slug = run(svc.getShare(seller)).slug
    val o = run(svc.makeOffer(buyer, slug, List(OfferLine("itset-1", "LP", 1)),
      List(OfferLine("itset-3", "NM", 1)), Some(1.5), Some("Would you take this?")))
    assertEquals(o.role, "buyer")
    assertEquals(o.otherUser, seller)
    assertEquals(o.status, "Pending")
    assertEquals(o.wants.map(_.name), List("Pikachu"))
    assertEquals(o.gives.map(_.name), List("Bulbasaur"))
    assertEquals(o.cashAmount, Some(1.5))
    assertEquals(o.messages.map(_.body), List("Would you take this?"))
    assert(!o.unread)

    assertEquals(run(svc.unreadCount(seller)), 1)
    assertEquals(run(svc.unreadCount(buyer)), 0)
    assert(run(svc.offers(seller)).exists(x => x.id == o.id && x.unread && x.role == "seller"))

    val seen = run(svc.offer(seller, o.id))
    assert(!seen.unread)
    assertEquals(run(svc.unreadCount(seller)), 0)

    failsWith(404)(svc.offer(demo, o.id))
    failsWith(400)(svc.setStatus(buyer, o.id, "Accepted"))
    val accepted = run(svc.setStatus(seller, o.id, "Accepted"))
    assertEquals(accepted.status, "Accepted")
    assertEquals(run(svc.unreadCount(buyer)), 1)

    val replied = run(svc.postMessage(buyer, o.id, "Great — PayPal G&S ok?"))
    assertEquals(replied.messages.size, 2)
    failsWith(400)(svc.postMessage(buyer, o.id, "   "))
    failsWith(404)(svc.postMessage(demo, o.id, "hi"))

    assertEquals(run(svc.setStatus(buyer, o.id, "Completed")).status, "Completed")
    failsWith(400)(svc.setStatus(seller, o.id, "Cancelled"))
  }

  test("status update is compare-and-set: a stale 'from' changes nothing") {
    val repo = TradingRepository.Live(xa)
    val slug = run(svc.getShare(seller)).slug
    val o = run(svc.makeOffer(buyer, slug, List(OfferLine("itset-1", "LP", 1)), Nil, Some(2.0), None))
    run(svc.setStatus(buyer, o.id, "Withdrawn"))
    // The seller's Accept was decided while the offer still looked Pending.
    assert(!run(repo.setStatus(o.id, "Pending", "Accepted", seller)))
    assertEquals(run(svc.offer(seller, o.id)).status, "Withdrawn")
  }
