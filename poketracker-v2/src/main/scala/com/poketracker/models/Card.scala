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
 */
final case class Card(
  id:     String,
  setId:  String,
  name:   String,
  number: String,
  rarity: Option[String],
  artist: Option[String],
  images: CardImage,
  prices: Option[CardPrices]
)

object Card:
  given JsonCodec[Card] = DeriveJsonCodec.gen[Card]