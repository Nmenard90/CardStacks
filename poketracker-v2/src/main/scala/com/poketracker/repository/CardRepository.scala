/**
 * CardRepository — all database reads/writes for cards and sets. The only
 * place in the codebase that queries `cards` or `card_sets`.
 *
 * USED BY: CardService
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

trait CardRepository:
  def findSetById(id: String): Task[Option[CardSet]]

  /** Newest first — fills the set dropdown. */
  def findAllSets: Task[List[CardSet]]

  def findCardsBySet(setId: String): Task[List[Card]]
  def findCardById(id: String): Task[Option[Card]]

  def searchCards(query: String, limit: Int = 200): Task[List[Card]]

  /**
   * Cross-set catalog browse (the "All Sets" grid) — paginated and sorted.
   * @param sort One of "name" | "price" | "number" | "artist" | "set" — the
   *             caller (CardRoutes) whitelists this before it reaches here.
   * @param dir  "asc" or "desc".
   * @return Cards for this page, plus the total row count (for "N results" / paging).
   */
  def browseCards(sort: String, dir: String, page: Int, pageSize: Int): Task[(List[Card], Int)]

  def upsertSet(set: CardSet): Task[Unit]

  /**
   * @param fallbackPriceNm  Backup NM price pulled from pokemontcg.io's own
   *                         data, saved here so it can be applied later
   *                         (see applyFallbackPrices) without another network call.
   */
  def upsertCard(card: Card, fallbackPriceNm: Option[Double]): Task[Unit]

  /** Saves current prices and appends a permanent snapshot to the price-history table. */
  def upsertPrices(cardId: String, prices: CardPrices): Task[Unit]

  /**
   * Copies each card's saved fallback price (see upsertCard) in as its
   * real `nm`. Run after every price fetch.
   */
  def applyFallbackPrices(setId: String): Task[Int]

  def findPriceHistory(cardId: String): Task[List[PriceHistoryPoint]]

  /** True if never fetched or stale (>6h) — prevents retry-looping a set with no price data. */
  def isPricesFetchStale(setId: String): Task[Boolean]

  def markPricesFetched(setId: String): Task[Unit]

  /** Owned cards with no matching row in the catalog — render blank/$0 until backfilled. */
  def findOrphanedCardIds: Task[List[String]]

object CardRepository:

  final class Live(xa: Transactor[Task]) extends CardRepository:

    def findSetById(id: String): Task[Option[CardSet]] =
      sql"""
        SELECT id, name, series, printed_total, total,
               release_date, symbol_url, logo_url, ptcgo_code
        FROM card_sets
        WHERE id = $id
      """
        .query[(String, String, String, Int, Int, LocalDate, String, String, Option[String])]
        .option
        .map(_.map { case (id, name, series, printed, total, date, sym, logo, ptcgo) =>
          CardSet(id, name, series, printed, total, date, SetImages(sym, logo), ptcgo)
        })
        .transact(xa)

    def findAllSets: Task[List[CardSet]] =
      sql"""
        SELECT id, name, series, printed_total, total,
               release_date, symbol_url, logo_url, ptcgo_code
        FROM card_sets
        ORDER BY release_date DESC
      """
        .query[(String, String, String, Int, Int, LocalDate, String, String, Option[String])]
        .to[List]
        .map(_.map { case (id, name, series, printed, total, date, sym, logo, ptcgo) =>
          CardSet(id, name, series, printed, total, date, SetImages(sym, logo), ptcgo)
        })
        .transact(xa)

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

      // Missing or malformed details JSON degrades to None instead of failing the row.
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
          -- Purely-numeric numbers zero-padded and sorted as numbers ("9" before
          -- "10"); mixed ones (TG01) sort alphabetically after. Plain text sort
          -- alone would put "10" before "9".
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

           -- Printed numbers carry leading zeros ("025/198") but the catalog
           -- stores them unpadded ("25") — strips zeros off both sides before comparing.
           OR regexp_replace(c.number, '^0+(?=[0-9])', '') = regexp_replace($query, '^0+(?=[0-9])', '')
           OR c.number ILIKE $likeQuery

           -- Handles a query typed exactly as printed, e.g. "25/198": splits
           -- into number and set total, matches each half independently.
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

    def browseCards(sort: String, dir: String, page: Int, pageSize: Int): Task[(List[Card], Int)] =
      val asc = dir != "desc"
      // Whitelisted at the call site (CardRoutes) — never built from raw
      // user input, so Fragment.const here can't be used for injection.
      val numberExpr = "(CASE WHEN c.number ~ '^[0-9]+$' THEN LPAD(c.number, 10, '0') ELSE c.number END)"
      val orderBy = Fragment.const(sort match
        case "price"  => s"p.price_nm ${if asc then "ASC" else "DESC"} NULLS LAST, c.name ASC"
        case "artist" => s"c.artist ${if asc then "ASC" else "DESC"} NULLS LAST, c.name ASC"
        case "number" => s"$numberExpr ${if asc then "ASC" else "DESC"}"
        case "set"    => s"s.release_date ${if asc then "ASC" else "DESC"}, c.set_id, $numberExpr ASC"
        case _        => s"c.name ${if asc then "ASC" else "DESC"}"
      )
      val offset = page * pageSize

      val query = sql"""
        SELECT c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
               c.image_small, c.image_large,
               p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg,
               c.details,
               COUNT(*) OVER() AS total_count
        FROM cards c
        LEFT JOIN card_prices p ON p.card_id = c.id
        LEFT JOIN card_sets s ON s.id = c.set_id
        ORDER BY """ ++ orderBy ++ sql"""
        LIMIT $pageSize OFFSET $offset
      """

      query
        .query[(String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double],
                Option[String], Int)]
        .to[List]
        .map { rows =>
          val total = rows.headOption.map(_._15).getOrElse(0)
          val cards = rows.map { case (id, setId, name, number, rarity, artist, imgS, imgL, nm, lp, mp, hp, dmg, details, _) =>
            toCardRow(id, setId, name, number, rarity, artist, imgS, imgL, nm, lp, mp, hp, dmg, details)
          }
          (cards, total)
        }
        .transact(xa)

    def upsertSet(set: CardSet): Task[Unit] =
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
        .update.run.void.transact(xa)

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
     * pokemontcg.io's bundled price is the PRIMARY source for `nm` — it's
     * free with the same request that fetches card details, so it
     * unconditionally overwrites whatever TCGTracking found. Cards with no
     * fallback price are left untouched (TCGTracking's `nm` stands).
     * lp/mp/hp/dmg always stay TCGTracking's — pokemontcg.io only ever
     * gives one reference price, never a price per condition.
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

      // Plain insert, no upsert — every fetch adds its own row so a full
      // price-over-time history builds up.
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
      sql"""
        SELECT prices_fetched_at IS NULL
            OR prices_fetched_at < NOW() - INTERVAL '6 hours'
        FROM card_sets WHERE id = $setId
      """
        .query[Boolean]
        .option
        .map(_.getOrElse(true))  // no such set — treat as needing a fetch
        .transact(xa)

    def markPricesFetched(setId: String): Task[Unit] =
      sql"""
        UPDATE card_sets SET prices_fetched_at = NOW() WHERE id = $setId
      """
        .update.run.void.transact(xa)

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

  val layer: ZLayer[Transactor[Task], Nothing, CardRepository] =
    ZLayer.fromFunction(new Live(_))
