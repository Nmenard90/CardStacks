/**
 * PriceService — fetches per-condition card prices from TCGTracking and
 * saves them.
 *
 * HOW IT WORKS
 *   TCGTracking sets have their own numeric IDs, unrelated to
 *   pokemontcg.io's — findTcgSetId resolves ours to theirs by matching
 *   names/codes (see its own doc comment for the tiered matching logic).
 *   Once resolved, fetchProducts + fetchSkus pull the whole set's prices
 *   in two calls, matched back to our cards by collector number.
 *
 * WHY TCGTRACKING: free, no key, no rate limit, per-condition pricing
 *   (NM/LP/MP/HP/DMG) — TCGTracking is the only source with that shape.
 *
 * USED BY: CardService, right after a set's cards are fetched.
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.CardRepository
import zio.*
import zio.json.*

// zio-json's generic "any JSON value" type, used below to hand-write one
// decoder for a field TCGTracking doesn't send in a consistent shape.
import zio.json.ast.Json

trait PriceService:

  /**
   * Fetches this set's prices from TCGTracking and saves them. Failures
   * are logged, not thrown — a missing price is fine, the app still works
   * without one.
   */
  def fetchAndStorePrices(set: CardSet, cards: List[Card]): Task[Unit]

object PriceService:

  // ── TCGTracking response shapes ─────────────────────────────────────────
  // These match TCGTracking's own JSON exactly. Kept private — nothing
  // outside this file ever sees them.

  /**
   * One SKU from TCGTracking — one card in one specific condition.
   * TCGTracking uses short field names: cnd = condition, var = printing,
   * lng = language, mkt = market price.
   */
  private case class TcgSku(
    @jsonField("cnd") condition: String,
    @jsonField("var") printing:  String,
    @jsonField("lng") language:  String,
    @jsonField("mkt") market:    Option[Double]
  )
  private given JsonDecoder[TcgSku] = DeriveJsonDecoder.gen

  /**
   * The SKU list response. TCGTracking nests it as: products -> productId
   * -> skuId -> sku data.
   */
  private case class TcgSkuResponse(
    products: Map[String, Map[String, TcgSku]],
    @jsonField("sku_count") skuCount: Option[Int]
  )
  private given JsonDecoder[TcgSkuResponse] = DeriveJsonDecoder.gen

  /** One product (card) from TCGTracking's product list for a set. */
  private case class TcgProduct(id: Int, name: String, number: Option[String])

  // TCGTracking sends `number` inconsistently — sometimes text, sometimes
  // a raw number, sometimes missing — so this is hand-written instead of
  // auto-generated, to handle all three shapes without failing.
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
        // Handles all three shapes `number` can arrive in.
        val number = obj.get("number").flatMap {
          case Json.Str(s) => Some(s)
          case Json.Num(n) => scala.util.Try(n.toString.toInt).toOption.map(_.toString)
          case _           => None
        }
        TcgProduct(id, name, number)
    }
  }

  /**
   * The product list response.
   * @param productCount  TCGTracking's own claimed total for the set —
   *                      used to spot a cut-off response (see fetchProducts).
   */
  private case class TcgProductResponse(
    products: List[TcgProduct],
    @jsonField("product_count") productCount: Option[Int]
  )
  private given JsonDecoder[TcgProductResponse] = DeriveJsonDecoder.gen

  /** One set result from TCGTracking's set list. */
  private case class TcgSetResult(
    id:           Int,
    name:         String,
    abbreviation: Option[String],
    @jsonField("product_count") productCount: Option[Int],
    @jsonField("published_on") publishedOn: Option[String]
  )
  private given JsonDecoder[TcgSetResult] = DeriveJsonDecoder.gen

  private case class TcgSearchResponse(sets: List[TcgSetResult])
  private given JsonDecoder[TcgSearchResponse] = DeriveJsonDecoder.gen

  // Pokemon's category number in TCGTracking's own system.
  private val POKEMON_CAT = 3
  private val BASE        = "https://tcgtracking.com/tcgapi/v1"

  /**
   * The real, working PriceService.
   * @param setsCache  Holds TCGTracking's full set list in memory for an
   *                   hour, so we don't fetch it fresh on every call.
   */
  private final class Live(repo: CardRepository, setsCache: Ref[Option[(Long, List[TcgSetResult])]]) extends PriceService:

    /**
     * Downloads whatever's at `url`. Retries up to 5 times with a growing
     * wait between tries, since TCGTracking occasionally times out or
     * sends back nothing — one bad attempt shouldn't ruin an entire set's
     * price fetch.
     *
     * The User-Agent header is set to look like a real browser — Railway's
     * servers were confirmed getting a cut-off response from TCGTracking
     * for large sets when using the default one, but not with this one.
     */
    private def get(url: String): Task[String] =
      val maxAttempts = 5
      def attempt(n: Int): Task[String] =
        ZIO.attemptBlocking {
          val conn = java.net.URI.create(url).toURL.openConnection()
          conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
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

    private def parse[A: JsonDecoder](json: String): Task[A] =
      ZIO.fromEither(json.fromJson[A])
         .mapError(e => RuntimeException(s"JSON parse error: $e"))

    /**
     * Fetches a set's product list, retrying with a cache-busting URL if
     * the response looks too short. TCGTracking's servers sometimes serve
     * an old cached snapshot that's internally consistent with itself, so
     * the only way to catch it is comparing against our OWN card count
     * from a different source (pokemontcg.io) — not TCGTracking's own claimed total.
     *
     * @param expectedCards  Our own card count for this set. The retry
     *                       threshold is loose (60%) since TCGTracking's
     *                       product list can legitimately include
     *                       non-card items too.
     */
    private def fetchProducts(tcgSetId: Int, setName: String, expectedCards: Int): Task[TcgProductResponse] =
      val maxAttempts = 3
      def attempt(n: Int): Task[TcgProductResponse] =
        // First try uses the plain URL; every retry adds a timestamp so
        // it can't be served from a stale cache.
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
     * Same idea as fetchProducts, but for the price (SKU) data — checked
     * against the product count we already fetched, for the same reason.
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
     * Makes collector numbers from both APIs comparable. pokemontcg.io can
     * send "001"; TCGTracking sends "1/198". Without this, cards 001-099
     * would never match anything and never get a price.
     */
    private def normalizeCollectorNumber(number: String): String =
      // Keeps only the part before any slash.
      val base = number.split("/").head.trim
      // Strips leading zeros off a purely numeric number; leaves text
      // numbers like "SWSH001" untouched.
      base.toIntOption.map(_.toString).getOrElse(base)

    /**
     * Fetches TCGTracking's full set list (~280 sets, one call) and keeps
     * it in memory for an hour.
     *
     * TCGTracking's own search only matches near-exact substrings of the
     * set name, and our set names often don't literally appear in
     * TCGTracking's — this was confirmed to leave dozens of sets with
     * zero matches. Fetching the whole list once and matching ourselves
     * avoids that entirely.
     */
    private def allTcgSets: Task[List[TcgSetResult]] =
      val ttlMs = 60 * 60 * 1000L // one hour

      setsCache.get.flatMap {
        // Still fresh — use the cached copy, no network call.
        case Some((fetchedAt, sets)) if java.lang.System.currentTimeMillis() - fetchedAt < ttlMs =>
          ZIO.succeed(sets)

        // Missing or expired — fetch fresh.
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
     * Finds a CardSet's matching TCGTracking set ID, or None if no
     * confident match exists (normal for sets TCGTracking simply doesn't track).
     *
     * Tries several matching strategies in order, first match wins:
     *   1. Our set code matches TCGTracking's abbreviation.
     *   2. Set names match exactly (ignoring punctuation/spacing).
     *   3. Names match after stripping a "CODE: " prefix TCGTracking adds.
     *   4. Fuzzy word-overlap match, for names TCGTracking wraps in extra
     *      wording ("SM - Cosmic Eclipse" vs. "Cosmic Eclipse").
     *   5. Last resort: an exact release-date match.
     */
    private def findTcgSetId(set: CardSet): Task[Option[Int]] =
      // Lowercases and strips everything but letters/digits, for loose comparisons.
      val norm = (s: String) => s.toLowerCase.replaceAll("[^a-z0-9]", "")

      // Strips accent marks (é -> e) so accented and plain spellings match.
      def foldAccents(s: String): String =
        java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFKD).replaceAll("\\p{M}", "")

      // Common words that don't help identify a set — dropped before comparing.
      val stopWords = Set("star", "pokemon")

      // A rough plural remover: "cards" -> "card".
      def stem(t: String): String =
        if t.length > 3 && t.endsWith("s") then t.dropRight(1) else t

      // Breaks a set name into a set of individual normalized words, for
      // comparing word-by-word rather than as one exact string.
      def tokens(s: String): Set[String] =
        foldAccents(s).toLowerCase.split("[^a-z0-9]+").iterator
          .filter(_.nonEmpty).map(stem).filterNot(stopWords.contains).toSet

      // TCGTracking spells out a couple of retro eras by full name instead
      // of using our abbreviation ("Black and White Promos" vs. our "BW
      // Black Star Promos"). This adds the short code back in when both
      // spelled-out words are present, so the two can line up.
      val eraAliases = Map("bw" -> Set("black", "white"), "dp" -> Set("diamond", "pearl"))
      def expandCandidateTokens(toks: Set[String]): Set[String] =
        eraAliases.foldLeft(toks) { case (acc, (abbr, spelled)) =>
          if spelled.subsetOf(toks) then acc + abbr else acc
        }

      // Removes a "CODE: " prefix TCGTracking sometimes adds, e.g.
      // "SWSH04: Vivid Voltage" -> "Vivid Voltage".
      def stripTcgPrefix(name: String): String =
        name.split(":", 2) match
          case Array(_, rest) => rest.trim
          case _              => name

      // Bonus subsets (Trainer Gallery, Shiny Vault) usually share their
      // parent set's code in our data, but TCGTracking lists them
      // separately ("CRZ" vs "CRZ:GG"). Trusting a code match here would
      // wrongly attach the PARENT set's prices to the subset's cards —
      // confirmed live, this happened and every card came up unmatched
      // afterward. So bonus subsets skip the code-match step entirely.
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
            // What fraction of our name's words does this candidate cover?
            .map { case (c, candTokens) => (c, candTokens, ourTokens.intersect(candTokens).size.toDouble / ourTokens.size) }
            // Below 60% coverage, it's probably a different set entirely.
            .filter(_._3 >= 0.6)
            // Best coverage first; ties broken by closest card count, then shortest name.
            .sortBy { case (c, candTokens, ratio) => (-ratio, math.abs(c.productCount.getOrElse(0) - set.total), candTokens.size) }
            .headOption
            .map(_._1)

      // No two TCGTracking sets share a release date, so this is always
      // unambiguous — used as a last resort for names too different to match by words.
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
     * The main entry point. Finds the set on TCGTracking, fetches its
     * prices, matches each price to our own cards by collector number,
     * and saves the results.
     */
    def fetchAndStorePrices(set: CardSet, cards: List[Card]): Task[Unit] =
      findTcgSetId(set).flatMap {
        case None =>
          // No match on TCGTracking at all — log it and stop. Still
          // counts as success; "no prices found" is a normal outcome.
          ZIO.logInfo(s"TCGTracking: skipping prices for '${set.name}' — no set match found")

        case Some(tcgSetId) =>
          for
            products     <- fetchProducts(tcgSetId, set.name, cards.size)
            skuResp      <- fetchSkus(tcgSetId, set.name, products.products.size)

            pricesByProductId = buildPriceMap(skuResp.products)

            // A card's number can map to MORE THAN ONE TCGTracking product
            // (Poké Ball/Master Ball variants share a base number). Keeps
            // every product for each number, not just the last one seen —
            // otherwise a card could have a real price sitting on a
            // sibling product and still show "no price" here.
            numberToProductIds = products.products
                                    .flatMap(p => p.number.map(n => normalizeCollectorNumber(n) -> p.id))
                                    .groupMap(_._1)(_._2)

            _ <- ZIO.logInfo(
                   s"TCGTracking: '${set.name}' — ${products.products.size} products, " +
                   s"${pricesByProductId.size} with prices, ${numberToProductIds.size} distinct numbers"
                 )

            saved <- ZIO.foreach(cards) { card =>
                       // Every product sharing this card's number, keeping
                       // only the first one that actually has a price.
                       numberToProductIds.getOrElse(normalizeCollectorNumber(card.number), Nil)
                         .flatMap(pricesByProductId.get)
                         .headOption match
                         case Some(prices) => repo.upsertPrices(card.id, prices).as(true)
                         case None         => ZIO.succeed(false)
                     }

            matched = saved.count(identity)

            // Only builds the unmatched-cards list when something actually failed to match.
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
     * Groups a set's SKUs by product and pulls out one price per
     * condition. A product can have several printings (Normal, Holofoil,
     * 1st Edition) — takes the highest price found for each condition.
     */
    private def buildPriceMap(products: Map[String, Map[String, TcgSku]]): Map[Int, CardPrices] =
      products
        // Keeps only English-language SKUs, dropping the inner SKU IDs we don't need.
        .flatMap { case (productId, skuMap) =>
          productId.toIntOption.map(_ -> skuMap.values.filter(_.language == "EN").toList)
        }
        .map { case (productId, productSkus) =>
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
        // Drops products with no usable price at all.
        .filter { case (_, prices) =>
          prices.nm.orElse(prices.lp).orElse(prices.mp)
                .orElse(prices.hp).orElse(prices.dmg).isDefined
        }

  val layer: ZLayer[CardRepository, Nothing, PriceService] =
    ZLayer.fromZIO {
      for
        repo  <- ZIO.service[CardRepository]
        // Starts the in-memory set-list cache empty.
        cache <- Ref.make(Option.empty[(Long, List[TcgSetResult])])
      yield new Live(repo, cache)
    }
