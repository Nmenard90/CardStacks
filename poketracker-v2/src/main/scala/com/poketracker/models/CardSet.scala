/**
 * FILE: CardSet.scala
 * PACKAGE: com.poketracker.models
 * LOCATION: src/main/scala/com/poketracker/models/CardSet.scala
 *
 * PURPOSE:
 *   Represents a Pokémon TCG set (e.g. "Scarlet & Violet Base Set",
 *   "Base Set", "Ascended Heroes"). Sets group cards together and
 *   are the primary way users navigate the card catalog.
 *
 * IMPORTS:
 *   zio.json.* — JSON conversion
 *   java.time.LocalDate — a calendar date without time (sets have release dates,
 *                         not release times — we do not need time of day)
 *
 * USED BY: CardSetRepository, CardService, CardRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.LocalDate

/**
 * CASE CLASS: SetImages
 *
 * PURPOSE:
 *   Holds the URLs for a set's symbol and logo images.
 *   The symbol is the small icon shown next to each card from the set.
 *   The logo is the full set name in stylized text, used on the set page.
 *
 * @param symbol  URL to the set symbol image. Shown in the set dropdown.
 * @param logo    URL to the set logo image. Shown on the set detail page.
 */
final case class SetImages(
  symbol: String,
  logo:   String
)

object SetImages:
  given JsonCodec[SetImages] = DeriveJsonCodec.gen[SetImages]

/**
 * CASE CLASS: CardSet
 *
 * PURPOSE:
 *   A Pokémon TCG set — a named release of cards.
 *   Data comes from the Pokémon TCG API and is stored in our database
 *   so we do not need to call the API on every request.
 *
 * @param id           Unique identifier from the Pokémon TCG API.
 *                     e.g. "sv1", "base1", "me2pt5"
 *                     This is our primary key for sets.
 *
 * @param name         The set's full name.
 *                     e.g. "Scarlet & Violet", "Base Set", "Ascended Heroes"
 *
 * @param series       The series this set belongs to.
 *                     e.g. "Scarlet & Violet", "Sun & Moon", "Base"
 *                     Used to group sets in the dropdown.
 *
 * @param printedTotal The number printed on cards as their collector number denominator.
 *                     e.g. for "4/165", printedTotal = 165
 *                     Secret rares have numbers higher than this.
 *
 * @param total        The actual total number of cards in the set including
 *                     secret rares. Always >= printedTotal.
 *
 * @param releaseDate  When this set was released. Used to sort sets newest-first.
 *
 * @param images       Symbol and logo image URLs.
 *
 * @param ptcgoCode    The code used in the Pokémon TCG Online game.
 *                     e.g. "SVI" for Scarlet & Violet Base Set.
 *                     Used to match sets with TCGTracking price data.
 *                     Option because not all sets have a PTCGO code.
 */
final case class CardSet(
  id:           String,
  name:         String,
  series:       String,
  printedTotal: Int,
  total:        Int,
  releaseDate:  LocalDate,
  images:       SetImages,
  ptcgoCode:    Option[String]
)

object CardSet:
  given JsonCodec[CardSet] = DeriveJsonCodec.gen[CardSet]
