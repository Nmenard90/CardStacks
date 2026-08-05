/**
 * FILE: Card.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/Card.scala
 *
 * PURPOSE:
 *   Defines the data types that represent a Pokémon card in our system.
 *   These are pure data classes — they hold information and do nothing else.
 *   No database logic, no HTTP logic, no business rules live here.
 *
 * WHY SEPARATE MODELS FROM EVERYTHING ELSE?
 *   This is the Single Responsibility Principle — each file has exactly one job.
 *   A Card model's job is to describe what a Card IS (its data shape).
 *   How to store it, how to serve it over HTTP, how to price it — those are
 *   separate concerns that live in separate files.
 *   This makes it easy to change one thing without breaking others.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTS EXPLAINED:
 *
 *   zio.json.*
 *     Imports all ZIO JSON annotations and derivation tools.
 *     We use two things from this import:
 *       @jsonField("fieldName")  — maps a Scala field name to a JSON key name
 *                                  e.g. setId in Scala becomes "set_id" in JSON
 *       JsonCodec                — the typeclass that knows how to convert a
 *                                  type to and from JSON
 *       DeriveJsonCodec.gen[T]   — automatically generates a JsonCodec for
 *                                  any case class T without us writing the
 *                                  conversion code manually
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * USED BY: CardRepository, CardService, CardRoutes
 * DEPENDS ON: zio-json
 */

package com.poketracker.models

import zio.json.*

/**
 * CASE CLASS: CardImage
 *
 * PURPOSE:
 *   Holds the URLs for a card's images.
 *   The Pokémon TCG API provides two sizes — we store both.
 *
 * WHY A SEPARATE CLASS FOR IMAGES?
 *   The JSON from the Pokémon TCG API nests image URLs inside an "images"
 *   object: {"images": {"small": "...", "large": "..."}}
 *   Having a separate CardImage class mirrors this structure exactly,
 *   making serialization and deserialization automatic.
 *
 * @param small  URL to the small card image (~245×342 pixels).
 *               Used in card grid views where many cards are shown at once.
 * @param large  URL to the large card image (~745×1040 pixels).
 *               Used when a user clicks a card to see full detail.
 */
final case class CardImage(
  small: String,
  large: String
)

object CardImage:
  /**
   * GIVEN: JsonCodec[CardImage]
   *
   * PURPOSE:
   *   Tells ZIO JSON how to convert CardImage to and from JSON.
   *   "given" is Scala 3's keyword for providing a typeclass instance.
   *   DeriveJsonCodec.gen automatically generates the conversion code
   *   by inspecting the case class fields at compile time.
   *
   * WHAT THIS ENABLES:
   *   Any time ZIO JSON needs to encode or decode a CardImage
   *   (including when it is nested inside another class like Card),
   *   it will use this automatically — no manual conversion needed.
   */
  given JsonCodec[CardImage] = DeriveJsonCodec.gen[CardImage]

/**
 * CASE CLASS: CardPrices
 *
 * PURPOSE:
 *   Holds the market prices for a card in each condition.
 *   All fields are Option[Double] because not every card has pricing
 *   data available for every condition.
 *
 * WHY OPTION[DOUBLE] INSTEAD OF JUST DOUBLE?
 *   Option[T] in Scala means "this value might exist or might not".
 *     Some(12.50) means the price is $12.50
 *     None        means we have no price data for this condition
 *   This is safer than using 0.0 for "unknown" because:
 *     - 0.0 is a valid price (some cards are worth almost nothing)
 *     - None makes the absence of data explicit and impossible to confuse
 *       with a real price of zero
 *
 * CONDITIONS:
 *   NM  = Near Mint       — essentially perfect condition
 *   LP  = Lightly Played  — minor wear, still looks good
 *   MP  = Moderately Played — noticeable wear
 *   HP  = Heavily Played  — significant wear
 *   DMG = Damaged         — poor condition
 *
 * @param nm   Near Mint price in USD
 * @param lp   Lightly Played price in USD
 * @param mp   Moderately Played price in USD
 * @param hp   Heavily Played price in USD
 * @param dmg  Damaged price in USD
 */
final case class CardPrices(
  nm:  Option[Double],
  lp:  Option[Double],
  mp:  Option[Double],
  hp:  Option[Double],
  dmg: Option[Double]
):
  /**
   * METHOD: forCondition
   *
   * PURPOSE:
   *   Returns the price for a given condition string.
   *   Centralizes the condition-to-price lookup so it is not repeated
   *   throughout the codebase.
   *
   * @param condition  One of "NM", "LP", "MP", "HP", "DMG"
   * @return           Some(price) if we have data, None if not
   */
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

/**
 * CASE CLASS: PriceHistoryPoint
 *
 * PURPOSE:
 *   One snapshot of a card's per-condition prices at a point in time.
 *   card_price_history keeps every snapshot ever fetched (card_prices only
 *   keeps the latest), so plotting these over time gives a price history
 *   chart even though we have no access to real TCGplayer/eBay sold-price
 *   history — this is our own price *at the times we happened to check it*.
 *
 * @param recordedAt  When this snapshot was fetched
 * @param nm/lp/mp/hp/dmg  Per-condition prices at that time, same as CardPrices
 */
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

/**
 * CARD DETAIL TYPES
 *
 * PURPOSE:
 *   Everything pokemontcg.io returns for a card beyond the handful of
 *   fields (name/number/rarity/artist/images) the rest of the app actually
 *   uses day to day. Captured in full so the data is there even before we
 *   have a use for it — cheaper to store once now than to re-fetch later.
 *   Field set validated by sampling ~700 cards across supertypes (Pokémon/
 *   Trainer/Energy), eras (1999 Base Set through 2026), and special
 *   mechanics (GX, VMAX, Tag Team, Ancient Trait, regulation marks).
 */
final case class CardAbility(name: String, text: String, `type`: String)
object CardAbility:
  given JsonCodec[CardAbility] = DeriveJsonCodec.gen[CardAbility]

final case class CardAttack(
  name: String, cost: List[String], convertedEnergyCost: Option[Int],
  damage: Option[String], text: Option[String]
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
  low: Option[Double], mid: Option[Double], high: Option[Double],
  market: Option[Double], directLow: Option[Double]
)
object TcgplayerVariantPrices:
  given JsonCodec[TcgplayerVariantPrices] = DeriveJsonCodec.gen[TcgplayerVariantPrices]

final case class TcgplayerInfo(
  url: Option[String], updatedAt: Option[String],
  prices: Map[String, TcgplayerVariantPrices]
)
object TcgplayerInfo:
  given JsonCodec[TcgplayerInfo] = DeriveJsonCodec.gen[TcgplayerInfo]

final case class CardmarketPrices(
  averageSellPrice: Option[Double], lowPrice: Option[Double], trendPrice: Option[Double],
  avg1: Option[Double], avg7: Option[Double], avg30: Option[Double],
  reverseHoloSell: Option[Double], reverseHoloLow: Option[Double], reverseHoloTrend: Option[Double],
  reverseHoloAvg1: Option[Double], reverseHoloAvg7: Option[Double], reverseHoloAvg30: Option[Double]
)
object CardmarketPrices:
  given JsonCodec[CardmarketPrices] = DeriveJsonCodec.gen[CardmarketPrices]

final case class CardmarketInfo(
  url: Option[String], updatedAt: Option[String], prices: CardmarketPrices
)
object CardmarketInfo:
  given JsonCodec[CardmarketInfo] = DeriveJsonCodec.gen[CardmarketInfo]

/**
 * CASE CLASS: EmbeddedSetInfo
 * PURPOSE: Snapshot of the `set` object as embedded on THIS card's own
 *          pokemontcg.io response — independent of, and a cross-check
 *          against, our own card_sets table. releaseDate/updatedAt are kept
 *          as raw strings (not parsed to LocalDate) since this is a
 *          store-as-is snapshot, not something the app computes with.
 */
final case class EmbeddedSetInfo(
  id: String, name: String, series: String,
  printedTotal: Int, total: Int, releaseDate: String, updatedAt: Option[String],
  legalities: Map[String, String], ptcgoCode: Option[String],
  imageSymbol: Option[String], imageLogo: Option[String]
)
object EmbeddedSetInfo:
  given JsonCodec[EmbeddedSetInfo] = DeriveJsonCodec.gen[EmbeddedSetInfo]

final case class CardDetails(
  supertype: Option[String], subtypes: List[String], level: Option[String],
  hp: Option[String], types: List[String],
  evolvesFrom: Option[String], evolvesTo: List[String],
  rules: List[String], ancientTrait: Option[CardAncientTrait],
  regulationMark: Option[String],
  abilities: List[CardAbility], attacks: List[CardAttack],
  weaknesses: List[CardTypeValue], resistances: List[CardTypeValue],
  retreatCost: List[String], convertedRetreatCost: Option[Int],
  flavorText: Option[String], nationalPokedexNumbers: List[Int],
  legalities: Map[String, String],
  tcgplayer: Option[TcgplayerInfo], cardmarket: Option[CardmarketInfo],
  embeddedSet: Option[EmbeddedSetInfo]
)
object CardDetails:
  given JsonCodec[CardDetails] = DeriveJsonCodec.gen[CardDetails]



/**
 * CASE CLASS: Card
 *
 * PURPOSE:
 *   Represents a single Pokémon TCG card with all its metadata and pricing.
 *   This is the central data type of the entire application.
 *
 * WHERE DOES THIS DATA COME FROM?
 *   Card metadata (name, number, rarity, images) comes from the
 *   Pokémon TCG API (api.pokemontcg.io).
 *   Pricing comes from TCGTracking.
 *   Both are fetched by the server and stored in our database.
 *
 * @param id        Unique identifier from the Pokémon TCG API.
 *                  Format: setId-number, e.g. "sv1-1", "base1-4"
 *                  This is our primary key for cards.
 *
 * @param setId     The ID of the set this card belongs to.
 *                  e.g. "sv1" for Scarlet & Violet Base Set
 *                  Foreign key — references the sets table.
 *
 * @param name      The card's name as printed on the card.
 *                  e.g. "Charizard ex", "Pikachu", "Professor's Research"
 *
 * @param number    The card's collector number within its set.
 *                  e.g. "4", "251", "TG01"
 *                  Note: stored as String because some numbers are not
 *                  purely numeric (e.g. promo numbers like "SWSH001")
 *
 * @param rarity    The card's rarity as printed on the card.
 *                  e.g. "Common", "Rare Holo", "Special Illustration Rare"
 *                  Option because some cards (Energy, tokens) have no rarity.
 *
 * @param artist    The illustrator's name.
 *                  Option because not all cards list an artist.
 *
 * @param images    URLs to the card's small and large images.
 *
 * @param prices    Per-condition market prices. None if no pricing data exists.
 *
 * @param details   Everything else pokemontcg.io returns for this card
 *                  (supertype, attacks, abilities, its own tcgplayer/
 *                  cardmarket pricing, etc.) — see CardDetails above.
 *                  None only if the card predates this field being added
 *                  and hasn't been re-fetched since.
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