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
   * @param productId  TCGTracking's numeric product ID for this card
   * @param condition  Condition string: "NM", "LP", "MP", "HP", "DMG", or "UNO" (ungraded)
   * @param printing   The card finish: "Normal", "Foil", "Holo", "1st Edition" etc.
   * @param language   Language: "EN", "JP" etc. We only use EN prices.
   * @param price      Market price in USD. None if no price data available.
   */
  private case class TcgSku(
    productId: Int,
    condition: String,
    printing:  String,
    language:  String,
    price:     Option[Double]
  )
  private given JsonDecoder[TcgSku] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgSkuResponse
   * PURPOSE: Wrapper around the TCGTracking SKU endpoint response.
   * @param skus  List of all SKUs for the set
   */
  private case class TcgSkuResponse(skus: List[TcgSku])
  private given JsonDecoder[TcgSkuResponse] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgProduct
   * PURPOSE: One product (card) from TCGTracking's product list for a set.
   *
   * @param id      TCGTracking's numeric product ID
   * @param number  Collector number — used to match to our Card records
   * @param name    Card name — used as fallback match if number doesn't work
   */
  private case class TcgProduct(id: Int, number: String, name: String)
  private given JsonDecoder[TcgProduct] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgProductResponse
   * PURPOSE: Wrapper around the TCGTracking products endpoint response.
   * @param products  List of all products in the set
   */
  private case class TcgProductResponse(products: List[TcgProduct])
  private given JsonDecoder[TcgProductResponse] = DeriveJsonDecoder.gen

  /**
   * CASE CLASS: TcgSetResult
   * PURPOSE: One set result from TCGTracking's search endpoint.
   * @param id           TCGTracking's numeric set ID — used to build product/SKU URLs
   * @param name         Set name
   * @param abbreviation Set abbreviation e.g. "SVI" — matches our ptcgoCode
   */
  private case class TcgSetResult(id: Int, name: String, abbreviation: String)
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
  final class Live(repo: CardRepository) extends PriceService:

    /**
     * METHOD: get
     * PURPOSE: HTTP GET — returns response body as String.
     * @param url  The URL to fetch
     * @return     Response body, or fails with a descriptive message
     */
    private def get(url: String): Task[String] =
      ZIO.attemptBlocking {
        val conn = java.net.URI.create(url).toURL.openConnection()
        conn.setConnectTimeout(10000)
        conn.setReadTimeout(30000)
        val stream = conn.getInputStream
        try new String(stream.readAllBytes()) finally stream.close()
      }.mapError(e => RuntimeException(s"GET $url failed: ${e.getMessage}"))

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
     * METHOD: findTcgSetId
     * PURPOSE: Finds the TCGTracking numeric set ID for a given CardSet.
     *          Tries to match by ptcgoCode (abbreviation) first, then by name.
     *          Returns None if no match found — this is normal for newer sets
     *          that TCGTracking hasn't added yet.
     *
     * @param set  The CardSet to find in TCGTracking
     * @return     Some(tcgSetId) if found, None if not
     */
    private def findTcgSetId(set: CardSet): Task[Option[Int]] =
      val query = set.ptcgoCode.getOrElse(set.name)
      get(s"$BASE/$POKEMON_CAT/search?q=$query")
        .flatMap(parse[TcgSearchResponse])
        .map { resp =>
          val norm = (s: String) => s.toLowerCase.replaceAll("[^a-z0-9]", "")
          // Try exact abbreviation match first
          resp.sets.find(s => set.ptcgoCode.exists(c => norm(s.abbreviation) == norm(c)))
            // Fall back to name match
            .orElse(resp.sets.find(s => norm(s.name) == norm(set.name)))
            .map(_.id)
        }
        // If search fails (network error, set not found), return None rather than crashing
        .catchAll(_ => ZIO.succeed(None))

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
          // Set not in TCGTracking yet (common for newest sets) — skip silently
          ZIO.logInfo(s"No TCGTracking match for set: ${set.name}")

        case Some(tcgSetId) =>
          for
            // Fetch products to get number → productId mapping
            productsJson <- get(s"$BASE/$POKEMON_CAT/sets/$tcgSetId")
            products     <- parse[TcgProductResponse](productsJson)
            // Fetch SKUs to get productId → condition prices
            skusJson     <- get(s"$BASE/$POKEMON_CAT/sets/$tcgSetId/skus")
            skuResp      <- parse[TcgSkuResponse](skusJson)

            // Build a map from productId to its English NM/LP/MP/HP/DMG prices
            // We only use English (EN) language prices
            pricesByProductId = buildPriceMap(skuResp.skus.filter(_.language == "EN"))

            // Build a map from collector number to productId
            numberToProductId = products.products
                                  .map(p => p.number -> p.id)
                                  .toMap

            // For each card, find prices and save
            _ <- ZIO.foreach(cards) { card =>
                   numberToProductId.get(card.number)
                     .flatMap(pricesByProductId.get) match
                     case Some(prices) => repo.upsertPrices(card.id, prices)
                     case None         => ZIO.unit // No price data for this card
                 }
            _ <- ZIO.logInfo(s"Prices stored for set: ${set.name}")
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
     * @param skus  All English SKUs for a set
     * @return      Map from productId to CardPrices
     */
    private def buildPriceMap(skus: List[TcgSku]): Map[Int, CardPrices] =
      skus
        .groupBy(_.productId)
        .map { case (productId, productSkus) =>
          // For each condition, take the highest price across all printings
          // (Holofoil > Normal for cards that have both)
          def priceFor(cond: String): Option[Double] =
            productSkus
              .filter(_.condition == cond)
              .flatMap(_.price)
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
    ZLayer.fromFunction(new Live(_))
