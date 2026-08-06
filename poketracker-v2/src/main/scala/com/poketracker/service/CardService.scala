/**
 * CardService — business logic for cards and sets.
 *
 * HOW IT WORKS
 *   Sits between CardRoutes (HTTP) and CardRepository (Postgres). On a
 *   cache miss it fetches from the pokemontcg.io REST API, normalizes the
 *   response into our own Card/CardSet types (see ApiCard/ApiSet below),
 *   persists it, and layers in pricing via PriceService. All read paths
 *   (getSets, getCardsBySet, searchCards) follow the same shape: check the
 *   DB, and only hit the network on a miss or on stale pricing.
 *
 *   Network calls go through `get`, which retries with exponential
 *   backoff — pokemontcg.io is a free third-party API with no SLA and
 *   fails transiently often enough that a single-shot request would drop
 *   cards silently on a bad response.
 *
 * DEPENDS ON: CardRepository, PriceService, pokemontcg.io API,
 *   POKEMONTCG_API_KEY env var (optional — empty string just means a
 *   lower rate limit).
 */

package com.poketracker.service

import com.poketracker.models.*
import com.poketracker.repository.CardRepository
import com.poketracker.service.PriceService
import zio.*
import zio.json.*
import java.time.LocalDate

// ── pokemontcg.io response shapes ───────────────────────────────────────
// Mirrors the API's JSON exactly so a shape change on their end fails at
// the decode boundary, not deep in business logic. toCard/toSet convert
// these into our own types below.

/**
 * Every field beyond the core set defaults to empty — most only exist on
 * some card types (Trainer cards have no `hp`; only some old cards have
 * `ancientTrait`), and a card missing one must not fail to decode.
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

private case class ApiImages(small: String, large: String)

/** Same shape whether from /sets or embedded in a card response. */
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

private case class ApiSetImages(symbol: String, logo: String)

private case class ApiCardsResp(data: List[ApiCard], totalCount: Int)
private case class ApiSetsResp(data: List[ApiSet])

private given JsonDecoder[ApiImages]    = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSetImages] = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSet]       = DeriveJsonDecoder.gen
private given JsonDecoder[ApiCard]      = DeriveJsonDecoder.gen
private given JsonDecoder[ApiCardsResp] = DeriveJsonDecoder.gen
private given JsonDecoder[ApiSetsResp]  = DeriveJsonDecoder.gen

trait CardService:

  /** Newest first. Served from the DB once populated; downloads and caches on first call. */
  def getSets: Task[List[CardSet]]

  /** Sorted by collector number. Triggers a background-equivalent price refresh if stale. */
  def getCardsBySet(setId: String): Task[List[Card]]

  def getCardById(id: String): Task[Option[Card]]

  /** No backfill — only has data from whenever this card's prices started being tracked. */
  def getPriceHistory(id: String): Task[List[PriceHistoryPoint]]

  /**
   * @param q Search term (name or collector number).
   * @param n Max results.
   */
  def searchCards(q: String, n: Int = 60): Task[List[Card]]

  /** Forces a full re-download, e.g. when a new set releases. */
  def refreshSet(setId: String): Task[Unit]

  /**
   * Guarantees every given card ID exists in the catalog before something
   * saves a reference to it, by downloading the owning set for any that's
   * missing. This is the guard against orphaned owned-card rows rendering
   * blank/$0. Failures are logged, not propagated — a bad download must
   * never block the caller's save.
   * @return Number of distinct sets downloaded.
   */
  def ensureCached(cardIds: List[String]): Task[Int]

  /** Cheaper than refreshSet when only pricing, not card data, is stale. */
  def refreshPrices(setId: String): Task[Unit]

  /** One-shot repair across every user's collection. @return Sets downloaded. */
  def refreshOrphans: Task[Int]

object CardService:

  final class Live(repo: CardRepository, priceService: PriceService, apiKey: String) extends CardService:

    private val base = "https://api.pokemontcg.io/v2"

    /**
     * GET with retry. pokemontcg.io intermittently times out, 5xxs, or
     * returns 200 with an empty body — none of which indicate the data
     * doesn't exist. Retries up to 5 times with exponential backoff
     * (1s, 2s, 4s, 8s) before failing for real.
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
          // Treat empty-but-200 the same as a real failure so it gets retried.
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

    /** Prices are always left None — real prices come from TCGTracking via PriceService. */
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
     * Backup NM price pulled from pokemontcg.io's own bundled pricing —
     * no extra network call, used for cards TCGTracking's own matching
     * can't reach. Only ever fills `nm`: pokemontcg.io's data is keyed by
     * print type (Normal/Holofoil/...), not by condition, so lp/mp/hp/dmg
     * can't be honestly derived from it.
     */
    private def fallbackNm(c: ApiCard): Option[Double] =
      // Preference order confirmed against pokemontcg.io's own SDK key names.
      val variantPreference = List(
        "holofoil", "reverseHolofoil", "normal",
        "firstEditionHolofoil", "firstEditionNormal"
      )
      val fromTcgplayer = c.tcgplayer.flatMap { tp =>
        val ordered = variantPreference.flatMap(tp.prices.get) ++ tp.prices.values.toList
        ordered.flatMap(v => v.market.orElse(v.mid)).headOption
      }
      // $0 is treated as "no data," not "worthless," hence the > 0 filters below.
      fromTcgplayer.orElse(
        c.cardmarket.flatMap { cm =>
          cm.prices.averageSellPrice.filter(_ > 0)
            .orElse(cm.prices.trendPrice.filter(_ > 0))
        }
      )

    /** Numeric numbers sort numerically; non-numeric ones (TG01, SWSH001) sort after. */
    private def numberLess(a: String, b: String): Boolean =
      (a.toIntOption, b.toIntOption) match
        case (Some(x), Some(y)) => x < y
        case (Some(_), None)    => true
        case (None, Some(_))    => false
        case _                  => a < b

    private def toSet(s: ApiSet): CardSet =
      // Falls back rather than crashing the whole set on one bad date string.
      val date = scala.util.Try(LocalDate.parse(s.releaseDate.replace("/", "-")))
                   .getOrElse(LocalDate.of(2000, 1, 1))
      CardSet(s.id, s.name, s.series, s.printedTotal, s.total,
              date, SetImages(s.images.symbol, s.images.logo), s.ptcgoCode)

    /** pokemontcg.io caps responses at 250 cards/page — large sets need multiple requests. */
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
        case cards if cards.nonEmpty && cards.forall(_.prices.nonEmpty) =>
          ZIO.succeed(cards)

        // Cached but under-priced: refresh only if stale (>6h), so cards
        // TCGTracking genuinely has no data for don't retry every load.
        case cards if cards.nonEmpty =>
          for
            stale  <- repo.isPricesFetchStale(setId)
                        .catchAll(_ => ZIO.succeed(true))  // fail open on the check itself
            _      <- ZIO.when(stale)(
                        repo.findSetById(setId).flatMap {
                          case Some(set) =>
                            // Price fetch failures are logged, never block the page load.
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
            // Re-read so the prices just written are actually in the response —
            // otherwise a first-time load always shows "no price."
            withPrices <- repo.findCardsBySet(setId)
          yield withPrices
      }

    def getCardById(id: String): Task[Option[Card]] =
      repo.findCardById(id)

    def getPriceHistory(id: String): Task[List[PriceHistoryPoint]] =
      repo.findPriceHistory(id)

    /**
     * DB first; on a miss, falls back to the live API and caches the
     * result so the next search is local. API failures are logged and
     * degrade to an empty result rather than a 500.
     */
    def searchCards(q: String, n: Int = 60): Task[List[Card]] =
      repo.searchCards(q, n).flatMap {
        case cards if cards.nonEmpty => ZIO.succeed(cards)
        case _ =>
          val safe = q.replaceAll("[^a-zA-Z0-9 '\\-]", "").trim
          if safe.isEmpty then ZIO.succeed(Nil)
          else
            // A bare/slashed number is treated as a collector-number search
            // instead of a name search — otherwise e.g. "119/202" matches nothing.
            val numericQ = "^(\\d+)(?:/\\d*)?$".r
            val apiQuery = numericQ.findFirstMatchIn(q.trim) match
              case Some(m) => s"number:${m.group(1)}"
              case None    => s"name:*$safe*"
            get(s"$base/cards?q=$apiQuery&pageSize=$n")
              .flatMap(parse[ApiCardsResp])
              .flatMap { resp =>
                val pairs = resp.data.map(ac => (toCard(ac), fallbackNm(ac)))
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
        _ <- repo.markPricesFetched(setId).catchAll(_ => ZIO.unit)  // reset the 6h staleness timer regardless
        _ <- repo.applyFallbackPrices(setId)
               .catchAll(e => ZIO.logWarning(s"applyFallbackPrices failed for $setId: ${e.getMessage}"))
      yield ()

    /** pokemontcg.io card IDs are "<setId>-<number>"; splits on the last hyphen. */
    private def setIdOf(cardId: String): Option[String] =
      cardId.lastIndexOf('-') match
        case i if i > 0 => Some(cardId.substring(0, i))
        case _          => None

    def ensureCached(cardIds: List[String]): Task[Int] =
      for
        missing <- ZIO.filter(cardIds.distinct)(id => repo.findCardById(id).map(_.isEmpty))
        setIds   = missing.flatMap(setIdOf).distinct
        // One set failing doesn't stop the others from being repaired.
        _       <- ZIO.foreachDiscard(setIds) { sid =>
                     refreshSet(sid).catchAll { e =>
                       ZIO.logWarning(s"ensureCached: failed to refresh set '$sid': ${e.getMessage}")
                     }
                   }
      yield setIds.size

    def refreshOrphans: Task[Int] =
      repo.findOrphanedCardIds.flatMap(ensureCached)

  val layer: ZLayer[CardRepository & PriceService, Throwable, CardService] =
    ZLayer.fromZIO {
      for
        repo         <- ZIO.service[CardRepository]
        priceService <- ZIO.service[PriceService]
        apiKey       <- System.env("POKEMONTCG_API_KEY").map(_.getOrElse(""))
      yield new Live(repo, priceService, apiKey)
    }
