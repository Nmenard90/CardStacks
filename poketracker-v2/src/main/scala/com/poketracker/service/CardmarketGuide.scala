/**
 * CardmarketGuide — Cardmarket's public daily price guide, the fallback when
 * TCGplayer (via TCGTracking) has no market price for a card.
 *
 * HOW IT WORKS
 *   Cardmarket publishes one JSON file per game, no key needed:
 *   downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_{game}.json
 *   (6 Pokémon incl. Japanese, 18 One Piece, 19 Lorcana, 1 Magic, 3 Yu-Gi-Oh).
 *   It's fetched at most every 12h per game and kept in memory as
 *   productId → one representative EUR price: the median of the trend and
 *   7/30-day/overall averages, else the holo/foil trend. `low` (cheapest listing) is
 *   deliberately not used — one mispriced listing would become the price.
 *
 * USED BY: TcgTrackingCatalog
 */

package com.poketracker.service

import zio.*
import zio.json.*

trait CardmarketGuide:
  /** productId → EUR price for a Cardmarket game; empty if the file can't be fetched. */
  def prices(cardmarketGame: Int): UIO[Map[Int, Double]]

object CardmarketGuide:

  private case class Entry(
    idProduct: Int,
    trend: Option[Double], avg30: Option[Double], avg7: Option[Double], avg: Option[Double],
    @jsonField("trend-holo") trendHolo: Option[Double],
    @jsonField("trend-foil") trendFoil: Option[Double]
  ):
    /** The middle of the trend and the 7/30-day and overall averages — one
     *  odd recent sale swings `trend` a lot on thinly traded cards. Falls
     *  back to the holo/foil trend for products only sold in that finish. */
    def best: Option[Double] =
      List(trend, avg30, avg7, avg).flatten.filter(_ > 0).sorted match
        case Nil => List(trendHolo, trendFoil).flatten.find(_ > 0)
        case xs  => Some(if xs.size % 2 == 1 then xs(xs.size / 2) else (xs(xs.size / 2 - 1) + xs(xs.size / 2)) / 2)
  private given JsonDecoder[Entry] = DeriveJsonDecoder.gen
  private case class Guide(priceGuides: List[Entry])
  private given JsonDecoder[Guide] = DeriveJsonDecoder.gen

  private[service] def parse(body: String): Either[String, Map[Int, Double]] =
    body.fromJson[Guide].map(_.priceGuides.flatMap(e => e.best.map(e.idProduct -> _)).toMap)

  final class Live(cache: Ref[Map[Int, (java.time.Instant, Map[Int, Double])]]) extends CardmarketGuide:

    private def download(game: Int): Task[Map[Int, Double]] =
      ZIO.attemptBlocking {
        val url = s"https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_$game.json"
        val conn = java.net.URI.create(url).toURL.openConnection()
        conn.setRequestProperty("User-Agent", "CardStacks/1.0")
        conn.setConnectTimeout(15000)
        conn.setReadTimeout(120000)
        val in = conn.getInputStream
        try new String(in.readAllBytes(), "UTF-8") finally in.close()
      }.flatMap(body => ZIO.fromEither(parse(body)).mapError(e => RuntimeException(s"Cardmarket guide $game: $e")))

    def prices(game: Int): UIO[Map[Int, Double]] =
      val now = java.time.Instant.now()
      cache.get.flatMap { m =>
        m.get(game) match
          case Some((at, p)) if at.isAfter(now.minusSeconds(12 * 3600)) => ZIO.succeed(p)
          case stale =>
            download(game)
              .tap(p => cache.update(_.updated(game, (now, p))))
              .catchAll(e => ZIO.logWarning(e.getMessage).as(stale.map(_._2).getOrElse(Map.empty)))
      }

  val layer: ULayer[CardmarketGuide] =
    ZLayer.fromZIO(Ref.make(Map.empty[Int, (java.time.Instant, Map[Int, Double])]).map(new Live(_)))
