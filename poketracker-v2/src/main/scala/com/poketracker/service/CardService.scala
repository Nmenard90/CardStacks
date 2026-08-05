/**
 * FILE: CardService.scala
 * PACKAGE: com.poketracker.service
 * LOCATION: src/main/scala/com/poketracker/service/CardService.scala
 *
 * PURPOSE:
 *   Business logic for cards and sets.
 *   Sits between CardRoutes and CardRepository.
 *   Handles fetching from the pokemontcg.io API when data is not yet in
 *   the database, caching results, and sorting cards correctly.
 *
 * WHY A SERVICE LAYER?
 *   The repository only knows how to read and write the database.
 *   The routes only know how to handle HTTP requests.
 *   This service contains the actual rules:
 *     "If a set has no cards in the database, fetch them from the API."
 *     "Sort cards numerically, with secret rares after the main set."
 *   Keeping these rules here means they are tested and changed in one place.
 *
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.models.*
 *     Card, CardSet, CardImage, SetImages — our internal data types.
 *
 *   com.poketracker.repository.CardRepository
 *     The repository this service delegates all database operations to.
 *
 *   zio.*
 *     ZIO core — Task, ZLayer, ZIO.service, ZIO.foreach, System.env etc.
 *
 *   zio.json.*
 *     JsonDecoder, DeriveJsonDecoder — for parsing API JSON responses.
 *     fromJson[T] extension method on String for safe JSON parsing.
 *
 *   java.time.LocalDate
 *     Standard JVM date type — sets have release dates, no time needed.
 *
 * USED BY: CardRoutes
 * DEPENDS ON: CardRepository, pokemontcg.io API, POKEMONTCG_API_KEY env var
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.CardRepository
import com.poketracker.service.PriceService
import zio.*
import zio.json.*
import java.time.LocalDate

// ── API response types ────────────────────────────────────────────────────────
//
// These case classes mirror the JSON shape returned by pokemontcg.io.
// They are private to this file — nothing outside CardService knows they exist.
// We convert them to our internal Card/CardSet types before returning them.
// This isolates our code from changes in the external API format.

/**
 * CASE CLASS: ApiCard
 * PURPOSE: Represents one card as returned by the pokemontcg.io API — every
 *          field it can return, not just the handful the rest of the app
 *          uses day to day. Converted to our internal Card type (including
 *          the full CardDetails) by toCard() before use.
 *
 *          Fields beyond the original core set are all Option/List-defaulted
 *          because most only appear on some supertypes/eras (a Trainer card
 *          has no `hp`, only a few XY-era cards have `ancientTrait`, etc.) —
 *          a card missing any of them must never fail to decode.
 *
 * @param id      Card ID from the API e.g. "sv1-1"
 * @param name    Card name e.g. "Charizard ex"
 * @param number  Collector number e.g. "4" or "TG01"
 * @param rarity  Rarity string if present e.g. "Special Illustration Rare"
 * @param artist  Illustrator name if listed on the card
 * @param images  URLs to small and large card images
 * @param set     The full embedded set object (same shape as the /sets
 *                endpoint's entries) — reused as-is rather than a separate
 *                id-only type, and stored verbatim as CardDetails.embeddedSet.
 * @param tcgplayer/cardmarket  pokemontcg.io's own bundled pricing — used as
 *                a fallback price source. Decoded straight into the shared
 *                model types (see Card.scala) since these are pure data
 *                pass-through with no transformation needed.
 */
private case class ApiCard(
  id:     String,
  name:   String,
  number: String,
  rarity: Option[String],
  artist: Option[String],
  images: ApiImages,
  set:    ApiSet,
  supertype:              Option[String] = None,
  subtypes:               List[String] = Nil,
  level:                  Option[String] = None,
  hp:                     Option[String] = None,
  types:                  List[String] = Nil,
  evolvesFrom:            Option[String] = None,
  evolvesTo:              List[String] = Nil,
  rules:                  List[String] = Nil,
  ancientTrait:           Option[CardAncientTrait] = None,
  regulationMark:         Option[String] = None,
  abilities:              List[CardAbility] = Nil,
  attacks:                List[CardAttack] = Nil,
  weaknesses:             List[CardTypeValue] = Nil,
  resistances:            List[CardTypeValue] = Nil,
  retreatCost:            List[String] = Nil,
  convertedRetreatCost:   Option[Int] = None,
  flavorText:             Option[String] = None,
  nationalPokedexNumbers: List[Int] = Nil,
  legalities:             Map[String, String] = Map.empty,
  tcgplayer:              Option[TcgplayerInfo] = None,
  cardmarket:             Option[CardmarketInfo] = None
)

/**
 * CASE CLASS: ApiImages
 * @param small  Small card image URL (~245x342px) for grid views
 * @param large  Large card image URL (~745x1040px) for detail views
 */
private case class ApiImages(small: String, large: String)

/**
 * CASE CLASS: ApiSet
 * PURPOSE: Represents one set as returned by the pokemontcg.io API — both
 *          from the /sets endpoint directly, and as the `set` object
 *          embedded in every card response (identical shape). Converted to
 *          our internal CardSet type by toSet() for the former, and to
 *          CardDetails.embeddedSet for the latter.
 *
 * @param id           Set ID e.g. "sv1", "base1"
 * @param name         Full set name e.g. "Scarlet & Violet"
 * @param series       Series name e.g. "Scarlet & Violet"
 * @param printedTotal Number on cards as denominator e.g. 165 for "4/165"
 * @param total        Actual total including secret rares. Always >= printedTotal.
 * @param releaseDate  Release date string from API — format varies, parsed safely
 * @param images       Symbol and logo image URLs
 * @param ptcgoCode    PTCG Online code e.g. "SVI" — used to match TCGTracking prices
 * @param legalities   Format legality e.g. {"unlimited": "Legal"}
 * @param updatedAt    When pokemontcg.io last updated this set's data
 */
private case class ApiSet(
  id:           String,
  name:         String,
  series:       String,
  printedTotal: Int,
  total:        Int,
  releaseDate:  String,
  images:       ApiSetImages,
  ptcgoCode:    Option[String],
  legalities:   Map[String, String] = Map.empty,
  updatedAt:    Option[String] = None
)

/**
 * CASE CLASS: ApiSetImages
 * @param symbol  URL to set symbol icon shown in dropdowns
 * @param logo    URL to full set logo shown on set pages
 */
private case class ApiSetImages(symbol: String, logo: String)

/**
 * CASE CLASS: ApiCardsResp
 * PURPOSE: Wrapper around the API paginated cards response.
 * @param data        Cards on this page (max 250)
 * @param totalCount  Total cards across all pages — used to know how many pages to fetch
 */
private case class ApiCardsResp(data: List[ApiCard], totalCount: Int)

/**
 * CASE CLASS: ApiSetsResp
 * PURPOSE: Wrapper around the API sets list response.
 * @param data  All sets returned
 */
private case class ApiSetsResp(data: List[ApiSet])

// Automatically generate JSON decoders for all API response types.
// DeriveJsonDecoder.gen reads the case class field names and matches them
// to JSON keys automatically — no manual mapping needed. Nested detail types
// (CardAbility, CardAttack, TcgplayerInfo, etc.) already have their own
// JsonDecoder from Card.scala's companion objects, found automatically.
private given JsonDecoder[ApiImages]    = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSetImages] = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSet]       = DeriveJsonDecoder.gen
private given JsonDecoder[ApiCard]      = DeriveJsonDecoder.gen
private given JsonDecoder[ApiCardsResp] = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSetsResp]  = DeriveJsonDecoder.gen

// ── Trait ─────────────────────────────────────────────────────────────────────

/**
 * TRAIT: CardService
 * PURPOSE: Defines the interface for card and set business logic.
 *          CardRoutes depends on this trait, not the Live implementation,
 *          so we can swap in a test implementation without changing routes.
 */
trait CardService:

  /**
   * METHOD: getSets
   * PURPOSE: Returns all sets ordered newest first.
   *          Serves from database if populated, fetches from API on first run.
   * @return All sets, newest release date first
   */
  def getSets: Task[List[CardSet]]

  /**
   * METHOD: getCardsBySet
   * PURPOSE: Returns all cards for a set including prices.
   *          Serves from database if cached, fetches from API if not.
   * @param setId  Set ID e.g. "sv1", "me2pt5"
   * @return       All cards sorted by collector number
   */
  def getCardsBySet(setId: String): Task[List[Card]]

  /**
   * METHOD: getCardById
   * PURPOSE: Returns a single card with its prices.
   * @param id  Card ID e.g. "sv1-1"
   * @return    Some(card) if found, None if not
   */
  def getCardById(id: String): Task[Option[Card]]

  /**
   * METHOD: getPriceHistory
   * PURPOSE: Every price snapshot ever recorded for a card, oldest first.
   *          There is no backfill — history starts accumulating from whenever
   *          this card's prices first get fetched after this feature shipped.
   * @param id  Card ID e.g. "sv1-1"
   * @return    Snapshots ordered oldest to newest (may be empty)
   */
  def getPriceHistory(id: String): Task[List[PriceHistoryPoint]]

  /**
   * METHOD: searchCards
   * PURPOSE: Full-text search across all card names.
   *          Used by the trade analyzer search box.
   * @param q  Search term e.g. "Charizard" — partial matches work
   * @param n  Maximum results. Default 60.
   * @return   Matching cards, newest sets first
   */
  def searchCards(q: String, n: Int = 60): Task[List[Card]]

  /**
   * METHOD: refreshSet
   * PURPOSE: Forces a re-fetch of a set from the API.
   *          Called by the admin endpoint when a new set releases.
   * @param setId  The set to refresh
   * @return       Unit
   */
  def refreshSet(setId: String): Task[Unit]

  /**
   * METHOD: ensureCached
   * PURPOSE: Guarantees that every given card ID exists in the local catalog
   *          before a collection entry referencing it is saved. For any ID with
   *          no cards row, the card's set is refreshed from the API (which loads
   *          the card and its prices). This is what prevents "orphaned" entries
   *          that later render blank/$0 in the owned view and exports.
   *          Best-effort: a set that fails to refresh is logged, not fatal, so a
   *          save is never blocked by an upstream API hiccup.
   * @param cardIds  Card IDs about to be saved (duplicates are fine)
   * @return         Number of distinct sets that were refreshed
   */
  def ensureCached(cardIds: List[String]): Task[Int]

  /**
   * METHOD: refreshPrices
   * PURPOSE: Re-fetches prices from TCGTracking for a set without re-downloading
   *          card metadata from pokemontcg.io. Cheaper than refreshSet when only
   *          price data is stale or was missing. Resets the stale timer so the
   *          next regular load picks up the new prices from the DB cache.
   * @param setId  Set to re-price
   * @return       Unit
   */
  def refreshPrices(setId: String): Task[Unit]

  /**
   * METHOD: refreshOrphans
   * PURPOSE: One-shot repair. Finds every orphaned card across all collections
   *          (owned but missing from the catalog) and backfills their sets, so
   *          existing blank/$0 cards are fixed without refreshing each set by hand.
   * @return  Number of distinct sets that were refreshed
   */
  def refreshOrphans: Task[Int]

// ── Live implementation ───────────────────────────────────────────────────────

/**
 * OBJECT: CardService
 * PURPOSE: Contains the Live implementation and the ZLayer that provides it.
 */
object CardService:

  /**
   * CLASS: Live
   * PURPOSE: The real CardService that calls pokemontcg.io and caches in the DB.
   *
   * @param repo    CardRepository — all database access delegated here
   * @param apiKey  Pokémon TCG API key from POKEMONTCG_API_KEY env var.
   *                Empty string = no key, requests will be rate limited.
   */
  final class Live(repo: CardRepository, priceService: PriceService, apiKey: String) extends CardService:

    /** Base URL for the Pokémon TCG API v2. */
    private val base = "https://api.pokemontcg.io/v2"

    /**
     * METHOD: get
     * PURPOSE: HTTP GET — returns response body as String.
     *          Uses Java's built-in HttpURLConnection, no extra dependency.
     *          15s connection timeout, 60s read timeout, with retry/backoff
     *          for pokemontcg.io's frequent transient failures (HTTP 500s,
     *          timeouts, and occasional empty-but-200 response bodies).
     *
     * WHY RETRY/BACKOFF MATTERS HERE:
     *   A single sync makes many sequential calls (one per page, per set), so
     *   without retry, one transient blip anywhere aborted the whole set's
     *   fetch — cards silently missing from search/bulk-add, not because they
     *   don't exist, but because the one page that would have returned them
     *   failed and was never retried. The previous single-immediate-retry
     *   wasn't enough headroom for the API's actual failure pattern, which
     *   often needs a few seconds to recover.
     *
     * @param url  The URL to fetch
     * @return     Response body, or fails with a descriptive error message
     *             after all attempts are exhausted
     */
    private def get(url: String): Task[String] =
      val maxAttempts = 5
      def attempt(n: Int): Task[String] =
        ZIO.attemptBlocking {
          val conn = java.net.URI.create(url).toURL.openConnection()
          conn.setRequestProperty("X-Api-Key", apiKey)
          conn.setConnectTimeout(15000)
          conn.setReadTimeout(60000)
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
     * PURPOSE: Parses a JSON string into a typed Scala value.
     *          Fails with a clear error if the JSON is malformed
     *          or missing required fields.
     *
     * @tparam A   The type to parse into — must have a JsonDecoder
     * @param json The JSON string to parse
     * @return     The parsed value, or fails with a parse error message
     */
    private def parse[A: JsonDecoder](json: String): Task[A] =
      ZIO.fromEither(json.fromJson[A])
         .mapError(e => RuntimeException(s"JSON parse error: $e"))

    /**
     * METHOD: toCard
     * PURPOSE: Converts an ApiCard to our internal Card model, including the
     *          full CardDetails snapshot (everything pokemontcg.io returned
     *          beyond the core fields). Prices are always None here —
     *          fetched from TCGTracking separately (fallbackNm below handles
     *          pokemontcg.io's own bundled pricing).
     *
     * @param c  The API card to convert
     * @return   Our internal Card
     */
    private def toCard(c: ApiCard): Card =
      val details = CardDetails(
        supertype              = c.supertype,
        subtypes                = c.subtypes,
        level                   = c.level,
        hp                      = c.hp,
        types                   = c.types,
        evolvesFrom             = c.evolvesFrom,
        evolvesTo               = c.evolvesTo,
        rules                   = c.rules,
        ancientTrait            = c.ancientTrait,
        regulationMark          = c.regulationMark,
        abilities                = c.abilities,
        attacks                  = c.attacks,
        weaknesses               = c.weaknesses,
        resistances              = c.resistances,
        retreatCost              = c.retreatCost,
        convertedRetreatCost     = c.convertedRetreatCost,
        flavorText               = c.flavorText,
        nationalPokedexNumbers   = c.nationalPokedexNumbers,
        legalities               = c.legalities,
        tcgplayer                = c.tcgplayer,
        cardmarket               = c.cardmarket,
        embeddedSet = Some(EmbeddedSetInfo(
          id = c.set.id, name = c.set.name, series = c.set.series,
          printedTotal = c.set.printedTotal, total = c.set.total,
          releaseDate = c.set.releaseDate, updatedAt = c.set.updatedAt,
          legalities = c.set.legalities, ptcgoCode = c.set.ptcgoCode,
          imageSymbol = Some(c.set.images.symbol), imageLogo = Some(c.set.images.logo)
        ))
      )
      Card(c.id, c.set.id, c.name, c.number, c.rarity, c.artist,
           CardImage(c.images.small, c.images.large), None, Some(details))

    /**
     * METHOD: fallbackNm
     * PURPOSE: Derives a Near-Mint-ish fallback price straight from
     *          pokemontcg.io's own bundled tcgplayer/cardmarket data — no
     *          extra network call, no TCGTracking set-matching risk. Used to
     *          fill in cards TCGTracking's matching genuinely can't reach
     *          (older/promo sets it doesn't track at all).
     *
     *          Deliberately NM-only: tcgplayer/cardmarket give per-PRINTING
     *          data (normal/holofoil/reverseHolofoil/...), not per-CONDITION
     *          data like TCGTracking does, so there's no honest way to
     *          derive lp/mp/hp/dmg from them — inventing those would be
     *          fabricating data we don't actually have.
     *
     * @param c  The API card to derive a fallback price from
     * @return   Some(price) if pokemontcg.io has any usable pricing, else None
     */
    private def fallbackNm(c: ApiCard): Option[Double] =
      val variantPreference = List(
        "holofoil", "reverseHolofoil", "normal",
        "1stEditionHolofoil", "1stEditionNormal", "unlimitedHolofoil", "unlimited"
      )
      val fromTcgplayer = c.tcgplayer.flatMap { tp =>
        val ordered = variantPreference.flatMap(tp.prices.get) ++ tp.prices.values.toList
        ordered.flatMap(v => v.market.orElse(v.mid)).headOption
      }
      fromTcgplayer.orElse(
        c.cardmarket.flatMap { cm =>
          cm.prices.averageSellPrice.filter(_ > 0)
            .orElse(cm.prices.trendPrice.filter(_ > 0))
        }
      )

    /**
     * METHOD: numberLess
     * PURPOSE: Shared collector-number comparator — numeric numbers sort
     *          numerically, non-numeric numbers (TG01, SWSH001) sort
     *          alphabetically after all numerics. Factored out of `sorted`
     *          so card/fallback-price pairs can be sorted the same way
     *          without unpacking to a bare List[Card] first.
     */
    private def numberLess(a: String, b: String): Boolean =
      (a.toIntOption, b.toIntOption) match
        case (Some(x), Some(y)) => x < y
        case (Some(_), None)    => true
        case (None, Some(_))    => false
        case _                  => a < b

    /**
     * METHOD: toSet
     * PURPOSE: Converts an ApiSet to our internal CardSet model.
     *          Parses the release date safely — defaults to 2000-01-01
     *          if the date string cannot be parsed (prevents crashes on bad API data).
     *
     * @param s  The API set to convert
     * @return   Our internal CardSet
     */
    private def toSet(s: ApiSet): CardSet =
      val date = scala.util.Try(LocalDate.parse(s.releaseDate.replace("/", "-")))
                   .getOrElse(LocalDate.of(2000, 1, 1))
      CardSet(s.id, s.name, s.series, s.printedTotal, s.total,
              date, SetImages(s.images.symbol, s.images.logo), s.ptcgoCode)

    /**
     * METHOD: fetchPages
     * PURPOSE: Fetches all pages of cards for a set from the API.
     *          pokemontcg.io returns max 250 cards per page.
     *          Fetches page 1 to get the total count, then fetches
     *          remaining pages if needed.
     *
     * @param setId  The set to fetch cards for
     * @return       All cards from all pages combined into one List
     */
    private def fetchPages(setId: String): Task[List[ApiCard]] =
      for
        first <- get(s"$base/cards?q=set.id:$setId&pageSize=250&page=1")
                   .flatMap(parse[ApiCardsResp])
        rest  <- if first.totalCount <= 250 then ZIO.succeed(Nil)
                 else
                   val pages = (2 to math.ceil(first.totalCount / 250.0).toInt).toList
                   ZIO.foreach(pages)(p =>
                     get(s"$base/cards?q=set.id:$setId&pageSize=250&page=$p")
                       .flatMap(parse[ApiCardsResp])
                       .map(_.data)
                   ).map(_.flatten)
      yield first.data ++ rest

    /**
     * METHOD: sorted
     * PURPOSE: Sorts cards by collector number.
     *          Numeric numbers sort numerically (1, 2, 3 ... 251, 252).
     *          Non-numeric numbers (TG01, SWSH001) sort alphabetically after all numerics.
     *          This correctly places secret rares after the main set cards.
     *
     * @param cards  Cards to sort
     * @return       Cards in collector number order
     */
    private def sorted(cards: List[Card]): List[Card] =
      cards.sortWith((a, b) => numberLess(a.number, b.number))

    def getSets: Task[List[CardSet]] =
      repo.findAllSets.flatMap {
        case sets if sets.nonEmpty => ZIO.succeed(sets)
        case _ =>
          for
            resp <- get(s"$base/sets?orderBy=-releaseDate&pageSize=250")
                      .flatMap(parse[ApiSetsResp])
            sets  = resp.data.map(toSet)
            _    <- ZIO.foreach(sets)(repo.upsertSet)
          yield sets
      }

    def getCardsBySet(setId: String): Task[List[Card]] =
      repo.findCardsBySet(setId).flatMap {
        // All prices present — serve directly from the cache.
        case cards if cards.nonEmpty && cards.forall(_.prices.nonEmpty) =>
          ZIO.succeed(cards)

        // Cards cached but some prices missing. Only hit TCGTracking when stale (> 6 h since last
        // attempt) so cards that genuinely have no TCGTracking data don't cause a retry every load.
        case cards if cards.nonEmpty =>
          for
            stale  <- repo.isPricesFetchStale(setId)
                        // If the stale-check itself fails (column not yet migrated), default to stale
                        // so the app keeps working and prices are fetched normally.
                        .catchAll(_ => ZIO.succeed(true))
            _      <- ZIO.when(stale)(
                        repo.findSetById(setId).flatMap {
                          case Some(set) =>
                            priceService.fetchAndStorePrices(set, cards)
                              .catchAll(e => ZIO.logWarning(s"Price fetch failed for cached $setId: ${e.getMessage}"))
                              *> repo.markPricesFetched(setId)
                              *> repo.applyFallbackPrices(setId)
                                   .catchAll(e => ZIO.logWarning(s"applyFallbackPrices failed for $setId: ${e.getMessage}"))
                          case None => ZIO.unit
                        }
                      )
            updated <- repo.findCardsBySet(setId)
          yield updated

        case _ =>
          for
            apiCards <- fetchPages(setId)
            pairs     = apiCards.map(ac => (toCard(ac), fallbackNm(ac)))
                          .sortWith { case ((a, _), (b, _)) => numberLess(a.number, b.number) }
            _        <- ZIO.foreach(pairs)((c, fb) => repo.upsertCard(c, fb))
            setOpt   <- repo.findSetById(setId)
            _        <- setOpt match
                          case Some(set) =>
                            priceService.fetchAndStorePrices(set, pairs.map(_._1))
                              .catchAll(e => ZIO.logWarning(s"Price fetch failed for $setId: ${e.getMessage}"))
                              *> repo.markPricesFetched(setId)
                              *> repo.applyFallbackPrices(setId)
                                   .catchAll(e => ZIO.logWarning(s"applyFallbackPrices failed for $setId: ${e.getMessage}"))
                          case None => ZIO.unit
            // Re-read from DB so prices stored above are included in the response.
            // Without this, first-time loads always show "no price" even when prices were just stored.
            withPrices <- repo.findCardsBySet(setId)
          yield withPrices
      }

    def getCardById(id: String): Task[Option[Card]] =
      repo.findCardById(id)

    def getPriceHistory(id: String): Task[List[PriceHistoryPoint]] =
      repo.findPriceHistory(id)

    /**
     * METHOD: searchCards
     * PURPOSE: Search cards by name or collector number.
     *   Strategy:
     *     1. Query the local PostgreSQL DB (fast, covers every set the app has
     *        ever loaded).
     *     2. If the DB has no matches — most likely because this card's set has
     *        never been loaded — fall back to the pokemontcg.io API.
     *        We upsert any API results into the DB so the next search is instant.
     *     3. If the API call also fails, log and return an empty list rather than
     *        surfacing a 500 to the user.
     *
     * NOTE: The PokéTCG API wildcard query (`name:*query*`) returns cards whose
     *   names contain the search term.  We sanitize the query to letters, digits,
     *   spaces, hyphens and apostrophes before embedding it in the URL.
     *
     * @param q  Search term e.g. "Charizard" or "SWSH158"
     * @param n  Max results (default 60)
     */
    def searchCards(q: String, n: Int = 60): Task[List[Card]] =
      repo.searchCards(q, n).flatMap {
        case cards if cards.nonEmpty => ZIO.succeed(cards)
        case _ =>
          // Strip characters that would break the pokemontcg.io query syntax,
          // then search by name with wildcard matching.
          val safe = q.replaceAll("[^a-zA-Z0-9 '\\-]", "").trim
          if safe.isEmpty then ZIO.succeed(Nil)
          else
            // If query looks like a collector number (digits, optionally /total), search by number.
            // Otherwise search by name with wildcard. This fixes "119/202" returning nothing.
            val numericQ = "^(\\d+)(?:/\\d*)?$".r
            val apiQuery = numericQ.findFirstMatchIn(q.trim) match
              case Some(m) => s"number:${m.group(1)}"
              case None    => s"name:*$safe*"
            get(s"$base/cards?q=$apiQuery&pageSize=$n")
              .flatMap(parse[ApiCardsResp])
              .flatMap { resp =>
                val pairs = resp.data.map(ac => (toCard(ac), fallbackNm(ac)))
                // Upsert into the DB so subsequent searches are served locally.
                // fallback_price_nm is stored now even though it isn't applied to
                // card_prices here — the next refresh of this card's set applies it.
                ZIO.foreach(pairs)((c, fb) => repo.upsertCard(c, fb)).as(pairs.map(_._1))
              }
              .catchAll { e =>
                ZIO.logWarning(s"PokéTCG API search fallback failed for '$q': ${e.getMessage}")
                  .as(Nil)
              }
      }

    def refreshSet(setId: String): Task[Unit] =
      for
        apiCards <- fetchPages(setId)
        pairs     = apiCards.map(ac => (toCard(ac), fallbackNm(ac)))
        _        <- ZIO.foreach(pairs)((c, fb) => repo.upsertCard(c, fb))
        setOpt   <- repo.findSetById(setId)
        _        <- setOpt match
                      case Some(set) =>
                        priceService.fetchAndStorePrices(set, pairs.map(_._1))
                          .catchAll(e => ZIO.logWarning(s"Price refresh failed for $setId: ${e.getMessage}"))
                          *> repo.markPricesFetched(setId)
                          *> repo.applyFallbackPrices(setId)
                               .catchAll(e => ZIO.logWarning(s"applyFallbackPrices failed for $setId: ${e.getMessage}"))
                      case None => ZIO.unit
      yield ()

    def refreshPrices(setId: String): Task[Unit] =
      for
        cards  <- repo.findCardsBySet(setId)
        setOpt <- repo.findSetById(setId)
        _      <- setOpt match
                    case Some(set) =>
                      priceService.fetchAndStorePrices(set, cards)
                        .catchAll(e => ZIO.logWarning(s"refreshPrices: price fetch failed for $setId: ${e.getMessage}"))
                    case None =>
                      ZIO.logWarning(s"refreshPrices: set '$setId' not found in DB")
        // Mark as fetched so the 6-hour stale timer resets — next regular load uses DB cache
        _ <- repo.markPricesFetched(setId).catchAll(_ => ZIO.unit)
        _ <- repo.applyFallbackPrices(setId)
               .catchAll(e => ZIO.logWarning(s"applyFallbackPrices failed for $setId: ${e.getMessage}"))
      yield ()

    /**
     * METHOD: setIdOf
     * PURPOSE: Derives a set ID from a card ID. pokemontcg.io card IDs are
     *          "<setId>-<number>" (e.g. "sv6-66" → "sv6", "swsh12pt5gg-GG01"
     *          → "swsh12pt5gg"), so the set ID is everything before the last
     *          hyphen. Returns None for IDs with no hyphen, which can't be mapped.
     * @param cardId  A card ID
     * @return        Some(setId), or None if the ID has no derivable set
     */
    private def setIdOf(cardId: String): Option[String] =
      cardId.lastIndexOf('-') match
        case i if i > 0 => Some(cardId.substring(0, i))
        case _          => None

    def ensureCached(cardIds: List[String]): Task[Int] =
      for
        // Keep only IDs that have no catalog row yet — these are the ones at
        // risk of becoming orphans once their collection entry is saved.
        missing <- ZIO.filter(cardIds.distinct)(id => repo.findCardById(id).map(_.isEmpty))
        // Group the missing cards by set; one refresh loads the whole set.
        setIds   = missing.flatMap(setIdOf).distinct
        _       <- ZIO.foreachDiscard(setIds) { sid =>
                     refreshSet(sid).catchAll { e =>
                       ZIO.logWarning(s"ensureCached: failed to refresh set '$sid': ${e.getMessage}")
                     }
                   }
      yield setIds.size

    def refreshOrphans: Task[Int] =
      repo.findOrphanedCardIds.flatMap(ensureCached)

  /**
   * VALUE: layer
   * PURPOSE: ZLayer that provides a CardService to the rest of the app.
   *          Reads POKEMONTCG_API_KEY from environment at startup.
   *
   * @return ZLayer[CardRepository, Throwable, CardService]
   *         Needs:    CardRepository (provided by CardRepository.layer)
   *         Fails:    Throwable (very unlikely — only if env reading fails)
   *         Provides: CardService ready to use
   */
  val layer: ZLayer[CardRepository & PriceService, Throwable, CardService] =
    ZLayer.fromZIO {
      for
        repo         <- ZIO.service[CardRepository]
        priceService <- ZIO.service[PriceService]
        apiKey       <- System.env("POKEMONTCG_API_KEY").map(_.getOrElse(""))
      yield new Live(repo, priceService, apiKey)
    }
