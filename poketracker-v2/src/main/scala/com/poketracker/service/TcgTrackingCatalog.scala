/**
 * TcgTrackingCatalog — the card catalog for every game whose source is
 * "tcgtracking" (Pokémon Japan, Magic, Yu-Gi-Oh, One Piece, Lorcana, ...).
 * One generic importer: TCGTracking serves every game through the same API
 * shape, so adding a game is a row in `games`, not code.
 *
 * HOW IT WORKS
 *   - syncSets: GET /{category}/sets → card_sets rows with id
 *     "tt{category}-{tcgSetId}" (external_id keeps the TCGTracking id).
 *   - importSet: GET /{category}/sets/{id}/cards → cards with id
 *     "{setId}-{productId}" (keeps the "cardId = setId + '-' + suffix" rule
 *     CardService.setIdOf relies on), then prices.
 *   - refreshPrices: GET /{category}/sets/{id}/skus → per printing, per
 *     condition market prices. The game's print_preference picks which
 *     printing is the card's default price (card_prices); every printing
 *     is also saved in card_variant_prices so owned copies of a specific
 *     print ("NM · foil") are valued correctly.
 *
 * USED BY: CardService
 * DEPENDS ON: CardRepository, TCGTracking (free, no key)
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.CardRepository
import zio.*
import zio.json.*
import zio.json.ast.Json
import java.time.LocalDate

trait TcgTrackingCatalog:
  /** Downloads the game's set list and saves it. @return sets saved. */
  def syncSets(game: Game): Task[Int]
  /** Downloads a set's cards and prices. */
  def importSet(game: Game, setId: String): Task[Unit]
  /** Re-prices a set's already-imported cards. */
  def refreshPrices(game: Game, setId: String): Task[Unit]

object TcgTrackingCatalog:

  private val Base = "https://tcgtracking.com/tcgapi/v1"

  private case class TtSet(
    id: Int, name: String, abbreviation: Option[String],
    @jsonField("published_on") publishedOn: Option[String],
    @jsonField("product_count") productCount: Option[Int],
    @jsonField("set_symbol_url") symbolUrl: Option[String]
  )
  private given JsonDecoder[TtSet] = DeriveJsonDecoder.gen
  private case class TtSets(sets: List[TtSet])
  private given JsonDecoder[TtSets] = DeriveJsonDecoder.gen

  private case class TtProduct(id: Int, name: String, number: Option[String], rarity: Option[String], imageUrl: Option[String],
                               cardmarketId: Option[Int])
  // `number` arrives as text, a raw number, or not at all — decoded by hand.
  private given JsonDecoder[TtProduct] = JsonDecoder[Json].mapOrFail { json =>
    json.asObject.toRight("product must be an object").flatMap { o =>
      def str(k: String) = o.get(k).flatMap {
        case Json.Str(s) => Some(s)
        case Json.Num(n) => Some(n.toString)
        case _           => None
      }
      def int(k: String) = o.get(k).flatMap(_.asNumber).flatMap(n => scala.util.Try(n.value.intValueExact).toOption)
      for
        id   <- int("id").toRight("product id")
        name <- str("name").toRight("product name")
      yield TtProduct(id, name, str("number"), str("rarity"), str("image_url"), int("cardmarket_id"))
    }
  }
  private case class TtProducts(products: List[TtProduct])
  private given JsonDecoder[TtProducts] = DeriveJsonDecoder.gen

  private[service] case class TtSku(
    @jsonField("cnd") condition: Option[String],
    @jsonField("var") printing:  Option[String],
    @jsonField("lng") language:  Option[String],
    @jsonField("mkt") market:    Option[Double]
  )
  private given JsonDecoder[TtSku] = DeriveJsonDecoder.gen
  private case class TtSkus(products: Map[String, Map[String, TtSku]])
  private given JsonDecoder[TtSkus] = DeriveJsonDecoder.gen

  /** Our set id for a TCGTracking set. */
  def setId(game: Game, tcgSetId: Int): String = s"tt${game.category}-$tcgSetId"

  /** "006/103" → "006"; "LOB-EN001" stays as is. */
  private[service] def collectorNumber(raw: Option[String]): String =
    raw.map(_.split("/").head.trim).filter(_.nonEmpty).getOrElse("")

  /** "Moltres - 006/103" → "Moltres" (TCGTracking appends the number to disambiguate names). */
  private[service] def cleanName(name: String, number: Option[String]): String =
    number.map(n => name.stripSuffix(s" - $n").trim).getOrElse(name)

  /** TCGTracking printing name → our print key, matching the English Pokémon keys where they overlap. */
  private[service] def printKey(printing: String): String = printing.trim match
    case "Normal"           => "normal"
    case "Holofoil"         => "holo"
    case "Reverse Holofoil" => "reverse"
    case other              => other.toLowerCase.replaceAll("[^a-z0-9]+", "-").stripPrefix("-").stripSuffix("-")

  private def pricesOf(skus: Iterable[TtSku]): CardPrices =
    def at(c: String) = skus.filter(_.condition.contains(c)).flatMap(_.market).filter(_ > 0).maxOption
    CardPrices(at("NM"), at("LP"), at("MP"), at("HP"), at("DMG"))

  /** Per printing prices for one product, and which printing is the default. */
  private[service] def pricing(game: Game, skus: Iterable[TtSku]): Option[(CardPrices, Map[String, CardPrices])] =
    // Prefer English SKUs when a product lists several languages; games
    // with one language (e.g. Pokémon Japan, all "JP") use everything.
    val langs = skus.flatMap(_.language).toSet
    val pool  = if langs.contains("EN") && langs.size > 1 then skus.filter(_.language.contains("EN")) else skus
    val byPrint = pool.groupBy(_.printing.getOrElse("Normal")).view.mapValues(pricesOf).toMap
      .filter { case (_, p) => p.nm.orElse(p.lp).orElse(p.mp).orElse(p.hp).orElse(p.dmg).isDefined }
    if byPrint.isEmpty then None
    else
      val default = game.printPreference.find(byPrint.contains).getOrElse(byPrint.keys.toList.sorted.head)
      Some((byPrint(default), byPrint.map { case (k, v) => printKey(k) -> v }))

  /** A fallback price is NM-based; other conditions follow typical market
   *  discounts so an LP/MP/... copy still gets a value. */
  private val CondFactors = (0.85, 0.70, 0.50, 0.35)
  private def round2(d: Double) = math.max(0.01, math.round(d * 100) / 100.0)
  private[service] def fromNm(nm: Double): CardPrices =
    val (lp, mp, hp, dmg) = CondFactors
    CardPrices(Some(round2(nm)), Some(round2(nm * lp)), Some(round2(nm * mp)), Some(round2(nm * hp)), Some(round2(nm * dmg)))

  private def median(xs: List[Double]): Option[Double] =
    xs.sorted match
      case Nil => None
      case s   => Some(if s.size % 2 == 1 then s(s.size / 2) else (s(s.size / 2 - 1) + s(s.size / 2)) / 2)

  /**
   * Every card in a set gets a price:
   *   1. TCGplayer market price (`tcg`) — source None.
   *   2. Cardmarket's price guide (EUR), scaled to the TCGplayer level by the
   *      median TCGplayer/Cardmarket ratio of this set's cards that have
   *      both AND are of similar value (Cardmarket price within 3x either
   *      way; needs 5+ such cards; kept within 0.8–2x). Bulk cards can't
   *      set the ratio for valuable ones: TCGplayer's ~$0.25 floor vs
   *      Cardmarket's €0.05 commons is a 4-5x gap that would wildly inflate
   *      a €500 card. Otherwise plain EUR→USD 1.1 — source "cardmarket".
   *   3. An estimate from similar cards in the set: the median TCGplayer NM
   *      price of cards with the same rarity (3+ of them), else the set's
   *      25th-percentile price — source "estimate".
   * Cards in a set with no TCGplayer or Cardmarket price at all (e.g. not
   * released yet) stay unpriced — there's nothing to estimate from.
   *
   * @param cards (cardId, rarity, Cardmarket product id)
   */
  private[service] def fillGaps(
    cards: List[(String, Option[String], Option[Int])],
    tcg:   Map[String, (CardPrices, Map[String, CardPrices])],
    cm:    Map[Int, Double]
  ): List[(String, CardPrices, Map[String, CardPrices], Option[String])] =
    val tcgNm = tcg.view.mapValues(_._1.nm).collect { case (k, Some(v)) => k -> v }.toMap
    // (Cardmarket EUR, TCGplayer USD) for cards priced on both.
    val pairs = cards.flatMap { case (id, _, cmId) => for t <- tcgNm.get(id); c <- cmId.flatMap(cm.get) yield (c, t) }
    def ratioFor(eur: Double): Double =
      val similar = pairs.collect { case (c, t) if c >= eur / 3 && c <= eur * 3 => t / c }
      if similar.size >= 5 then median(similar).map(r => math.min(2.0, math.max(0.8, r))).getOrElse(1.1) else 1.1
    val nmByRarity = cards.flatMap { case (id, rar, _) => tcgNm.get(id).map(rar.getOrElse("") -> _) }.groupMap(_._1)(_._2)
    val setLowQuartile = tcgNm.values.toList.sorted match
      case Nil => None
      case s   => Some(s((s.size - 1) / 4))
    cards.flatMap { case (id, rarity, cmId) =>
      tcg.get(id) match
        case Some((d, v)) if d.nm.isDefined => Some((id, d, v, None))
        case known =>
          val variants = known.map(_._2).getOrElse(Map.empty)
          cmId.flatMap(cm.get).map(eur => (id, fromNm(eur * ratioFor(eur)), variants, Some("cardmarket")))
            .orElse {
              val similar = nmByRarity.getOrElse(rarity.getOrElse(""), Nil)
              val est = if similar.size >= 3 then median(similar) else setLowQuartile
              est.map(nm => (id, fromNm(nm), variants, Some("estimate")))
            }
            // Partial TCGplayer data (no NM but e.g. an LP price) beats nothing.
            .orElse(known.map { case (d, v) => (id, d, v, None) })
    }

  final class Live(repo: CardRepository, cardmarket: CardmarketGuide) extends TcgTrackingCatalog:

    /** GET with a small retry — TCGTracking is free and usually fast; a
     *  couple of retries covers a blip without hammering it. */
    private def get(url: String): Task[String] =
      def attempt(n: Int): Task[String] =
        ZIO.attemptBlocking {
          val conn = java.net.URI.create(url).toURL.openConnection()
          conn.setRequestProperty("User-Agent", "CardStacks/1.0")
          conn.setConnectTimeout(15000)
          conn.setReadTimeout(60000)
          val in = conn.getInputStream
          try new String(in.readAllBytes(), "UTF-8") finally in.close()
        }.catchAll { e =>
          if n < 3 then ZIO.sleep(zio.Duration.fromSeconds(2L * n)) *> attempt(n + 1)
          else ZIO.fail(RuntimeException(s"GET $url failed: ${e.getMessage}"))
        }
      attempt(1)

    private def parse[A: JsonDecoder](body: String): Task[A] =
      ZIO.fromEither(body.fromJson[A]).mapError(e => RuntimeException(s"TCGTracking JSON: $e"))

    def syncSets(game: Game): Task[Int] =
      for
        resp <- get(s"$Base/${game.category}/sets").flatMap(parse[TtSets])
        sets  = resp.sets.filter(_.productCount.forall(_ > 0))
        _    <- repo.upsertSets(sets.map { s =>
                  val date = s.publishedOn.flatMap(d => scala.util.Try(LocalDate.parse(d.take(10))).toOption)
                               .getOrElse(LocalDate.of(2000, 1, 1))
                  val count = s.productCount.getOrElse(0)
                  val symbol = s.symbolUrl.getOrElse("")
                  (CardSet(setId(game, s.id), s.name, date.getYear.toString, count, count, date,
                           SetImages(symbol, symbol), s.abbreviation), Some(s.id.toString))
                }, game.id)
      yield sets.size

    def importSet(game: Game, ourSetId: String): Task[Unit] =
      for
        ext   <- repo.findExternalSetId(ourSetId).someOrFail(RuntimeException(s"Set $ourSetId has no TCGTracking id"))
        resp  <- get(s"$Base/${game.category}/sets/$ext/cards").flatMap(parse[TtProducts])
        _     <- repo.upsertCards(resp.products.map { p =>
                   val small = p.imageUrl.getOrElse("")
                   Card(
                     id     = s"$ourSetId-${p.id}",
                     setId  = ourSetId,
                     name   = cleanName(p.name, p.number),
                     number = collectorNumber(p.number),
                     rarity = p.rarity.filterNot(r => r.isBlank || r == "None"),
                     artist = None,
                     images = CardImage(small, small.replace("_200w", "_800w")),
                     prices = None,
                     details = None
                   ) -> p.cardmarketId
                 })
        _     <- refreshPrices(game, ourSetId)
      yield ()

    /** The set's cards with rarity and Cardmarket id. Sets imported before
     *  Cardmarket ids were stored get them filled from TCGTracking once. */
    private def cardmarketInputs(game: Game, ourSetId: String, ext: String): Task[List[(String, Option[String], Option[Int])]] =
      repo.pricingInputs(ourSetId).flatMap { inputs =>
        if inputs.isEmpty || inputs.exists(_._3.isDefined) || game.cardmarketGame.isEmpty then ZIO.succeed(inputs)
        else
          for
            resp <- get(s"$Base/${game.category}/sets/$ext/cards").flatMap(parse[TtProducts])
            ids   = resp.products.flatMap(p => p.cardmarketId.map(s"$ourSetId-${p.id}" -> _))
            _    <- repo.setCardmarketIds(ids)
            back <- repo.pricingInputs(ourSetId)
          yield back
      }

    def refreshPrices(game: Game, ourSetId: String): Task[Unit] =
      for
        ext  <- repo.findExternalSetId(ourSetId).someOrFail(RuntimeException(s"Set $ourSetId has no TCGTracking id"))
        resp <- get(s"$Base/${game.category}/sets/$ext/skus").flatMap(parse[TtSkus])
        inputs <- cardmarketInputs(game, ourSetId, ext)
        known  = inputs.map(_._1).toSet
        // Only price cards we imported (skus also cover sealed products).
        tcg    = resp.products.toList.flatMap { case (productId, skus) =>
                   val cardId = s"$ourSetId-$productId"
                   if !known(cardId) then None
                   else pricing(game, skus.values).map(cardId -> _)
                 }.toMap
        cm    <- game.cardmarketGame.fold(ZIO.succeed(Map.empty[Int, Double]))(cardmarket.prices)
        _     <- repo.upsertPriceBatch(fillGaps(inputs, tcg, cm))
        _    <- repo.markPricesFetched(ourSetId)
      yield ()

  val layer: ZLayer[CardRepository & CardmarketGuide, Nothing, TcgTrackingCatalog] =
    ZLayer.fromFunction(new Live(_, _))
