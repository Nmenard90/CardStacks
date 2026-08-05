/**
 * FILE: CardRepository.scala
 * PACKAGE: com.poketracker.repository
 * LOCATION: src/main/scala/com/poketracker/repository/CardRepository.scala
 *
 * PURPOSE:
 *   Handles all database read and write operations for cards and sets.
 *   This is the ONLY place in the codebase that contains SQL queries for cards.
 *   No other file should query the cards or card_sets tables directly.
 *
 * WHY REPOSITORY PATTERN?
 *   The Repository pattern separates data access from business logic.
 *   If we ever change from PostgreSQL to another database, we only change
 *   this file — nothing else in the codebase needs to change.
 *   It also makes testing easy — we can replace this with a fake repository
 *   that returns test data without needing a real database.
 *
 * HOW DOOBIE WORKS:
 *   Doobie uses sql string interpolation to build type-safe queries.
 *   Example:
 *     sql"SELECT id, name FROM cards WHERE set_id = $setId"
 *       .query[(String, String)]  // maps each row to a (String, String) tuple
 *       .to[List]                 // collects all rows into a List
 *       .transact(transactor)     // runs the query using our connection pool
 *
 *   The $setId is automatically escaped — SQL injection is impossible.
 *   The type parameter tells Doobie exactly how to map the result columns.
 *   If the types don't match the actual columns, it fails at startup not runtime.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   com.poketracker.models.*
 *     Imports Card, CardSet, CardImage, CardPrices, SetImages —
 *     the data types this repository reads and writes.
 *
 *   doobie.*
 *     Core Doobie imports:
 *       sql          — the string interpolator for writing SQL queries
 *       Query0[T]    — a query that takes no parameters and returns T
 *       Update0      — an update/insert/delete that takes no parameters
 *       ConnectionIO — a database operation that needs a connection to run
 *
 *   doobie.implicits.*
 *     Provides implicit conversions that let Doobie map SQL result columns
 *     to Scala types automatically. Without this, Doobie would not know how
 *     to convert a VARCHAR column to a Scala String, for example.
 *
 *   doobie.postgres.implicits.*
 *     Adds PostgreSQL-specific type mappings. Needed for:
 *       - UUID columns → String
 *       - TIMESTAMPTZ columns → java.time.Instant
 *       - JSONB columns → String (we parse JSON ourselves)
 *       - DATE columns → java.time.LocalDate
 *
 *   zio.*
 *     ZIO core — ZIO[R,E,A] effect type and Task shorthand.
 *
 *   zio.interop.catz.*
 *     Allows Doobie's .transact(xa) to work with ZIO's Task type.
 *     Without this import, the compiler cannot convert
 *     ConnectionIO[T] to Task[T].
 *
 *   java.time.{Instant, LocalDate}
 *     Standard JVM date/time types used in our models.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: CardService
 * DEPENDS ON: Doobie, ZIO, PostgreSQL, Card model, CardSet model
 */

package com.poketracker.repository

import com.poketracker.models.*
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import doobie.postgres.implicits.*
import doobie.util.transactor.Transactor
import zio.*
import zio.interop.catz.*
import zio.json.*
import java.time.{Instant, LocalDate}

/**
 * TRAIT: CardRepository
 *
 * PURPOSE:
 *   Defines the interface (contract) for card data access.
 *   A trait in Scala is like an interface in Java — it declares what methods
 *   exist without implementing them.
 *
 * WHY A TRAIT INSTEAD OF DIRECTLY IMPLEMENTING?
 *   Having a trait means we can have multiple implementations:
 *     - CardRepositoryLive: the real implementation that queries PostgreSQL
 *     - CardRepositoryMock: a fake implementation for unit tests
 *   Both implement the same trait so they are interchangeable.
 *   Code that uses CardRepository never needs to know which one it has.
 *
 * WHAT IS TASK[T]?
 *   Task[T] is shorthand for ZIO[Any, Throwable, T].
 *   It means: an effect that needs nothing special to run, can fail with
 *   any Throwable, and produces T on success.
 *   All repository methods return Task because database queries can fail
 *   (connection lost, query error, etc.) and we want those failures typed.
 */
trait CardRepository:

  /**
   * METHOD: findSetById
   * PURPOSE: Fetches a single set by its ID.
   * @param id  Set ID from the Pokémon TCG API e.g. "sv1", "base1"
   * @return    Some(set) if found, None if no set has that ID
   */
  def findSetById(id: String): Task[Option[CardSet]]

  /**
   * METHOD: findAllSets
   * PURPOSE: Fetches all sets ordered by release date, newest first.
   *          Used to populate the set dropdown in the UI.
   * @return  All sets in the database, newest first
   */
  def findAllSets: Task[List[CardSet]]

  /**
   * METHOD: findCardsBySet
   * PURPOSE: Fetches all cards belonging to a set, with their prices.
   *          Used when a user selects a set to view.
   * @param setId  Which set's cards to fetch
   * @return       All cards in the set, ordered by collector number
   */
  def findCardsBySet(setId: String): Task[List[Card]]

  /**
   * METHOD: findCardById
   * PURPOSE: Fetches a single card by its ID, with its prices.
   * @param id  Card ID e.g. "sv1-1", "base1-4"
   * @return    Some(card) if found, None if no card has that ID
   */
  def findCardById(id: String): Task[Option[Card]]

  /**
   * METHOD: searchCards
   * PURPOSE: Full-text search across all card names.
   *          Used by the trade analyzer search box.
   * @param query  Search term e.g. "Charizard" or "Pikachu"
   * @param limit  Maximum number of results to return (prevents huge responses)
   * @return       Matching cards ordered by relevance, newest sets first
   */
  def searchCards(query: String, limit: Int = 200): Task[List[Card]]

  /**
   * METHOD: upsertSet
   * PURPOSE: Inserts a set if it does not exist, updates it if it does.
   *          "Upsert" = Update + Insert combined.
   *          Used when refreshing set data from the Pokémon TCG API.
   * @param set  The set data to save
   * @return     Unit — we do not need a return value from write operations
   */
  def upsertSet(set: CardSet): Task[Unit]

  /**
   * METHOD: upsertCard
   * PURPOSE: Inserts a card if it does not exist, updates it if it does.
   * @param card             The card data to save (card.details is
   *                         serialized to JSON and stored verbatim)
   * @param fallbackPriceNm  A Near-Mint price derived from pokemontcg.io's
   *                         own bundled tcgplayer/cardmarket data, stored on
   *                         the card row so applyFallbackPrices can use it
   *                         later without a fresh API call. None if
   *                         pokemontcg.io has no pricing for this card.
   * @return      Unit
   */
  def upsertCard(card: Card, fallbackPriceNm: Option[Double]): Task[Unit]

  /**
   * METHOD: upsertPrices
   * PURPOSE: Inserts or updates prices for a card, and also appends a snapshot
   *          to card_price_history so a price-over-time view is possible later.
   *          Prices change frequently so this is called more often than upsertCard.
   * @param cardId  Which card's prices to update
   * @param prices  The new price data
   * @return        Unit
   */
  def upsertPrices(cardId: String, prices: CardPrices): Task[Unit]

  /**
   * METHOD: applyFallbackPrices
   * PURPOSE: Writes each card's stored fallback_price_nm (from
   *          pokemontcg.io's own tcgplayer/cardmarket data, fetched with the
   *          same request as card metadata) as its `nm` price — this is the
   *          PRIMARY nm source, unconditionally overwriting whatever
   *          TCGTracking wrote. Cards pokemontcg.io has no pricing for keep
   *          whatever nm TCGTracking found, since this only touches cards
   *          with a non-null fallback_price_nm. lp/mp/hp/dmg are always
   *          TCGTracking's, regardless — pokemontcg.io never provides
   *          per-condition pricing, only a single reference price. Run
   *          after every price fetch.
   * @param setId  The set to patch
   * @return       Number of cards patched (for logging)
   */
  def applyFallbackPrices(setId: String): Task[Int]

  /**
   * METHOD: findPriceHistory
   * PURPOSE: Every price snapshot ever recorded for a card, oldest first.
   *          Populated going forward from whenever upsertPrices starts being
   *          called for that card — there is no historical backfill.
   * @param cardId  The card to fetch history for
   * @return        Snapshots ordered oldest to newest
   */
  def findPriceHistory(cardId: String): Task[List[PriceHistoryPoint]]

  /**
   * METHOD: isPricesFetchStale
   * PURPOSE: Returns true if prices have never been fetched for this set, or were
   *          last fetched more than 6 hours ago. Used by getCardsBySet to decide
   *          whether to call TCGTracking again or serve the cached (partial) result.
   *          Prevents an infinite-retry loop when a set has cards that TCGTracking
   *          simply has no data for.
   * @param setId  The set to check
   * @return       true = should fetch; false = skip (recently fetched)
   */
  def isPricesFetchStale(setId: String): Task[Boolean]

  /**
   * METHOD: markPricesFetched
   * PURPOSE: Records NOW() as the last price-fetch timestamp for a set.
   *          Called after every fetchAndStorePrices attempt (success or not) so
   *          the stale check knows we tried and won't retry for 6 hours.
   * @param setId  The set that was just attempted
   * @return       Unit
   */
  def markPricesFetched(setId: String): Task[Unit]

  /**
   * METHOD: findOrphanedCardIds
   * PURPOSE: Returns the IDs of every card that a user owns (appears in
   *          collection_entries) but that has no matching row in the cards
   *          catalog. These "orphans" are why owned cards can render blank or
   *          $0 — the catalog row that holds their name/number/price is missing.
   *          Used by the repair endpoint to find which cards need backfilling.
   * @return  Distinct list of orphaned card IDs across all users
   */
  def findOrphanedCardIds: Task[List[String]]

/**
 * OBJECT: CardRepository
 *
 * PURPOSE:
 *   Contains the live implementation of CardRepository and the ZLayer
 *   that provides it as a dependency.
 *
 * WHAT IS A ZLAYER?
 *   ZLayer is ZIO's dependency injection system.
 *   Instead of passing a database connection to every function manually,
 *   we define a ZLayer that says "to create a CardRepository, you need
 *   a Transactor". ZIO then wires everything together automatically.
 *   This is cleaner than passing dependencies manually through every function.
 */
object CardRepository:

  /**
   * CLASS: Live
   *
   * PURPOSE:
   *   The real implementation of CardRepository that queries PostgreSQL.
   *   All SQL queries live here and nowhere else.
   *
   * @param xa  The database Transactor — our connection pool.
   *            Injected by ZIO's dependency system, not passed manually.
   */
  final class Live(xa: Transactor[Task]) extends CardRepository:

    /**
     * HOW DOOBIE MAPS ROWS TO CASE CLASSES:
     *   Doobie can automatically map SQL result columns to a case class
     *   if the columns are in the same order as the case class fields.
     *   We use Read[T] instances which Doobie derives automatically
     *   for case classes whose fields have known mappings.
     *
     *   For nested case classes (like Card which contains CardImage),
     *   we map to a flat tuple first then construct the nested object.
     */

    def findSetById(id: String): Task[Option[CardSet]] =
      sql"""
        SELECT id, name, series, printed_total, total,
               release_date, symbol_url, logo_url, ptcgo_code
        FROM card_sets
        WHERE id = $id
      """
        // .query[T] tells Doobie what type to map each row to.
        // We map to a flat tuple matching the SELECT columns exactly.
        .query[(String, String, String, Int, Int, LocalDate, String, String, Option[String])]
        // .option returns Some(row) if found, None if not found.
        // Alternative to .to[List] when we expect at most one result.
        .option
        // .map transforms the Option[tuple] into Option[CardSet].
        // We construct the nested SetImages object here.
        .map(_.map { case (id, name, series, printed, total, date, sym, logo, ptcgo) =>
          CardSet(id, name, series, printed, total, date, SetImages(sym, logo), ptcgo)
        })
        // .transact(xa) runs this ConnectionIO on our connection pool
        // and converts it to a Task[Option[CardSet]].
        .transact(xa)

    def findAllSets: Task[List[CardSet]] =
      sql"""
        SELECT id, name, series, printed_total, total,
               release_date, symbol_url, logo_url, ptcgo_code
        FROM card_sets
        ORDER BY release_date DESC
      """
        .query[(String, String, String, Int, Int, LocalDate, String, String, Option[String])]
        // .to[List] collects all result rows into a Scala List.
        .to[List]
        .map(_.map { case (id, name, series, printed, total, date, sym, logo, ptcgo) =>
          CardSet(id, name, series, printed, total, date, SetImages(sym, logo), ptcgo)
        })
        .transact(xa)

    /**
     * METHOD: toCardRow (Live, private)
     * PURPOSE: Shared row->Card mapping for findCardsBySet/findCardById/
     *          searchCards, all of which SELECT the same column set.
     *          details is stored as a JSON TEXT column — decoded back via
     *          zio-json; any card predating this column, or a row that
     *          somehow fails to parse, just gets details = None rather than
     *          failing the whole query.
     */
    private def toCardRow(
      id: String, setId: String, name: String, number: String,
      rarity: Option[String], artist: Option[String],
      imgSmall: String, imgLarge: String,
      nm: Option[Double], lp: Option[Double], mp: Option[Double], hp: Option[Double], dmg: Option[Double],
      detailsJson: Option[String]
    ): Card =
      val prices = if nm.orElse(lp).orElse(mp).orElse(hp).orElse(dmg).isDefined
                   then Some(CardPrices(nm, lp, mp, hp, dmg))
                   else None
      val details = detailsJson.flatMap(_.fromJson[CardDetails].toOption)
      Card(id, setId, name, number, rarity, artist,
           CardImage(imgSmall, imgLarge), prices, details)

    def findCardsBySet(setId: String): Task[List[Card]] =
      sql"""
        SELECT c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
               c.image_small, c.image_large,
               p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg,
               c.details
        FROM cards c
        LEFT JOIN card_prices p ON p.card_id = c.id
        WHERE c.set_id = $setId
        ORDER BY
          -- Sort numerically when possible, alphabetically for non-numeric numbers
          CASE WHEN c.number ~ '^[0-9]+$$' THEN LPAD(c.number, 10, '0')
               ELSE c.number
          END
      """
        .query[(String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double],
                Option[String])]
        .to[List]
        .map(_.map(toCardRow.tupled))
        .transact(xa)

    def findCardById(id: String): Task[Option[Card]] =
      sql"""
        SELECT c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
               c.image_small, c.image_large,
               p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg,
               c.details
        FROM cards c
        LEFT JOIN card_prices p ON p.card_id = c.id
        WHERE c.id = $id
      """
        .query[(String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double],
                Option[String])]
        .option
        .map(_.map(toCardRow.tupled))
        .transact(xa)

    def searchCards(query: String, limit: Int = 200): Task[List[Card]] =
      // to_tsvector/plainto_tsquery is PostgreSQL's full-text search.
      // It handles stemming (searching "Charizard" finds "Charizards"),
      // ranking by relevance, and is much faster than LIKE '%query%'.
      // likeQuery wraps the search term with % wildcards for the ILIKE fallback.
      val likeQuery = s"%$query%"
      sql"""
        SELECT c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
               c.image_small, c.image_large,
               p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg,
               c.details
        FROM cards c
        LEFT JOIN card_prices p ON p.card_id = c.id
        LEFT JOIN card_sets s ON s.id = c.set_id
        WHERE to_tsvector('english', c.name) @@ plainto_tsquery('english', $query)
           OR c.name ILIKE $likeQuery
           OR LOWER(c.number) = LOWER($query)
           -- Printed collector numbers carry leading zeros ("025/198") but the
           -- catalog stores numbers as pokemontcg.io returns them, unpadded
           -- ("25"). Compare with leading zeros stripped so a search for the
           -- number exactly as printed on the card still finds it.
           OR regexp_replace(c.number, '^0+(?=[0-9])', '') = regexp_replace($query, '^0+(?=[0-9])', '')
           OR c.number ILIKE $likeQuery
           OR (position('/' in $query) > 0
               AND (LOWER(c.number) = LOWER(split_part($query, '/', 1))
                    OR regexp_replace(c.number, '^0+(?=[0-9])', '')
                       = regexp_replace(split_part($query, '/', 1), '^0+(?=[0-9])', ''))
               AND (s.printed_total::text = split_part($query, '/', 2)
                    OR s.total::text = split_part($query, '/', 2)))
        ORDER BY (LOWER(c.number) = LOWER($query)) DESC,
                 (LOWER(c.name) = LOWER($query)) DESC,
                 s.release_date DESC, c.number
        LIMIT $limit
      """
        .query[(String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double],
                Option[String])]
        .to[List]
        .map(_.map(toCardRow.tupled))
        .transact(xa)

    def upsertSet(set: CardSet): Task[Unit] =
      // ON CONFLICT DO UPDATE means: if a set with this id already exists,
      // update its fields instead of failing with a duplicate key error.
      // This is the "upsert" pattern — safe to call repeatedly.
      sql"""
        INSERT INTO card_sets (id, name, series, printed_total, total,
                               release_date, symbol_url, logo_url, ptcgo_code)
        VALUES (${set.id}, ${set.name}, ${set.series}, ${set.printedTotal}, ${set.total},
                ${set.releaseDate}, ${set.images.symbol}, ${set.images.logo}, ${set.ptcgoCode})
        ON CONFLICT (id) DO UPDATE SET
          name          = EXCLUDED.name,
          series        = EXCLUDED.series,
          printed_total = EXCLUDED.printed_total,
          total         = EXCLUDED.total,
          release_date  = EXCLUDED.release_date,
          symbol_url    = EXCLUDED.symbol_url,
          logo_url      = EXCLUDED.logo_url,
          ptcgo_code    = EXCLUDED.ptcgo_code
      """
        .update
        // .run executes the update and returns the number of affected rows.
        // We discard the row count with .void since we do not need it.
        .run
        .void
        .transact(xa)

    def upsertCard(card: Card, fallbackPriceNm: Option[Double]): Task[Unit] =
      val detailsJson = card.details.map(_.toJson)
      sql"""
        INSERT INTO cards (id, set_id, name, number, rarity, artist,
                           image_small, image_large, details, fallback_price_nm, updated_at)
        VALUES (${card.id}, ${card.setId}, ${card.name}, ${card.number},
                ${card.rarity}, ${card.artist},
                ${card.images.small}, ${card.images.large},
                $detailsJson, $fallbackPriceNm, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name              = EXCLUDED.name,
          number            = EXCLUDED.number,
          rarity            = EXCLUDED.rarity,
          artist            = EXCLUDED.artist,
          image_small       = EXCLUDED.image_small,
          image_large       = EXCLUDED.image_large,
          details           = EXCLUDED.details,
          fallback_price_nm = EXCLUDED.fallback_price_nm,
          updated_at        = NOW()
      """
        .update.run.void.transact(xa)

    /**
     * METHOD: applyFallbackPrices (Live)
     * PURPOSE: pokemontcg.io's own bundled pricing is PRIMARY for `nm` —
     *          it's fetched with the same request as card metadata (zero
     *          extra network calls, zero TCGTracking set-matching risk), so
     *          it unconditionally overwrites whatever TCGTracking wrote.
     *          TCGTracking's `nm` only survives for cards pokemontcg.io has
     *          no pricing for at all (this INSERT...SELECT simply produces
     *          no row for those card_ids, so nothing here touches them).
     *          lp/mp/hp/dmg are untouched either way — pokemontcg.io never
     *          provides per-condition data, only a single reference price,
     *          so TCGTracking remains the sole source for those tiers.
     */
    def applyFallbackPrices(setId: String): Task[Int] =
      sql"""
        INSERT INTO card_prices (card_id, price_nm)
        SELECT id, fallback_price_nm FROM cards
        WHERE set_id = $setId AND fallback_price_nm IS NOT NULL
        ON CONFLICT (card_id) DO UPDATE SET
          price_nm = EXCLUDED.price_nm
      """
        .update.run.transact(xa)

    def upsertPrices(cardId: String, prices: CardPrices): Task[Unit] =
      val upsertLatest = sql"""
        INSERT INTO card_prices (card_id, price_nm, price_lp, price_mp,
                                  price_hp, price_dmg, fetched_at)
        VALUES ($cardId, ${prices.nm}, ${prices.lp}, ${prices.mp},
                ${prices.hp}, ${prices.dmg}, NOW())
        ON CONFLICT (card_id) DO UPDATE SET
          price_nm   = EXCLUDED.price_nm,
          price_lp   = EXCLUDED.price_lp,
          price_mp   = EXCLUDED.price_mp,
          price_hp   = EXCLUDED.price_hp,
          price_dmg  = EXCLUDED.price_dmg,
          fetched_at = NOW()
      """.update.run
      // Append-only: every fetch gets its own row so price-over-time is possible.
      val appendSnapshot = sql"""
        INSERT INTO card_price_history (card_id, price_nm, price_lp, price_mp, price_hp, price_dmg)
        VALUES ($cardId, ${prices.nm}, ${prices.lp}, ${prices.mp}, ${prices.hp}, ${prices.dmg})
      """.update.run
      (upsertLatest *> appendSnapshot).void.transact(xa)

    def findPriceHistory(cardId: String): Task[List[PriceHistoryPoint]] =
      sql"""
        SELECT recorded_at, price_nm, price_lp, price_mp, price_hp, price_dmg
        FROM card_price_history
        WHERE card_id = $cardId
        ORDER BY recorded_at ASC
      """
        .query[(Instant, Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])]
        .to[List]
        .map(_.map { case (t, nm, lp, mp, hp, dmg) => PriceHistoryPoint(t, nm, lp, mp, hp, dmg) })
        .transact(xa)

    def isPricesFetchStale(setId: String): Task[Boolean] =
      // prices_fetched_at IS NULL means never attempted; < 6 hours ago means recent enough.
      // Falls back to true (stale) if the set row doesn't exist — shouldn't happen in practice.
      sql"""
        SELECT prices_fetched_at IS NULL
            OR prices_fetched_at < NOW() - INTERVAL '6 hours'
        FROM card_sets WHERE id = $setId
      """
        .query[Boolean]
        .option
        .map(_.getOrElse(true))
        .transact(xa)

    def markPricesFetched(setId: String): Task[Unit] =
      sql"""
        UPDATE card_sets SET prices_fetched_at = NOW() WHERE id = $setId
      """
        .update.run.void.transact(xa)

    /**
     * METHOD: findOrphanedCardIds (Live)
     * PURPOSE: Left-joins collection_entries against cards and returns the
     *          card IDs that have no catalog row. These are the cards whose
     *          set was never loaded, so they render blank/$0 until backfilled.
     * @return  Distinct orphaned card IDs across all users
     */
    def findOrphanedCardIds: Task[List[String]] =
      sql"""
        SELECT DISTINCT ce.card_id
        FROM collection_entries ce
        LEFT JOIN cards c ON c.id = ce.card_id
        WHERE c.id IS NULL
      """
        .query[String]
        .to[List]
        .transact(xa)

  /**
   * VALUE: layer
   *
   * PURPOSE:
   *   Creates a ZLayer that provides a CardRepository.
   *   ZLayer.fromFunction creates a layer by calling a function with
   *   its dependencies already provided.
   *
   * HOW TO READ ZLayer[Transactor[Task], Nothing, CardRepository]:
   *   Transactor[Task]  = what this layer needs to create a CardRepository
   *   Nothing           = this layer cannot fail (construction is safe)
   *   CardRepository    = what this layer provides
   *
   * USAGE IN Main.scala:
   *   We will provide this layer to our app so ZIO can inject it wherever
   *   a CardRepository is needed.
   */
  val layer: ZLayer[Transactor[Task], Nothing, CardRepository] =
    ZLayer.fromFunction(new Live(_))