/**
 * FILE: PriceService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/PriceService.scala
 *
 * PURPOSE:
 *   Fetches per-condition card prices from TCGTracking and stores them
 *   in the card_prices table. Called when a set's cards are loaded and
 *   when prices need refreshing.
 *
 * WHY TCGTRACKING?
 *   TCGTracking (tcgtracking.com) is free, requires no API key, has no
 *   rate limits, and provides per-condition prices (NM, LP, MP, HP, DMG)
 *   at the SKU level — exactly what we need. Data updates daily at 8 AM EST.
 *
 * HOW TCGTRACKING WORKS:
 *   The API is organized by game category. Pokemon = category 3.
 *   Each set in TCGTracking has a numeric ID (different from pokemontcg.io IDs).
 *   We match sets by name/abbreviation using the search endpoint.
 *   Once we have the TCGTracking set ID, we fetch SKU prices for the whole set.
 *   SKUs contain: product ID, condition (NM/LP/MP/HP/DMG), finish, price.
 *   We match TCGTracking products to our cards by collector number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.models.{CardPrices, CardSet}
 *     CardPrices — the per-condition price model we write to the database.
 *     CardSet    — used to match our sets to TCGTracking sets by ptcgoCode/name.
 *
 *   com.poketracker.repository.CardRepository
 *     Used to save prices to the card_prices table after fetching.
 *
 *   zio.* / zio.json.*
 *     Standard ZIO and JSON imports.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: CardService (called after fetching cards for a set)
 * DEPENDS ON: CardRepository, TCGTracking API (no key required)
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.CardRepository
import zio.*
import zio.json.*
import zio.json.ast.Json

/**
 * TRAIT: PriceService
 * PURPOSE: Interface for fetching and storing card prices.
 */
trait PriceService:

  /**
   * METHOD: fetchAndStorePrices
   * PURPOSE: Fetches per-condition prices for all cards in a set from
   *          TCGTracking and stores them in the card_prices table.
   *          Called after loading cards for a set.
   *
   * @param set    The CardSet to fetch prices for.
   *               We use ptcgoCode and name to find the matching TCGTracking set.
   * @param cards  The cards in the set — we match prices to cards by number.
   * @return       Unit. Failures are logged but not propagated — missing prices
   *               are acceptable, the app works without them.
   */
  def fetchAndStorePrices(set: CardSet, cards: List[Card]): Task[Unit]

/**
 * OBJECT: PriceService
 * PURPOSE: Live implementation and ZLayer.
 */
object PriceService:

  // ── TCGTracking response types ──────────────────────────────────────────────
  // These match the JSON shape of the TCGTracking SKU endpoint response.
  // Private to this file — never exposed outside PriceService.

  /**
   * CASE CLASS: TcgSku
   * PURPOSE: One SKU from TCGTracking — a specific card in a specific condition.
   *
   * TCGTracking uses compact field names in the SKU response:
   *   cnd = condition
   *   var = printing / variant
   *   lng = language
   *   mkt = market price
   *
   * @param condition  Condition string: "NM", "LP", "MP", "HP", "DMG", or "UNO" (ungraded)
   * @param printing   The card finish: "Normal", "Reverse Holofoil", "Holofoil", etc.
   * @param language   Language: "EN", "JP" etc. We only use EN prices.
   * @param market     Market price in USD. None if no price data available.
   */
  private case class TcgSku(
    @jsonField("cnd") condition: String,
    @jsonField("var") printing:  String,
    @jsonField("lng") language:  String,
    @jsonField("mkt") market:    Option[Double]
  )
  private given JsonDecoder[TcgSku] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgSkuResponse
   * PURPOSE: Wrapper around the TCGTracking SKU endpoint response.
   * HOW THE RESPONSE IS SHAPED:
   *   TCGTracking nests SKUs by product ID and then SKU ID:
   *     products -> productId -> skuId -> sku
   *
   *   Product IDs are JSON object keys, so they arrive as strings. We convert
   *   them to Int later when building the lookup map.
   *
   * @param products  Product ID -> SKU ID -> SKU data
   */
  private case class TcgSkuResponse(
    products: Map[String, Map[String, TcgSku]],
    @jsonField("sku_count") skuCount: Option[Int]
  )
  private given JsonDecoder[TcgSkuResponse] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgProduct
   * PURPOSE: One product (card) from TCGTracking's product list for a set.
   *
   * @param id      TCGTracking's numeric product ID
   * @param number  Collector number — used to match to our Card records
   * @param name    Card name — used as fallback match if number doesn't work
   */
  // number field can be Int, String, or null in TCGTracking API
  // We parse the whole product as a Map to handle this inconsistency
  // number is a String like "161/162" — we take the part before "/" to get collector number
  private case class TcgProduct(id: Int, name: String, number: Option[String])

  private given JsonDecoder[TcgProduct] = JsonDecoder[Json].mapOrFail { json =>
    json.asObject.toRight("TcgProduct must be an object").flatMap { obj =>
      def jsonToInt(value: Json): Either[String, Int] =
        value.asNumber
          .flatMap(num => scala.util.Try(num.toString.toInt).toOption)
          .toRight("id must be an integer")

      for
        idJson   <- obj.get("id").toRight("Missing id field")
        id       <- jsonToInt(idJson)
        nameJson <- obj.get("name").toRight("Missing name field")
        name     <- nameJson.asString.toRight("name must be a string")
      yield
        val number = obj.get("number").flatMap {
          case Json.Str(s) => Some(s)
          case Json.Num(n) => scala.util.Try(n.toString.toInt).toOption.map(_.toString)
          case _           => None
        }
        TcgProduct(id, name, number)
    }
  }

  /**
   * CASE CLASS: TcgProductResponse
   * PURPOSE: Wrapper around the TCGTracking products endpoint response.
   * @param products      List of all products in the set
   * @param productCount  TCGTracking's own claimed total for this set — used
   *                      to detect a truncated response (see fetchProducts).
   */
  private case class TcgProductResponse(
    products: List[TcgProduct],
    @jsonField("product_count") productCount: Option[Int]
  )
  private given JsonDecoder[TcgProductResponse] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgSetResult
   * PURPOSE: One set result from TCGTracking's search endpoint.
   * @param id           TCGTracking's numeric set ID — used to build product/SKU URLs
   * @param name         Set name
   * @param abbreviation Set abbreviation e.g. "SVI" — matches our ptcgoCode
   */
  private case class TcgSetResult(
    id:           Int,
    name:         String,
    abbreviation: Option[String],
    @jsonField("product_count") productCount: Option[Int],
    @jsonField("published_on") publishedOn: Option[String]
  )
  private given JsonDecoder[TcgSetResult] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgSearchResponse
   * PURPOSE: Wrapper around the TCGTracking search endpoint response.
   * @param sets  Matching sets
   */
  private case class TcgSearchResponse(sets: List[TcgSetResult])
  private given JsonDecoder[TcgSearchResponse] = DeriveJsonDecoder.gen

  // Pokemon category ID in TCGTracking
  private val POKEMON_CAT = 3
  private val BASE        = "https://tcgtracking.com/tcgapi/v1"

  /**
   * CLASS: Live
   * PURPOSE: The real PriceService implementation.
   * @param repo  CardRepository — used to save prices after fetching
   */
  private final class Live(repo: CardRepository, setsCache: Ref[Option[(Long, List[TcgSetResult])]]) extends PriceService:

    /**
     * METHOD: get
     * PURPOSE: HTTP GET — returns response body as String.
     * @param url  The URL to fetch
     * @return     Response body, or fails with a descriptive message
     */
    /**
     * Retries/backs off for TCGTracking's transient failures (500s, timeouts,
     * empty-but-200 bodies) — the same failure pattern pokemontcg.io has.
     * Without this, one blip anywhere in a set's products/skus fetch aborted
     * price-fetching for the whole set, leaving every card in it "no price"
     * with no automatic recovery until the next 6-hour stale window.
     */
    private def get(url: String): Task[String] =
      val maxAttempts = 5
      def attempt(n: Int): Task[String] =
        ZIO.attemptBlocking {
          val conn = java.net.URI.create(url).toURL.openConnection()
          conn.setConnectTimeout(10000)
          conn.setReadTimeout(30000)
          val stream = conn.getInputStream
          try new String(stream.readAllBytes()) finally stream.close()
        }.mapError(e => RuntimeException(s"GET $url failed: ${e.getMessage}"))
          .flatMap { body =>
            if body.trim.isEmpty
            then ZIO.fail(RuntimeException(s"GET $url returned an empty body"))
            else ZIO.succeed(body)
          }
          .catchAll { e =>
            if n < maxAttempts
            then ZIO.sleep(zio.Duration.fromSeconds(1L << (n - 1))) *> attempt(n + 1)
            else ZIO.fail(RuntimeException(s"GET $url failed after $maxAttempts attempts: ${e.getMessage}"))
          }
      attempt(1)

    /**
     * METHOD: parse
     * PURPOSE: Parses a JSON string into a typed value.
     * @tparam A  The type to parse into
     * @param json  The JSON string
     * @return      Parsed value or fails with a parse error message
     */
    private def parse[A: JsonDecoder](json: String): Task[A] =
      ZIO.fromEither(json.fromJson[A])
         .mapError(e => RuntimeException(s"JSON parse error: $e"))

    /**
     * METHOD: fetchProducts
     * PURPOSE: Fetches a set's product list from TCGTracking, retrying with a
     *          cache-busting query param if the response looks stale/short.
     *
     * WHY COMPARE AGAINST expectedCards, NOT THE RESPONSE'S OWN product_count:
     *   The first version of this check compared `products.size` against the
     *   SAME response's `product_count` field and never fired. Confirmed live
     *   why: the bad response isn't a partial/cut-off transfer of the current
     *   232-product set — it's Cloudflare serving an entire OLDER cached
     *   snapshot from back when TCGTracking had only indexed 52 products for
     *   this set, so `product_count` inside that stale snapshot is ALSO 52,
     *   internally consistent with itself. No self-check can catch a snapshot
     *   that agrees with itself. Our own card count (from pokemontcg.io, a
     *   completely different, unaffected source) is the only independent
     *   reference available, so retry against that instead.
     * @param expectedCards  Our own card count for this set — the retry
     *                       threshold is deliberately loose (60%) since
     *                       TCGTracking's real product list legitimately
     *                       includes non-card products (sealed, code cards)
     *                       and can differ from our count for other reasons.
     */
    private def fetchProducts(tcgSetId: Int, setName: String, expectedCards: Int): Task[TcgProductResponse] =
      val maxAttempts = 3
      def attempt(n: Int): Task[TcgProductResponse] =
        // Use the dedicated /cards endpoint, not the bare /sets/{id} endpoint:
        // confirmed live that for at least one set (Battle Styles), /sets/{id}
        // consistently served a stale, far-smaller product list from
        // Railway's network path — even three cache-busted retries with
        // distinct query params all came back with the same short list,
        // while /sets/{id}/cards returned the complete, correct list every
        // time and carries a much fresher Cloudflare cache (hours old, not
        // days). Keeping the cache-bust param on retries as a second line of
        // defense in case this endpoint ever goes stale too.
        val url =
          if n == 1 then s"$BASE/$POKEMON_CAT/sets/$tcgSetId/cards"
          else s"$BASE/$POKEMON_CAT/sets/$tcgSetId/cards?_cb=${java.lang.System.currentTimeMillis()}"
        get(url)
          .flatMap { json =>
            parse[TcgProductResponse](json)
              .tapError(e => ZIO.logWarning(
                s"TCGTracking: failed to parse products for '$setName': $e | " +
                s"body (first 300 chars): ${json.take(300)}"
              ))
          }
          .flatMap { resp =>
            val numbered = resp.products.count(_.number.isDefined)
            if numbered < (expectedCards * 0.6).toInt && n < maxAttempts then
              ZIO.logWarning(
                s"TCGTracking: '$setName' products response looks stale " +
                s"($numbered numbered / $expectedCards expected) — retrying with cache-bust ($n/$maxAttempts)"
              ) *> ZIO.sleep(zio.Duration.fromSeconds(2L)) *> attempt(n + 1)
            else ZIO.succeed(resp)
          }
      attempt(1)

    /**
     * METHOD: fetchSkus
     * PURPOSE: Fetches a set's SKU/price data from TCGTracking, retrying with
     *          a cache-busting query param if the response looks stale/short.
     *          Same stale-Cloudflare-edge-cache risk as fetchProducts — see
     *          its doc comment. Validated against the ALREADY-FETCHED product
     *          list's own count (an independent, same-request reference)
     *          rather than this response's own claimed sku_count, since a
     *          stale cached snapshot agrees with itself.
     * @param expectedProducts  Number of products fetchProducts just returned
     *                          for this set — used as the staleness reference.
     */
    private def fetchSkus(tcgSetId: Int, setName: String, expectedProducts: Int): Task[TcgSkuResponse] =
      val maxAttempts = 3
      def attempt(n: Int): Task[TcgSkuResponse] =
        val url =
          if n == 1 then s"$BASE/$POKEMON_CAT/sets/$tcgSetId/skus"
          else s"$BASE/$POKEMON_CAT/sets/$tcgSetId/skus?_cb=${java.lang.System.currentTimeMillis()}"
        get(url)
          .flatMap { json =>
            parse[TcgSkuResponse](json)
              .tapError(e => ZIO.logWarning(
                s"TCGTracking: failed to parse SKUs for '$setName': $e | " +
                s"body (first 300 chars): ${json.take(300)}"
              ))
          }
          .flatMap { resp =>
            val pricedProducts = resp.products.size
            if pricedProducts < (expectedProducts * 0.6).toInt && n < maxAttempts then
              ZIO.logWarning(
                s"TCGTracking: '$setName' SKU response looks stale " +
                s"($pricedProducts products / $expectedProducts expected) — retrying with cache-bust ($n/$maxAttempts)"
              ) *> ZIO.sleep(zio.Duration.fromSeconds(2L)) *> attempt(n + 1)
            else ZIO.succeed(resp)
          }
      attempt(1)

    /**
     * METHOD: normalizeCollectorNumber
     * PURPOSE: Converts collector numbers from both APIs into the same shape
     *          before matching cards to TCGTracking products.
     *
     * WHY THIS IS NEEDED:
     *   pokemontcg.io can return numbers with leading zeroes, like "001".
     *   TCGTracking usually returns numbers as "1/198". Without normalization,
     *   cards 001-099 never match and therefore never receive prices.
     *
     * HOW IT WORKS:
     *   1. Take only the part before "/" for TCGTracking numbers
     *   2. Trim spaces
     *   3. If the number is purely numeric, remove leading zeroes
     *   4. Leave non-numeric promo numbers like "SWSH001" unchanged
     *
     * @param number  Collector number from either API
     * @return        Normalized collector number used for matching
     */
    private def normalizeCollectorNumber(number: String): String =
      val base = number.split("/").head.trim
      base.toIntOption.map(_.toString).getOrElse(base)

    /**
     * METHOD: allTcgSets
     * PURPOSE: Fetches TCGTracking's full Pokémon set catalog (~280 sets, one
     *          call) and caches it in memory for an hour.
     *
     * WHY NOT THE PER-QUERY SEARCH ENDPOINT:
     *   TCGTracking's `/search?q=` endpoint does a near-literal substring
     *   match against its stored set name, not a fuzzy/tokenized search.
     *   Confirmed live: searching the FULL text of our own set names (e.g.
     *   "SM Black Star Promos", "Shining Fates Shiny Vault", the exact string
     *   we'd naturally send) returns ZERO results for dozens of sets, because
     *   words like "Black Star" or "Collection" never appear verbatim in
     *   TCGTracking's name ("SM Promos", "McDonald's Promos 2019"). This was
     *   the root cause of ~60 sets (the entire Sun & Moon era, most Black Star
     *   Promo sets, McDonald's collections, trainer kits) having 0% price
     *   coverage — not a matching bug, but zero candidates to match against.
     *   Fetching the whole catalog once and matching client-side sidesteps
     *   their search entirely.
     */
    private def allTcgSets: Task[List[TcgSetResult]] =
      val ttlMs = 60 * 60 * 1000L
      setsCache.get.flatMap {
        case Some((fetchedAt, sets)) if java.lang.System.currentTimeMillis() - fetchedAt < ttlMs =>
          ZIO.succeed(sets)
        case _ =>
          get(s"$BASE/$POKEMON_CAT/sets")
            .flatMap(json => parse[TcgSearchResponse](json).map(_.sets))
            .tap(sets => setsCache.set(Some((java.lang.System.currentTimeMillis(), sets))))
            .catchAll { e =>
              ZIO.logWarning(s"TCGTracking: failed to fetch full set catalog: ${e.getMessage}") *>
              ZIO.succeed(List.empty[TcgSetResult])
            }
      }

    /**
     * METHOD: findTcgSetId
     * PURPOSE: Finds the TCGTracking numeric set ID for a given CardSet by
     *          matching against the cached full catalog. Returns None if no
     *          confident match found — this is normal for sets TCGTracking
     *          genuinely doesn't track (e.g. some promo "sets").
     *
     * MATCHING TIERS (first match wins):
     *   1. Abbreviation equals our ptcgoCode.
     *   2. Exact name match (punctuation/spacing-insensitive).
     *   3. Exact match after stripping a TCGTracking "CODE: " prefix
     *      (e.g. "SWSH04: Vivid Voltage").
     *   4. Token containment: normalize both names into word sets (folding
     *      accents, dropping "star"/"pokemon" noise words, singularizing
     *      plurals) and require our set's tokens be mostly covered by the
     *      candidate's — handles the many extra tiers TCGTracking wraps
     *      around a real name: "SM - Cosmic Eclipse", "EX Team Rocket
     *      Returns", "SWSH01: Sword & Shield Base Set". Ties are broken by
     *      whichever candidate's product count is closest to our own card
     *      total, then by the shortest (least noisy) candidate name.
     *
     * @param set  The CardSet to find in TCGTracking
     * @return     Some(tcgSetId) if found, None if not
     */
    private def findTcgSetId(set: CardSet): Task[Option[Int]] =
      val norm = (s: String) => s.toLowerCase.replaceAll("[^a-z0-9]", "")

      def foldAccents(s: String): String =
        java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFKD).replaceAll("\\p{M}", "")

      val stopWords = Set("star", "pokemon")
      def stem(t: String): String =
        if t.length > 3 && t.endsWith("s") then t.dropRight(1) else t
      def tokens(s: String): Set[String] =
        foldAccents(s).toLowerCase.split("[^a-z0-9]+").iterator
          .filter(_.nonEmpty).map(stem).filterNot(stopWords.contains).toSet

      // TCGTracking spells out a couple of retro eras instead of using the
      // abbreviation our own set names carry ("Black and White Promos" vs.
      // our "BW Black Star Promos"). Expanding the CANDIDATE's tokens with
      // the abbreviation (only when both spelled-out words are present) lets
      // these line up. Deliberately limited to eras confirmed to have no
      // other numbered set sharing the same spelled-out words — unlike SM or
      // SWSH, where TCGTracking's own names already carry the bare
      // abbreviation, so expanding it would tie every "SM 0X" set together.
      val eraAliases = Map("bw" -> Set("black", "white"), "dp" -> Set("diamond", "pearl"))
      def expandCandidateTokens(toks: Set[String]): Set[String] =
        eraAliases.foldLeft(toks) { case (acc, (abbr, spelled)) =>
          if spelled.subsetOf(toks) then acc + abbr else acc
        }

      def stripTcgPrefix(name: String): String =
        name.split(":", 2) match
          case Array(_, rest) => rest.trim
          case _              => name

      // Bonus subsets (Trainer/Galarian Gallery, Shiny Vault) are usually given
      // the SAME ptcgoCode as their parent set by pokemontcg.io (e.g. Crown
      // Zenith and Crown Zenith Galarian Gallery both carry "CRZ"), but
      // TCGTracking lists them as a separate suffixed entry next to the
      // parent's bare abbreviation ("CRZ" vs. "CRZ:GG", "HIF" vs. "HIF:SV").
      // Trusting an abbreviation match here would silently attach the
      // PARENT set's prices to every card in the subset. Confirmed live:
      // Crown Zenith Galarian Gallery and both Shiny Vault sets matched the
      // parent set via ptcgoCode and then had 0 cards line up by number,
      // even though TCGTracking has full price data for the actual subset.
      val isBonusSubset = Set("vault", "gallery").exists(kw => set.name.toLowerCase.contains(kw))

      def exactMatch(candidates: List[TcgSetResult]): Option[TcgSetResult] =
        (if isBonusSubset then None
         else candidates.find(s => s.abbreviation.exists(a => set.ptcgoCode.exists(c => norm(a) == norm(c)))))
          .orElse(candidates.find(s => norm(s.name) == norm(set.name)))
          .orElse(candidates.find(s => norm(stripTcgPrefix(s.name)) == norm(set.name)))

      def bestFuzzyMatch(candidates: List[TcgSetResult]): Option[TcgSetResult] =
        val ourTokens = tokens(set.name)
        if ourTokens.isEmpty then None
        else
          candidates
            .map(c => (c, expandCandidateTokens(tokens(c.name))))
            .map { case (c, candTokens) => (c, candTokens, ourTokens.intersect(candTokens).size.toDouble / ourTokens.size) }
            .filter(_._3 >= 0.6)
            .sortBy { case (c, candTokens, ratio) => (-ratio, math.abs(c.productCount.getOrElse(0) - set.total), candTokens.size) }
            .headOption
            .map(_._1)

      // Last resort before giving up: an exact release-date match. Catches
      // sets TCGTracking names so bare that no name-token overlap is
      // possible — e.g. our "Sun & Moon" base set has NO name-token match
      // against TCGTracking's "SM Base Set" (no "sun"/"moon" in either
      // direction), and a bare "sm" abbreviation would tie against every
      // other "SM 0X" set. Confirmed unique: no two TCGTracking sets share
      // a release date, so an exact match here is unambiguous.
      def dateMatch(candidates: List[TcgSetResult]): Option[TcgSetResult] =
        candidates.find(c => c.publishedOn.contains(set.releaseDate.toString))

      allTcgSets.flatMap { candidates =>
        exactMatch(candidates).orElse(dateMatch(candidates)).orElse(bestFuzzyMatch(candidates)) match
          case Some(m) => ZIO.succeed(Some(m.id))
          case None =>
            ZIO.logInfo(
              s"TCGTracking: no match for '${set.name}' (code: ${set.ptcgoCode.getOrElse("none")}) " +
              s"among ${candidates.size} cached TCGTracking sets"
            ).as(None)
      }

    /**
     * METHOD: fetchAndStorePrices
     * PURPOSE: Main entry point. Finds the set in TCGTracking, fetches SKU prices,
     *          matches them to our cards by collector number, and saves to the DB.
     *
     *          The matching process:
     *            1. Find TCGTracking set ID from ptcgoCode or name
     *            2. Fetch all products for the set (gives us number → productId mapping)
     *            3. Fetch all SKUs for the set (gives us productId → condition prices)
     *            4. For each of our cards, find matching product by number
     *            5. Build CardPrices from the SKUs for that product
     *            6. Save to card_prices table
     *
     * @param set    The set to fetch prices for
     * @param cards  Cards in the set
     * @return       Unit — price failures are logged, not propagated
     */
    def fetchAndStorePrices(set: CardSet, cards: List[Card]): Task[Unit] =
      findTcgSetId(set).flatMap {
        case None =>
          ZIO.logInfo(s"TCGTracking: skipping prices for '${set.name}' — no set match found")

        case Some(tcgSetId) =>
          for
            products     <- fetchProducts(tcgSetId, set.name, cards.size)
            skuResp      <- fetchSkus(tcgSetId, set.name, products.products.size)

            pricesByProductId = buildPriceMap(skuResp.products)

            // A collector number can map to MORE THAN ONE TCGTracking product —
            // e.g. Poké Ball/Master Ball Pattern variants are separate products
            // sharing the base card's number, and some sets list more than one
            // product for the same number for other reasons. A plain .toMap here
            // silently kept only the last one TCGTracking listed, which could be
            // an unpriced product while a sibling product for the SAME card had
            // real price data — a card could genuinely have a TCGTracking price
            // and still show "no price" here. Keep every candidate product per
            // number and use the first one that actually has a price.
            numberToProductIds = products.products
                                    .flatMap(p => p.number.map(n => normalizeCollectorNumber(n) -> p.id))
                                    .groupMap(_._1)(_._2)

            _ <- ZIO.logInfo(
                   s"TCGTracking: '${set.name}' — ${products.products.size} products, " +
                   s"${pricesByProductId.size} with prices, ${numberToProductIds.size} distinct numbers"
                 )

            saved <- ZIO.foreach(cards) { card =>
                       numberToProductIds.getOrElse(normalizeCollectorNumber(card.number), Nil)
                         .flatMap(pricesByProductId.get)
                         .headOption match
                         case Some(prices) => repo.upsertPrices(card.id, prices).as(true)
                         case None         => ZIO.succeed(false)
                     }

            matched = saved.count(identity)
            // Log matched count; if any unmatched, append a sample so we can spot number-format mismatches
            unmatchedSample = {
                                if matched < cards.size then
                                  val names = cards.zip(saved)
                                                .collect { case (c, false) => s"${c.name}(${c.number})" }
                                  s"; unmatched: ${names.take(10).mkString(", ")}" +
                                  (if names.size > 10 then s" …+${names.size - 10} more" else "")
                                else ""
                              }
            _ <- ZIO.logInfo(
                   s"TCGTracking: '${set.name}' — $matched/${cards.size} cards matched to prices$unmatchedSample"
                 )
          yield ()
      }

    /**
     * METHOD: buildPriceMap
     * PURPOSE: Groups SKUs by productId and extracts NM/LP/MP/HP/DMG prices.
     *          A product can have multiple SKUs (Normal, Holofoil, 1st Edition etc).
     *          We prefer Holofoil prices for holo cards, Normal for non-holo.
     *          If both exist, we take the higher (Holofoil) price as it's more common
     *          for valuable cards.
     *
     * HOW TCGTRACKING RETURNS SKUS:
     *   The /skus endpoint returns a nested object:
     *     products -> productId -> skuId -> sku
     *
     *   We only keep English SKUs, then group prices back under the numeric
     *   product ID so cards can be matched by collector number.
     *
     * @param products  Product ID -> SKU ID -> SKU data from TCGTracking
     * @return          Map from productId to CardPrices
     */
    private def buildPriceMap(products: Map[String, Map[String, TcgSku]]): Map[Int, CardPrices] =
      products
        .flatMap { case (productId, skuMap) =>
          productId.toIntOption.map(_ -> skuMap.values.filter(_.language == "EN").toList)
        }
        .map { case (productId, productSkus) =>
          // For each condition, take the highest price across all printings
          // (Holofoil > Normal for cards that have both)
          def priceFor(cond: String): Option[Double] =
            productSkus
              .filter(_.condition == cond)
              .flatMap(_.market)
              .maxOption

          productId -> CardPrices(
            nm  = priceFor("NM"),
            lp  = priceFor("LP"),
            mp  = priceFor("MP"),
            hp  = priceFor("HP"),
            dmg = priceFor("DMG")
          )
        }
        // Only include products that have at least one price
        .filter { case (_, prices) =>
          prices.nm.orElse(prices.lp).orElse(prices.mp)
                .orElse(prices.hp).orElse(prices.dmg).isDefined
        }

  /**
   * VALUE: layer
   * PURPOSE: ZLayer that provides a PriceService.
   * @return ZLayer[CardRepository, Nothing, PriceService]
   */
  val layer: ZLayer[CardRepository, Nothing, PriceService] =
    ZLayer.fromZIO {
      for
        repo <- ZIO.service[CardRepository]
        cache <- Ref.make(Option.empty[(Long, List[TcgSetResult])])
      yield new Live(repo, cache)
    }
