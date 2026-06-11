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
import zio.Schedule
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
 * PURPOSE: Represents one card as returned by the pokemontcg.io API.
 *          Converted to our internal Card type by toCard() before use.
 *
 * @param id      Card ID from the API e.g. "sv1-1"
 * @param name    Card name e.g. "Charizard ex"
 * @param number  Collector number e.g. "4" or "TG01"
 * @param rarity  Rarity string if present e.g. "Special Illustration Rare"
 * @param artist  Illustrator name if listed on the card
 * @param images  URLs to small and large card images
 * @param set     Reference to the set this card belongs to (contains set ID)
 */
private case class ApiCard(
  id:     String,
  name:   String,
  number: String,
  rarity: Option[String],
  artist: Option[String],
  images: ApiImages,
  set:    ApiSetRef
)

/**
 * CASE CLASS: ApiImages
 * @param small  Small card image URL (~245x342px) for grid views
 * @param large  Large card image URL (~745x1040px) for detail views
 */
private case class ApiImages(small: String, large: String)

/**
 * CASE CLASS: ApiSetRef
 * PURPOSE: The set reference embedded in each card response.
 * @param id  The set ID this card belongs to e.g. "sv1"
 */
private case class ApiSetRef(id: String)

/**
 * CASE CLASS: ApiSet
 * PURPOSE: Represents one set as returned by the pokemontcg.io API.
 *          Converted to our internal CardSet type by toSet() before use.
 *
 * @param id           Set ID e.g. "sv1", "base1"
 * @param name         Full set name e.g. "Scarlet & Violet"
 * @param series       Series name e.g. "Scarlet & Violet"
 * @param printedTotal Number on cards as denominator e.g. 165 for "4/165"
 * @param total        Actual total including secret rares. Always >= printedTotal.
 * @param releaseDate  Release date string from API — format varies, parsed safely
 * @param images       Symbol and logo image URLs
 * @param ptcgoCode    PTCG Online code e.g. "SVI" — used to match TCGTracking prices
 */
private case class ApiSet(
  id:           String,
  name:         String,
  series:       String,
  printedTotal: Int,
  total:        Int,
  releaseDate:  String,
  images:       ApiSetImages,
  ptcgoCode:    Option[String]
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
// to JSON keys automatically — no manual mapping needed.
private given JsonDecoder[ApiImages]    = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSetRef]    = DeriveJsonDecoder.gen
private given JsonDecoder[ApiCard]      = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSetImages] = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSet]       = DeriveJsonDecoder.gen
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
     *          10s connection timeout, 30s read timeout.
     *
     * @param url  The URL to fetch
     * @return     Response body, or fails with a descriptive error message
     */
    private def get(url: String): Task[String] =
      ZIO.attemptBlocking {
        val conn = java.net.URI.create(url).toURL.openConnection()
        conn.setRequestProperty("X-Api-Key", apiKey)
        conn.setConnectTimeout(15000)
        conn.setReadTimeout(60000)
        val stream = conn.getInputStream
        try new String(stream.readAllBytes()) finally stream.close()
      }.mapError(e => RuntimeException(s"GET $url failed: ${e.getMessage}"))
        // Retry once on timeout before giving up
        .retry(Schedule.once)

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
     * PURPOSE: Converts an ApiCard to our internal Card model.
     *          Prices are always None here — fetched from TCGTracking separately.
     *
     * @param c  The API card to convert
     * @return   Our internal Card
     */
    private def toCard(c: ApiCard): Card =
      Card(c.id, c.set.id, c.name, c.number, c.rarity, c.artist,
           CardImage(c.images.small, c.images.large), None)

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
      cards.sortWith { (a, b) =>
        (a.number.toIntOption, b.number.toIntOption) match
          case (Some(x), Some(y)) => x < y
          case (Some(_), None)    => true
          case (None, Some(_))    => false
          case _                  => a.number < b.number
      }

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
        case cards if cards.nonEmpty => ZIO.succeed(cards)
        case _ =>
          for
            cards  <- fetchPages(setId).map(_.map(toCard))
            result  = sorted(cards)
            _      <- ZIO.foreach(result)(repo.upsertCard)
            // Fetch and store prices from TCGTracking after caching cards.
            // We look up the set metadata to help match the TCGTracking set.
            setOpt <- repo.findSetById(setId)
            _      <- setOpt match
                        case Some(set) =>
                          priceService.fetchAndStorePrices(set, result)
                            // Price failures are non-fatal — cards still load without prices
                            .catchAll(e => ZIO.logWarning(s"Price fetch failed for $setId: ${e.getMessage}"))
                        case None => ZIO.unit
          yield result
      }

    def getCardById(id: String): Task[Option[Card]] =
      repo.findCardById(id)

    def searchCards(q: String, n: Int = 60): Task[List[Card]] =
      repo.searchCards(q, n)

    def refreshSet(setId: String): Task[Unit] =
      for
        cards  <- fetchPages(setId).map(_.map(toCard))
        _      <- ZIO.foreach(cards)(repo.upsertCard)
        setOpt <- repo.findSetById(setId)
        _      <- setOpt match
                    case Some(set) =>
                      priceService.fetchAndStorePrices(set, cards)
                        .catchAll(e => ZIO.logWarning(s"Price refresh failed for $setId: ${e.getMessage}"))
                    case None => ZIO.unit
      yield ()

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