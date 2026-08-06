/**
 * Data types for a Pokémon card. Pure data — no database/HTTP/business logic.
 *
 * USED BY: CardRepository, CardService, CardRoutes
 */

package com.poketracker.models

import zio.json.*

final case class CardImage(small: String, large: String)

object CardImage:
  given JsonCodec[CardImage] = DeriveJsonCodec.gen[CardImage]

/** Per-condition market prices. A price is left blank rather than $0 when we simply have no data. */
final case class CardPrices(
  nm:  Option[Double],
  lp:  Option[Double],
  mp:  Option[Double],
  hp:  Option[Double],
  dmg: Option[Double]
):

  def forCondition(condition: String): Option[Double] =
    condition.toUpperCase match
      case "NM"  => nm
      case "LP"  => lp
      case "MP"  => mp
      case "HP"  => hp
      case "DMG" => dmg
      case _     => None

object CardPrices:
  given JsonCodec[CardPrices] = DeriveJsonCodec.gen[CardPrices]

/** One price snapshot at a point in time — our own price history, not real sale data. */
final case class PriceHistoryPoint(
  recordedAt: java.time.Instant,
  nm:  Option[Double],
  lp:  Option[Double],
  mp:  Option[Double],
  hp:  Option[Double],
  dmg: Option[Double]
)

object PriceHistoryPoint:
  given JsonCodec[PriceHistoryPoint] = DeriveJsonCodec.gen[PriceHistoryPoint]

// ── Card detail types ─────────────────────────────────────────────────────
// Everything pokemontcg.io returns beyond name/number/rarity/artist/images,
// captured now in case it's needed later.

final case class CardAbility(
  name: String,
  text: String,
  `type`: String  // backtick-escaped: `type` is a reserved word, this matches pokemontcg.io's key name
)
object CardAbility:
  given JsonCodec[CardAbility] = DeriveJsonCodec.gen[CardAbility]

final case class CardAttack(
  name: String,
  cost: List[String],
  convertedEnergyCost: Option[Int],
  damage: Option[String],  // text, not numeric — some attacks show "20x"
  text: Option[String]
)
object CardAttack:
  given JsonCodec[CardAttack] = DeriveJsonCodec.gen[CardAttack]

final case class CardTypeValue(`type`: String, value: String)
object CardTypeValue:
  given JsonCodec[CardTypeValue] = DeriveJsonCodec.gen[CardTypeValue]

final case class CardAncientTrait(name: String, text: String)
object CardAncientTrait:
  given JsonCodec[CardAncientTrait] = DeriveJsonCodec.gen[CardAncientTrait]

final case class TcgplayerVariantPrices(
  low: Option[Double],
  mid: Option[Double],
  high: Option[Double],
  market: Option[Double],
  directLow: Option[Double]
)
object TcgplayerVariantPrices:
  given JsonCodec[TcgplayerVariantPrices] = DeriveJsonCodec.gen[TcgplayerVariantPrices]

final case class TcgplayerInfo(
  url: Option[String],
  updatedAt: Option[String],

  // Defaults empty rather than failing decode — some cards' JSON omits
  // this entirely when there's no priced printing yet.
  prices: Map[String, TcgplayerVariantPrices] = Map.empty
)
object TcgplayerInfo:
  given JsonCodec[TcgplayerInfo] = DeriveJsonCodec.gen[TcgplayerInfo]

final case class CardmarketPrices(
  averageSellPrice: Option[Double],
  lowPrice: Option[Double],
  trendPrice: Option[Double],
  avg1: Option[Double],
  avg7: Option[Double],
  avg30: Option[Double],
  reverseHoloSell: Option[Double],
  reverseHoloLow: Option[Double],
  reverseHoloTrend: Option[Double],
  reverseHoloAvg1: Option[Double],
  reverseHoloAvg7: Option[Double],
  reverseHoloAvg30: Option[Double]
)
object CardmarketPrices:
  given JsonCodec[CardmarketPrices] = DeriveJsonCodec.gen[CardmarketPrices]
  val empty: CardmarketPrices =
    CardmarketPrices(None, None, None, None, None, None, None, None, None, None, None, None)

final case class CardmarketInfo(
  url: Option[String],
  updatedAt: Option[String],
  prices: CardmarketPrices = CardmarketPrices.empty
)
object CardmarketInfo:
  given JsonCodec[CardmarketInfo] = DeriveJsonCodec.gen[CardmarketInfo]

/** Snapshot of the set info pokemontcg.io embeds directly on a card response. */
final case class EmbeddedSetInfo(
  id: String,
  name: String,
  series: String,
  printedTotal: Int,
  total: Int,
  releaseDate: String,
  updatedAt: Option[String],
  legalities: Map[String, String],
  ptcgoCode: Option[String],
  imageSymbol: Option[String],
  imageLogo: Option[String]
)
object EmbeddedSetInfo:
  given JsonCodec[EmbeddedSetInfo] = DeriveJsonCodec.gen[EmbeddedSetInfo]

final case class CardDetails(
  supertype: Option[String],
  subtypes: List[String],
  level: Option[String],
  hp: Option[String],  // text, not numeric — not every value is a plain number
  types: List[String],
  evolvesFrom: Option[String],
  evolvesTo: List[String],
  rules: List[String],
  ancientTrait: Option[CardAncientTrait],
  regulationMark: Option[String],
  abilities: List[CardAbility],
  attacks: List[CardAttack],
  weaknesses: List[CardTypeValue],
  resistances: List[CardTypeValue],
  retreatCost: List[String],
  convertedRetreatCost: Option[Int],
  flavorText: Option[String],
  nationalPokedexNumbers: List[Int],
  legalities: Map[String, String],
  tcgplayer: Option[TcgplayerInfo],
  cardmarket: Option[CardmarketInfo],
  embeddedSet: Option[EmbeddedSetInfo]
)
object CardDetails:
  given JsonCodec[CardDetails] = DeriveJsonCodec.gen[CardDetails]

/**
 * One Pokémon TCG card — the central type of the app. Catalog fields
 * (name/number/rarity/images) come from pokemontcg.io; prices come from
 * TCGTracking. Both are fetched and cached ahead of time.
 *
 * @param number  Text, not numeric — some collector numbers aren't (e.g. "SWSH001").
 */
final case class Card(
  id:      String,
  setId:   String,
  name:    String,
  number:  String,
  rarity:  Option[String],
  artist:  Option[String],
  images:  CardImage,
  prices:  Option[CardPrices],
  details: Option[CardDetails]
)

object Card:
  given JsonCodec[Card] = DeriveJsonCodec.gen[Card]
