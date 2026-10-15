/**
 * A card game the app supports (migration 016). Each game is its own world:
 * a user's collection, boxes, binders, Spaces and offers are kept separate
 * per game.
 *
 * USED BY: GameRepository, CardService, TcgTrackingCatalog, GameRoutes
 */

package com.poketracker.models

import zio.json.*

/**
 * @param source          "pokemontcg" (English Pokémon via pokemontcg.io) or
 *                        "tcgtracking" (cards, images and prices from TCGTracking).
 * @param category        TCGTracking's category id (3 Pokémon, 85 Pokémon Japan, 1 Magic...).
 * @param printPreference Which printing's price is a card's default price,
 *                        first match wins (e.g. Normal, then Holofoil).
 */
final case class Game(
  id:              String,
  name:            String,
  shortName:       String,
  source:          String,
  category:        Int,
  enabled:         Boolean,
  position:        Int,
  printPreference: List[String],
  hasFirstEdition: Boolean,
  /** Cardmarket's game id for its public price guide (fallback prices). */
  cardmarketGame:  Option[Int] = None
):
  def isTcgTracking: Boolean = source == Game.TcgTracking

object Game:
  val PokemonTcg  = "pokemontcg"
  val TcgTracking = "tcgtracking"
  /** The game every pre-016 row belongs to, and the default when a request names none. */
  val DefaultId   = "pokemon"

  /** Slugs are lowercase letters, digits and dashes — anything else falls back to the default. */
  def sanitize(raw: Option[String]): String =
    raw.map(_.trim.toLowerCase).filter(_.matches("[a-z0-9-]{1,32}")).getOrElse(DefaultId)

  given JsonCodec[Game] = DeriveJsonCodec.gen[Game]
