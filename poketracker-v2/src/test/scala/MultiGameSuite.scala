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

  private val jp = Game("pokemon-jp", "Pokémon (Japanese)", "Pokémon JP", Game.TcgTracking, 85, true, 1, List("Normal", "Holofoil"), false, Some(6))
  private def sku(cnd: String, v: String, mkt: Double, lng: String = "JP") =
    TcgTrackingCatalog.TtSku(Some(cnd), Some(v), Some(lng), Some(mkt))

  // ── pure ──────────────────────────────────────────────────────────────────

  test("collector number drops the set total") {
    assertEquals(TcgTrackingCatalog.collectorNumber(Some("006/103")), "006")
    assertEquals(TcgTrackingCatalog.collectorNumber(Some("LOB-EN001")), "LOB-EN001")
    assertEquals(TcgTrackingCatalog.collectorNumber(None), "")
  }

  test("printed set size comes from the most common collector-number total") {
    assertEquals(TcgTrackingCatalog.printedTotal(List(Some("20/30"), Some("1/30"), None, Some("31/30"), Some("SV01"))), Some(30))
    assertEquals(TcgTrackingCatalog.printedTotal(List(Some("SWSH001"), None)), None)
  }

  test("added English sets get pokemontcg.io's era names") {
    def d(s: String) = java.time.LocalDate.parse(s)
    assertEquals(TcgTrackingCatalog.pokemonEra(d("2016-04-27")), "XY")
    assertEquals(TcgTrackingCatalog.pokemonEra(d("2026-07-17")), "Mega Evolution")
    assertEquals(TcgTrackingCatalog.pokemonEra(d("1999-01-09")), "Base")
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

  // ── fallback prices (every card gets one) ─────────────────────────────────

  private def tp(nm: Double) = (CardPrices(Some(nm), None, None, None, None), Map.empty[String, CardPrices])

  test("TCGplayer prices pass through untouched, source None") {
    val out = TcgTrackingCatalog.fillGaps(List(("a", Some("C"), Some(1))), Map("a" -> tp(2.0)), Map(1 -> 9.0))
    assertEquals(out.map(r => (r._1, r._2.nm, r._4)), List(("a", Some(2.0), None)))
  }

  test("missing TCGplayer price falls back to Cardmarket, scaled by similar-value cards' TCGplayer/Cardmarket ratio") {
    // Six cards worth €5-10 priced on both: TCGplayer is 2x Cardmarket there.
    val both = (5 to 10).map(i => (s"c$i", Some("C"), Some(i))).toList
    val tcg = (5 to 10).map(i => s"c$i" -> tp(2.0 * i)).toMap
    val cm = (5 to 10).map(i => i -> i.toDouble).toMap + (99 -> 8.0)
    val out = TcgTrackingCatalog.fillGaps(both :+ ("x", Some("R"), Some(99)), tcg, cm)
    val x = out.find(_._1 == "x").get
    assertEquals(x._4, Some("cardmarket"))
    assertEquals(x._2.nm, Some(16.0))
    assertEquals(x._2.lp, Some(13.6))
  }

  test("bulk cards don't set the conversion for a valuable card") {
    // Commons: TCGplayer $0.25 floor vs Cardmarket €0.05 (5x). A €500 card
    // has no similar-value pairs, so it converts at plain EUR→USD.
    val bulk = (1 to 8).map(i => (s"b$i", Some("C"), Some(i))).toList
    val tcg = (1 to 8).map(i => s"b$i" -> tp(0.25)).toMap
    val cm = (1 to 8).map(_ -> 0.05).toMap + (500 -> 500.0)
    val x = TcgTrackingCatalog.fillGaps(bulk :+ ("sr", Some("SR"), Some(500)), tcg, cm).find(_._1 == "sr").get
    assertEquals(x._2.nm, Some(550.0))
  }

  test("too few pairs: Cardmarket converts at plain EUR to USD (1.1)") {
    val out = TcgTrackingCatalog.fillGaps(List(("x", None, Some(7))), Map.empty, Map(7 -> 10.0))
    assertEquals(out.head._2.nm, Some(11.0))
  }

  test("only an LP copy sold on TCGplayer: that real price wins over Cardmarket, other conditions filled from it") {
    val lpOnly = CardPrices(None, Some(3.0), None, None, None)
    val out = TcgTrackingCatalog.fillGaps(List(("x", None, Some(7))), Map("x" -> (lpOnly, Map("1st-edition" -> lpOnly))), Map(7 -> 50.0))
    val (_, p, v, src) = out.head
    assertEquals(src, None)
    assertEquals((p.nm, p.lp, p.mp), (Some(3.53), Some(3.0), Some(2.47)))
    assertEquals(v("1st-edition").nm, Some(3.53))
  }

  test("never estimates: a card with no sale on TCGplayer or Cardmarket stays unpriced") {
    val cards = List(("u1", Some("U"), None), ("u2", Some("U"), None), ("u3", Some("U"), None), ("x", Some("U"), None))
    val tcg = Map("u1" -> tp(1.0), "u2" -> tp(3.0), "u3" -> tp(5.0))
    assertEquals(TcgTrackingCatalog.fillGaps(cards, tcg, Map.empty).map(_._1), List("u1", "u2", "u3"))
  }

  test("Cardmarket value is the middle of trend/averages, skipping zeros") {
    val body = """{"version":1,"priceGuides":[
      {"idProduct":1,"trend":2.5,"avg30":9,"avg7":null,"avg":null,"trend-holo":null,"trend-foil":null},
      {"idProduct":2,"trend":0,"avg30":null,"avg7":4,"avg":null,"trend-holo":null,"trend-foil":null},
      {"idProduct":3,"trend":null,"avg30":null,"avg7":null,"avg":null,"trend-holo":null,"trend-foil":0}]}"""
    assertEquals(CardmarketGuide.parse(body), Right(Map(1 -> 5.75, 2 -> 4.0)))
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
      sql"DELETE FROM card_sets WHERE id IN ('mgset', 'tt85-mg', 'mgA', 'mgB', 'mgC')".update.run *>
      user(u1) *> user(u2) *>
      sql"""INSERT INTO card_sets (id, name, series, printed_total, total, release_date, symbol_url, logo_url, game_id) VALUES
            ('mgset', 'MG English', 'MG', 1, 1, '2026-01-01', '', '', 'pokemon'),
            ('tt85-mg', 'MG Japanese', '2026', 1, 1, '2026-01-01', '', '', 'pokemon-jp'),
            ('mgA', 'MG 2020', 'MG', 1, 1, '2020-05-01', '', '', 'pokemon'),
            ('mgB', 'MG 2010', 'MG', 1, 1, '2010-05-01', '', '', 'pokemon'),
            ('mgC', 'MG 2015', 'MG', 1, 1, '2015-05-01', '', '', 'pokemon')""".update.run *>
      sql"""INSERT INTO cards (id, set_id, name, number, image_small, image_large, game_id) VALUES
            ('mgset-1', 'mgset', 'Pikachu EN', '1', '', '', 'pokemon'),
            ('tt85-mg-1', 'tt85-mg', 'Pikachu JP', '1', '', '', 'pokemon-jp')""".update.run
    ).transact(xa).unit
  }

  override def afterAll(): Unit = if url.nonEmpty then run {
    (sql"DELETE FROM users WHERE id IN ($u1, $u2)".update.run *>
      sql"DELETE FROM card_sets WHERE id IN ('mgset', 'tt85-mg', 'mgA', 'mgB', 'mgC')".update.run).transact(xa).unit
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

  dbTest("set boxes reorder by release date across the room's units; other boxes stay put") {
    val rooms = RoomRepository.Live(xa)
    val space = run(rooms.listSpaces(u1, "pokemon")).head
    val unit = run(rooms.createStorageUnit(u1, space.id, "Arrange rack", "rack", "collector_rack", "#000", 1, 3, 2, "{}"))
    val unit2 = run(rooms.createStorageUnit(u1, space.id, "Arrange rack 2", "rack", "collector_rack", "#000", 1, 3, 2, "{}"))
    def box(id: String, boxType: String, u: String, stack: Int, level: Int) =
      sql"""INSERT INTO storage_boxes (id, user_id, name, box_type, space_id, storage_unit_id, shelf_index, stack_index, stack_level)
            VALUES ($id, $u1, $id, $boxType, ${space.id}, $u, 0, $stack, $level)""".update.run
    run((box("bx-2020", "auto_set:mgA", unit.id, 0, 0) *> box("bx-custom", "custom", unit.id, 1, 0) *>
         box("bx-2015", "auto_set:mgC", unit2.id, 0, 0) *> box("bx-2010", "auto_set:mgB", unit.id, 0, 1)).transact(xa))
    def layout = run(sql"""SELECT id, storage_unit_id, stack_index, stack_level FROM storage_boxes
                            WHERE storage_unit_id IN (${unit.id}, ${unit2.id})"""
      .query[(String, String, Int, Int)].to[List].transact(xa)).map(r => r._1 -> (r._2, r._3, r._4)).toMap

    // Oldest at the top of the first stack, the next below it, then on into the second unit.
    assertEquals(run(rooms.arrangeSetBoxesByDate(u1, unit2.id, newestFirst = false)), 3)
    assertEquals(layout, Map("bx-2010" -> (unit.id, 0, 1), "bx-2015" -> (unit.id, 0, 0),
      "bx-2020" -> (unit2.id, 0, 0), "bx-custom" -> (unit.id, 1, 0)))
    run(rooms.arrangeSetBoxesByDate(u1, unit.id, newestFirst = true))
    assertEquals(layout, Map("bx-2020" -> (unit.id, 0, 1), "bx-2015" -> (unit.id, 0, 0),
      "bx-2010" -> (unit2.id, 0, 0), "bx-custom" -> (unit.id, 1, 0)))
    // Someone else's unit: nothing moves.
    assertEquals(run(rooms.arrangeSetBoxesByDate(u2, unit.id, newestFirst = false)), 0)
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

  dbTest("offers are listed per game") {
    val trading = TradingService.Live(TradingRepository.Live(xa))
    val id = java.util.UUID.randomUUID().toString
    run(sql"""INSERT INTO card_offers (id, seller_id, buyer_id, cash_amount, game_id)
              VALUES ($id, $u1, $u2, 3.0, 'pokemon-jp')""".update.run.transact(xa))
    assertEquals(run(trading.offers(u2, "pokemon-jp")).map(_.id), List(id))
    assertEquals(run(trading.offers(u2, "pokemon")), Nil)
  }

  // ── live TCGTracking import (network) ─────────────────────────────────────

  test("live: import a real Pokémon Japan set from TCGTracking") {
    assume(url.nonEmpty && sys.env.get("TCGTRACKING_LIVE").contains("1"), "set TRADING_IT_DB_URL and TCGTRACKING_LIVE=1")
    val cards = CardRepository.Live(xa)
    val guide = CardmarketGuide.Live(run(Ref.make(Map.empty[Int, (java.time.Instant, Map[Int, Double])])))
    val tcg = TcgTrackingCatalog.Live(cards, guide)
    val n = run(tcg.syncSets(jp))
    assert(n > 100, s"expected the full JP set list, got $n")
    val sets = run(cards.findAllSets("pokemon-jp")).filterNot(_.id == "tt85-mg")
    // A small set keeps the test quick.
    // TCGTRACKING_LIVE_SET picks a specific set (e.g. an old one with many unsold cards).
    val set = sys.env.get("TCGTRACKING_LIVE_SET").flatMap(id => sets.find(_.id == id))
      .getOrElse(sets.filter(_.total > 20).minBy(_.total))
    run(tcg.importSet(jp, set.id))
    val imported = run(cards.findCardsBySet(set.id))
    assert(imported.size >= set.total / 2, s"${set.name}: only ${imported.size} of ${set.total} cards")
    assert(imported.forall(c => c.id.startsWith(set.id + "-") && c.images.small.nonEmpty))
    // Every card in this set has sold somewhere: TCGplayer, else Cardmarket.
    val unpriced = imported.filterNot(_.prices.exists(_.nm.isDefined))
    assert(unpriced.isEmpty, s"unpriced: ${unpriced.map(_.name).take(5)}")
    assert(run(cards.searchCards(imported.head.name, 20, "pokemon-jp")).exists(_.id == imported.head.id))
    assertEquals(run(cards.searchCards(imported.head.name, 20, "pokemon")).filter(_.setId == set.id), Nil)
  }
