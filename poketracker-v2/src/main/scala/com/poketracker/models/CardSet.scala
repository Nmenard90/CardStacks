/**
 * A Pokémon TCG set (e.g. "Scarlet & Violet Base Set"). Sets group cards
 * together and are the main way users browse the catalog.
 *
 * USED BY: CardRepository, CardService, CardRoutes
 */

package com.poketracker.models

import zio.json.*
import java.time.LocalDate

final case class SetImages(
  symbol: String,
  logo:   String
)

object SetImages:
  given JsonCodec[SetImages] = DeriveJsonCodec.gen[SetImages]

/**
 * @param printedTotal The denominator printed on cards, e.g. 165 for
 *                     "4/165". Secret rares number higher than this.
 * @param total        Real card count including secret rares — always >= printedTotal.
 * @param ptcgoCode    Short code used in Pokémon TCG Online, e.g. "SVI". None if the set has no code.
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
