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

  /** One game's sets, newest first — fills the set dropdown. */
  def findAllSets(game: String): Task[List[CardSet]]

  /** The source's own id for a set (TCGTracking set id), for tcgtracking games. */
  def findExternalSetId(setId: String): Task[Option[String]]

  def findCardsBySet(setId: String): Task[List[Card]]
  def findCardById(id: String): Task[Option[Card]]

  def searchCards(query: String, limit: Int = 200, game: String = Game.DefaultId): Task[List[Card]]

  /**
   * Cross-set catalog browse (the "All Sets" grid) — paginated and sorted.
   * @param sort One of "name" | "price" | "number" | "artist" | "set" — the
   *             caller (CardRoutes) whitelists this before it reaches here.
   * @param dir  "asc" or "desc".
   * @return Cards for this page, plus the total row count (for "N results" / paging).
   */
  def browseCards(sort: String, dir: String, page: Int, pageSize: Int, game: String = Game.DefaultId): Task[(List[Card], Int)]

  /** @param externalId The source's own set id (TCGTracking), None for pokemontcg.io sets. */
  def upsertSet(set: CardSet, game: String = Game.DefaultId, externalId: Option[String] = None): Task[Unit]

  /** Batch writes for the TCGTracking importer — one transaction per call
   *  instead of one per row (a game's set list is hundreds of rows). */
  def upsertSets(sets: List[(CardSet, Option[String])], game: String): Task[Unit]
  def upsertCards(cards: List[Card]): Task[Unit]
  /** (cardId, default print's prices, every print's prices) */
  def upsertPriceBatch(rows: List[(String, CardPrices, Map[String, CardPrices])]): Task[Unit]
  def findCardIdsBySet(setId: String): Task[Set[String]]

  /**
   * @param fallbackPriceNm  Backup NM price pulled from pokemontcg.io's own
   *                         data, saved here so it can be applied later
   *                         (see applyFallbackPrices) without another network call.
   */
  def upsertCard(card: Card, fallbackPriceNm: Option[Double]): Task[Unit]

  /** Saves current prices and appends a permanent snapshot to the price-history table. */
  def upsertPrices(cardId: String, prices: CardPrices): Task[Unit]

  /** Saves each print's latest prices (card_variant_prices). No history — card_price_history stays default-print only. */
  def upsertVariantPrices(cardId: String, variants: Map[String, CardPrices]): Task[Unit]

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

  /** Every set at least one user owns a card from — what the background price refresh keeps fresh. */
  def findOwnedSetIds: Task[List[String]]

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

    def findAllSets(game: String): Task[List[CardSet]] =
      sql"""
        SELECT id, name, series, printed_total, total,
               release_date, symbol_url, logo_url, ptcgo_code
        FROM card_sets
        WHERE game_id = $game
        ORDER BY release_date DESC
      """
        .query[(String, String, String, Int, Int, LocalDate, String, String, Option[String])]
        .to[List]
        .map(_.map { case (id, name, series, printed, total, date, sym, logo, ptcgo) =>
          CardSet(id, name, series, printed, total, date, SetImages(sym, logo), ptcgo)
        })
        .transact(xa)

    def findExternalSetId(setId: String): Task[Option[String]] =
      sql"SELECT external_id FROM card_sets WHERE id = $setId".query[Option[String]].option.map(_.flatten).transact(xa)

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
        -- LATERAL + LIMIT 1, not a plain join: card_prices may hold several rows
        -- per card (Migration 003's per-variant rows), and a plain join
        -- repeats the card once per row.
        LEFT JOIN LATERAL (
          SELECT cp.price_nm, cp.price_lp, cp.price_mp, cp.price_hp, cp.price_dmg
          FROM card_prices cp WHERE cp.card_id = c.id
          ORDER BY cp.fetched_at DESC, cp.id LIMIT 1
        ) p ON TRUE
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
        .flatMap(withVariants)

    def findCardById(id: String): Task[Option[Card]] =
      sql"""
        SELECT c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
               c.image_small, c.image_large,
               p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg,
               c.details
        FROM cards c
        -- LATERAL + LIMIT 1, not a plain join: card_prices may hold several rows
        -- per card (Migration 003's per-variant rows), and a plain join
        -- repeats the card once per row.
        LEFT JOIN LATERAL (
          SELECT cp.price_nm, cp.price_lp, cp.price_mp, cp.price_hp, cp.price_dmg
          FROM card_prices cp WHERE cp.card_id = c.id
          ORDER BY cp.fetched_at DESC, cp.id LIMIT 1
        ) p ON TRUE
        WHERE c.id = $id
      """
        .query[(String, String, String, String, Option[String], Option[String],
                String, String,
                Option[Double], Option[Double], Option[Double], Option[Double], Option[Double],
                Option[String])]
        .option
        .map(_.map(toCardRow.tupled))
        .transact(xa)
        .flatMap {
          case Some(card) => withVariants(List(card)).map(_.headOption)
          case None       => ZIO.none
        }

    /** Display order for a card's prints — the plain ones first, the patterns last. */
    private val variantOrder = List("normal", "holo", "reverse", "pokeball", "masterball")

    /**
     * Fills in `variants` for these cards with one query. Cards with a single
     * print are left with an empty list — there's nothing to choose between.
     */
    private def withVariants(cards: List[Card]): Task[List[Card]] =
      if cards.isEmpty then ZIO.succeed(cards)
      else
        val ids = cards.map(_.id).toArray
        sql"""
          SELECT card_id, variant, price_nm, price_lp, price_mp, price_hp, price_dmg
          FROM card_variant_prices
          WHERE card_id = ANY($ids)
        """
          .query[(String, String, Option[Double], Option[Double], Option[Double], Option[Double], Option[Double])]
          .to[List]
          .transact(xa)
          .map { rows =>
            val byCard = rows.groupMap(_._1) { case (_, v, nm, lp, mp, hp, dmg) =>
              CardVariant(v, CardPrices(nm, lp, mp, hp, dmg))
            }
            cards.map { card =>
              val vs = byCard.getOrElse(card.id, Nil).sortBy(v => variantOrder.indexOf(v.name))
              if vs.size > 1 then card.copy(variants = vs) else card
            }
          }
          // Prints are extra detail — never fail a whole set load over them.
          .catchAll(e => ZIO.logWarning(s"withVariants failed: ${e.getMessage}").as(cards))

    def searchCards(query: String, limit: Int = 200, game: String = Game.DefaultId): Task[List[Card]] =
      val likeQuery = s"%$query%"

      sql"""
        SELECT c.id, c.set_id, c.name, c.number, c.rarity, c.artist,
               c.image_small, c.image_large,
               p.price_nm, p.price_lp, p.price_mp, p.price_hp, p.price_dmg,
               c.details
        FROM cards c
        -- LATERAL + LIMIT 1, not a plain join: card_prices may hold several rows
        -- per card (Migration 003's per-variant rows), and a plain join
        -- repeats the card once per row.
        LEFT JOIN LATERAL (
          SELECT cp.price_nm, cp.price_lp, cp.price_mp, cp.price_hp, cp.price_dmg
          FROM card_prices cp WHERE cp.card_id = c.id
          ORDER BY cp.fetched_at DESC, cp.id LIMIT 1
        ) p ON TRUE
        LEFT JOIN card_sets s ON s.id = c.set_id
        WHERE c.game_id = $game AND (
              to_tsvector('english', c.name) @@ plainto_tsquery('english', $query)
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
                    OR s.total::text = split_part($query, '/', 2))))
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

    def browseCards(sort: String, dir: String, page: Int, pageSize: Int, game: String = Game.DefaultId): Task[(List[Card], Int)] =
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
        -- LATERAL + LIMIT 1, not a plain join: card_prices may hold several rows
        -- per card (Migration 003's per-variant rows), and a plain join
        -- repeats the card once per row.
        LEFT JOIN LATERAL (
          SELECT cp.price_nm, cp.price_lp, cp.price_mp, cp.price_hp, cp.price_dmg
          FROM card_prices cp WHERE cp.card_id = c.id
          ORDER BY cp.fetched_at DESC, cp.id LIMIT 1
        ) p ON TRUE
        LEFT JOIN card_sets s ON s.id = c.set_id
        WHERE c.game_id = $game
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

    private def upsertSetIO(set: CardSet, game: String, externalId: Option[String]): ConnectionIO[Unit] =
      sql"""
        INSERT INTO card_sets (id, name, series, printed_total, total,
                               release_date, symbol_url, logo_url, ptcgo_code, game_id, external_id)
        VALUES (${set.id}, ${set.name}, ${set.series}, ${set.printedTotal}, ${set.total},
                ${set.releaseDate}, ${set.images.symbol}, ${set.images.logo}, ${set.ptcgoCode}, $game, $externalId)
        ON CONFLICT (id) DO UPDATE SET
          game_id       = EXCLUDED.game_id,
          external_id   = COALESCE(EXCLUDED.external_id, card_sets.external_id),
          name          = EXCLUDED.name,
          series        = EXCLUDED.series,
          printed_total = EXCLUDED.printed_total,
          total         = EXCLUDED.total,
          release_date  = EXCLUDED.release_date,
          symbol_url    = EXCLUDED.symbol_url,
          logo_url      = EXCLUDED.logo_url,
          ptcgo_code    = EXCLUDED.ptcgo_code
      """
        .update.run.void

    def upsertSets(sets: List[(CardSet, Option[String])], game: String): Task[Unit] =
      sets.traverse_ { case (set, ext) => upsertSetIO(set, game, ext) }.transact(xa)

    def upsertCards(cards: List[Card]): Task[Unit] =
      cards.traverse_(c => upsertCardIO(c, None)).transact(xa)

    def upsertPriceBatch(rows: List[(String, CardPrices, Map[String, CardPrices])]): Task[Unit] =
      rows.traverse_ { case (id, d, v) => upsertPricesIO(id, d) *> upsertVariantPricesIO(id, v) }.transact(xa)

    def findCardIdsBySet(setId: String): Task[Set[String]] =
      sql"SELECT id FROM cards WHERE set_id = $setId".query[String].to[List].map(_.toSet).transact(xa)

    def upsertSet(set: CardSet, game: String = Game.DefaultId, externalId: Option[String] = None): Task[Unit] =
      upsertSetIO(set, game, externalId).transact(xa)


    private def upsertCardIO(card: Card, fallbackPriceNm: Option[Double]): ConnectionIO[Unit] =
      val detailsJson = card.details.map(_.toJson)

      sql"""
        INSERT INTO cards (id, set_id, name, number, rarity, artist,
                           image_small, image_large, details, fallback_price_nm, updated_at, game_id)
        VALUES (${card.id}, ${card.setId}, ${card.name}, ${card.number},
                ${card.rarity}, ${card.artist},
                ${card.images.small}, ${card.images.large},
                $detailsJson, $fallbackPriceNm, NOW(),
                -- A card always belongs to its set's game.
                COALESCE((SELECT game_id FROM card_sets WHERE id = ${card.setId}), 'pokemon'))
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
        .update.run.void

    def upsertCard(card: Card, fallbackPriceNm: Option[Double]): Task[Unit] =
      upsertCardIO(card, fallbackPriceNm).transact(xa)


    /**
     * TCGTracking's per-condition `nm` is authoritative whenever it has one
     * — it's the source that actually breaks prices out by condition, so a
     * real TCGTracking `nm` must never be replaced by a coarser number.
     * pokemontcg.io's bundled price only fills a genuinely empty `nm` (a
     * card TCGTracking has no data for at all), which is exactly what the
     * `WHERE card_prices.price_nm IS NULL` guard on the upsert enforces —
     * previously this ran unconditionally and clobbered real TCGTracking
     * prices with the coarser fallback on every refresh.
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
        WHERE card_prices.price_nm IS NULL
      """
        .update.run.transact(xa)

    private def upsertPricesIO(cardId: String, prices: CardPrices): ConnectionIO[Unit] =
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

      (upsertLatest *> appendSnapshot).void

    def upsertPrices(cardId: String, prices: CardPrices): Task[Unit] =
      upsertPricesIO(cardId, prices).transact(xa)


    private def upsertVariantPricesIO(cardId: String, variants: Map[String, CardPrices]): ConnectionIO[Unit] =
      variants.toList.traverse_ { case (variant, p) =>
        sql"""
          INSERT INTO card_variant_prices (card_id, variant, price_nm, price_lp, price_mp,
                                           price_hp, price_dmg, fetched_at)
          VALUES ($cardId, $variant, ${p.nm}, ${p.lp}, ${p.mp}, ${p.hp}, ${p.dmg}, NOW())
          ON CONFLICT (card_id, variant) DO UPDATE SET
            price_nm   = EXCLUDED.price_nm,
            price_lp   = EXCLUDED.price_lp,
            price_mp   = EXCLUDED.price_mp,
            price_hp   = EXCLUDED.price_hp,
            price_dmg  = EXCLUDED.price_dmg,
            fetched_at = NOW()
        """.update.run.void
      }

    def upsertVariantPrices(cardId: String, variants: Map[String, CardPrices]): Task[Unit] =
      upsertVariantPricesIO(cardId, variants).transact(xa)


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

    def findOwnedSetIds: Task[List[String]] =
      sql"""
        SELECT DISTINCT c.set_id
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
      """
        .query[String]
        .to[List]
        .transact(xa)

  val layer: ZLayer[Transactor[Task], Nothing, CardRepository] =
    ZLayer.fromFunction(new Live(_))
