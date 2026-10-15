/**
 * MultiGameSuite — multi-game support (migration 016).
 *
 * Pure tests (always run): TCGTracking parsing helpers.
 * DB tests (opt-in, TRADING_IT_DB_URL — see TradingDbSuite): each game is a
 * separate world — collection, Spaces, boxes and offers never mix games.
 * Live test (opt-in, also TCGTRACKING_LIVE=1): really imports one Pokémon
 * Japan set from TCGTracking into the test DB.
 */

package com.poketracker.service

import cats.syntax.all.*
import com.poketracker.models.*
import com.poketracker.repository.*
import doobie.*
import doobie.implicits.*
import zio.*
import zio.interop.catz.*

class MultiGameSuite extends munit.FunSuite:

  // The live test downloads a whole set list and a set from TCGTracking.
  override val munitTimeout = scala.concurrent.duration.Duration(3, "min")

  private val jp = Game("pokemon-jp", "Pokémon (Japanese)", "Pokémon JP", Game.TcgTracking, 85, true, 1, List("Normal", "Holofoil"), false)
  private def sku(cnd: String, v: String, mkt: Double, lng: String = "JP") =
    TcgTrackingCatalog.TtSku(Some(cnd), Some(v), Some(lng), Some(mkt))

  // ── pure ──────────────────────────────────────────────────────────────────

  test("collector number drops the set total") {
    assertEquals(TcgTrackingCatalog.collectorNumber(Some("006/103")), "006")
    assertEquals(TcgTrackingCatalog.collectorNumber(Some("LOB-EN001")), "LOB-EN001")
    assertEquals(TcgTrackingCatalog.collectorNumber(None), "")
  }

  test("name loses TCGTracking's ' - number' disambiguation suffix") {
    assertEquals(TcgTrackingCatalog.cleanName("Moltres - 006/103", Some("006/103")), "Moltres")
    assertEquals(TcgTrackingCatalog.cleanName("Exeggcute", Some("001/103")), "Exeggcute")
  }

  test("print keys match the English Pokémon keys where they overlap") {
    assertEquals(TcgTrackingCatalog.printKey("Normal"), "normal")
    assertEquals(TcgTrackingCatalog.printKey("Holofoil"), "holo")
    assertEquals(TcgTrackingCatalog.printKey("Reverse Holofoil"), "reverse")
    assertEquals(TcgTrackingCatalog.printKey("1st Edition"), "1st-edition")
    assertEquals(TcgTrackingCatalog.printKey("Cold Foil"), "cold-foil")
  }

  test("default price follows the game's print preference; every print is kept") {
    val (default, variants) = TcgTrackingCatalog.pricing(jp, List(
      sku("NM", "Holofoil", 5.0), sku("LP", "Holofoil", 4.0), sku("NM", "Normal", 1.0))).get
    assertEquals(default.nm, Some(1.0))
    assertEquals(variants.keySet, Set("normal", "holo"))
    assertEquals(variants("holo").lp, Some(4.0))
  }

  test("only-holo card defaults to holo; unpriced products give nothing") {
    assertEquals(TcgTrackingCatalog.pricing(jp, List(sku("NM", "Holofoil", 0.38))).map(_._1.nm), Some(Some(0.38)))
    assertEquals(TcgTrackingCatalog.pricing(jp, List(sku("NM", "Normal", 0.0))), None)
  }

  test("English SKUs win when a product lists several languages") {
    val mtg = jp.copy(id = "mtg", category = 1, printPreference = List("Normal", "Foil"))
    val (d, _) = TcgTrackingCatalog.pricing(mtg, List(sku("NM", "Normal", 2.0, "EN"), sku("NM", "Normal", 9.0, "JP"))).get
    assertEquals(d.nm, Some(2.0))
  }

  // ── DB ────────────────────────────────────────────────────────────────────

  private val url = sys.env.get("TRADING_IT_DB_URL")
  private lazy val xa: Transactor[Task] = Transactor.fromDriverManager[Task](
    driver = "org.postgresql.Driver", url = url.get,
    user = sys.env.getOrElse("TRADING_IT_DB_USER", "postgres"),
    password = sys.env.getOrElse("TRADING_IT_DB_PASSWORD", ""), logHandler = None)
  private def run[A](z: Task[A]): A =
    Unsafe.unsafe { implicit u => Runtime.default.unsafe.run(z).getOrThrowFiberFailure() }

  private val u1 = "mg-user1"; private val u2 = "mg-user2"
  private def dbTest(name: String)(body: => Unit): Unit =
    test(name)(if url.isEmpty then assume(false, "TRADING_IT_DB_URL not set") else body)

  override def beforeAll(): Unit = if url.nonEmpty then run {
    val user = (id: String) =>
      sql"""INSERT INTO users (id, supabase_user_id, username, email) VALUES ($id, ${"sb-" + id}, $id, ${id + "@example.test"})""".update.run
    (sql"DELETE FROM users WHERE id IN ($u1, $u2)".update.run *>
      sql"DELETE FROM card_sets WHERE id IN ('mgset', 'tt85-mg')".update.run *>
      user(u1) *> user(u2) *>
      sql"""INSERT INTO card_sets (id, name, series, printed_total, total, release_date, symbol_url, logo_url, game_id) VALUES
            ('mgset', 'MG English', 'MG', 1, 1, '2026-01-01', '', '', 'pokemon'),
            ('tt85-mg', 'MG Japanese', '2026', 1, 1, '2026-01-01', '', '', 'pokemon-jp')""".update.run *>
      sql"""INSERT INTO cards (id, set_id, name, number, image_small, image_large, game_id) VALUES
            ('mgset-1', 'mgset', 'Pikachu EN', '1', '', '', 'pokemon'),
            ('tt85-mg-1', 'tt85-mg', 'Pikachu JP', '1', '', '', 'pokemon-jp')""".update.run
    ).transact(xa).unit
  }

  override def afterAll(): Unit = if url.nonEmpty then run {
    (sql"DELETE FROM users WHERE id IN ($u1, $u2)".update.run *>
      sql"DELETE FROM card_sets WHERE id IN ('mgset', 'tt85-mg')".update.run).transact(xa).unit
  }

  dbTest("a game's collection never shows another game's cards; auto-filed boxes follow the card's game") {
    val coll = CollectionRepository.Live(xa)
    val now = java.time.Instant.now()
    run(coll.upsertEntry(CollectionEntry("x1", u1, "mgset-1", List(ConditionCount("NM", 1, None)), "NM", now)))
    run(coll.upsertEntry(CollectionEntry("x2", u1, "tt85-mg-1", List(ConditionCount("NM", 2, None)), "NM", now)))
    assertEquals(run(coll.findByUser(u1, "pokemon")).map(_.cardId), List("mgset-1"))
    assertEquals(run(coll.findByUser(u1, "pokemon-jp")).map(_.cardId), List("tt85-mg-1"))
    assertEquals(run(coll.findByUserWithCards(u1, "pokemon-jp")).map(_.cardId), List("tt85-mg-1"))

    val storage = StorageRepository.Live(xa)
    assertEquals(run(storage.findBoxesByUser(u1, "pokemon")).map(_.name), List("MG English"))
    assertEquals(run(storage.findBoxesByUser(u1, "pokemon-jp")).map(_.name), List("MG Japanese"))
    assertEquals(run(RoomRepository.Live(xa).listLots(u1, "pokemon-jp")).map(_.cardId), List("tt85-mg-1"))
  }

  dbTest("each game gets its own home Space, created once even under concurrent loads") {
    val rooms = RoomRepository.Live(xa)
    val en = run(rooms.listSpaces(u2, "pokemon"))
    run(ZIO.foreachPar(1 to 6)(_ => rooms.listSpaces(u2, "pokemon-jp")))
    val jpSpaces = run(rooms.listSpaces(u2, "pokemon-jp"))
    assertEquals(en.size, 1)
    assertEquals(jpSpaces.size, 1)
    assertNotEquals(en.head.id, jpSpaces.head.id)
  }

  dbTest("an offer can't mix games, and offers/share pages are per game") {
    val trading = TradingService.Live(TradingRepository.Live(xa), UserRepository.Live(xa))
    val coll = CollectionRepository.Live(xa)
    val now = java.time.Instant.now()
    run(coll.upsertEntry(CollectionEntry("x3", u2, "mgset-1", List(ConditionCount("NM", 1, None)), "NM", now)))
    run(trading.saveTradeItem(u1, "tt85-mg-1", "NM", 1, None, None))
    val slug = run(trading.updateShare(u1, enabled = true, collectionPublic = false, bio = None)).slug
    val mixed = run(trading.makeOffer(u2, slug, List(OfferLine("tt85-mg-1", "NM", 1)), List(OfferLine("mgset-1", "NM", 1)), None, None).either)
    assert(mixed.left.exists { case TradingError(400, m) => m.contains("one game"); case _ => false }, mixed.toString)
    val ok = run(trading.makeOffer(u2, slug, List(OfferLine("tt85-mg-1", "NM", 1)), Nil, Some(3.0), None))
    assertEquals(run(trading.offers(u2, "pokemon-jp")).map(_.id), List(ok.id))
    assertEquals(run(trading.offers(u2, "pokemon")), Nil)
    assertEquals(run(trading.sharedProfile(slug, "pokemon-jp")).tradeList.map(_.card.cardId), List("tt85-mg-1"))
    assertEquals(run(trading.sharedProfile(slug, "pokemon")).tradeList, Nil)
    assertEquals(run(trading.sharedProfile(slug, "pokemon")).games, List("pokemon-jp"))
  }

  // ── live TCGTracking import (network) ─────────────────────────────────────

  test("live: import a real Pokémon Japan set from TCGTracking") {
    assume(url.nonEmpty && sys.env.get("TCGTRACKING_LIVE").contains("1"), "set TRADING_IT_DB_URL and TCGTRACKING_LIVE=1")
    val cards = CardRepository.Live(xa)
    val tcg = TcgTrackingCatalog.Live(cards)
    val n = run(tcg.syncSets(jp))
    assert(n > 100, s"expected the full JP set list, got $n")
    val sets = run(cards.findAllSets("pokemon-jp")).filterNot(_.id == "tt85-mg")
    // A small set keeps the test quick.
    val set = sets.filter(_.total > 20).minBy(_.total)
    run(tcg.importSet(jp, set.id))
    val imported = run(cards.findCardsBySet(set.id))
    assert(imported.size >= set.total / 2, s"${set.name}: only ${imported.size} of ${set.total} cards")
    assert(imported.forall(c => c.id.startsWith(set.id + "-") && c.images.small.nonEmpty))
    assert(imported.count(_.prices.exists(_.nm.isDefined)) > imported.size / 2, "most cards should be priced")
    assert(run(cards.searchCards(imported.head.name, 20, "pokemon-jp")).exists(_.id == imported.head.id))
    assertEquals(run(cards.searchCards(imported.head.name, 20, "pokemon")).filter(_.setId == set.id), Nil)
  }
