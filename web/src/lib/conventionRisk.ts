/**
 * conventionRisk.ts — how likely a card-show deal is to be a fake, for Convention Mode's "Risk" pill.
 *
 * PURPOSE
 *   The old score started every card at the same number and only moved with the asking price and booth, so every
 *   card showed "Medium" until a price was typed. This one looks at the card itself — how much it is worth, whether
 *   it is one of the most-counterfeited Pokémon, a chase rarity, or vintage — and at the deal: an ask far below market
 *   is the classic sign of a fake. Each point it adds comes with a plain reason, shown under the pill.
 *
 * USED BY: pages/ConventionModePage.tsx
 * TESTED BY: lib/conventionRisk.test.mjs
 */

export interface RiskInput {
  name: string
  rarity?: string
  setId: string
  /** The set's release year, when known. */
  releaseYear?: number
  /** Market price for the claimed condition; 0 when unknown. */
  market: number
  /** The vendor's asking price; 0 when not entered yet. */
  ask: number
  /** NM, LP, MP, HP or DMG. */
  condition: string
}

export interface Risk {
  score: number
  label: 'Low' | 'Medium' | 'High'
  /** Why, one line per thing that raised it (or why it is low). */
  reasons: string[]
}

/** Pokémon counterfeiters copy most. Whole words, so "Mew" doesn't match "Mewtwo" twice. */
const OFTEN_FAKED = ['charizard', 'pikachu', 'umbreon', 'mewtwo', 'mew', 'lugia', 'rayquaza', 'gengar', 'eevee',
  'blastoise', 'venusaur', 'gyarados', 'sylveon', 'espeon', 'giratina']
const OFTEN_FAKED_RE = new RegExp(`\\b(${OFTEN_FAKED.join('|')})\\b`, 'i')
/** Rarities that are worth faking. */
const CHASE_RARITY_RE = /secret|hyper|illustration|ultra|rainbow|gold|full art|vmax|vstar|\bgx\b|\bex\b|double rare|shiny|amazing|radiant|trainer gallery|1st edition/i
/** Wizards-era sets, when the release year isn't known. */
const VINTAGE_SET_RE = /^(base|basep|gym|neo|si1|ecard)/i

const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`

/** PURPOSE: The risk score (0-100), its label, and the reasons for one card at one asking price. */
export function dealRisk(input: RiskInput): Risk {
  const { name, rarity = '', setId, releaseYear, market, ask, condition } = input
  let score = 5
  const reasons: string[] = []
  const add = (points: number, reason: string) => { score += points; reasons.push(reason) }

  if (market >= 500) add(35, `Worth about ${money(market)}: counterfeiters go after cards this valuable.`)
  else if (market >= 100) add(25, `Worth about ${money(market)}: valuable enough to be faked.`)
  else if (market >= 25) add(12, `Worth about ${money(market)}: fakes of cards at this price exist.`)

  const faked = OFTEN_FAKED_RE.exec(name)
  if (faked) add(10, `${faked[1][0].toUpperCase()}${faked[1].slice(1).toLowerCase()} is one of the most-faked Pokémon.`)
  if (rarity && CHASE_RARITY_RE.test(rarity)) add(8, `${rarity}: chase rarities are a common target for fakes.`)
  if ((releaseYear && releaseYear <= 2003) || VINTAGE_SET_RE.test(setId))
    add(10, `Vintage card${releaseYear ? ` (${releaseYear})` : ''}: check the print, holo and card back closely.`)

  if (ask > 0 && market > 0) {
    const below = Math.round((1 - ask / market) * 100)
    if (ask < market * 0.6) add(35,`Asking ${below}% under market: a price too good to be true is the top sign of a fake.`)
    else if (ask < market * 0.8) add(12, `Asking ${below}% under market: ask why it's so cheap.`)
  }
  if (condition === 'NM' && market >= 25) add(5, 'Sold as Near Mint: check corners, edges and the back before paying NM prices.')

  score = Math.min(100, Math.max(0, score))
  const label = score >= 50 ? 'High' : score >= 15 ? 'Medium' : 'Low'
  if (reasons.length === 0) reasons.push(market > 0 && market < 5
    ? `Worth about ${money(market)}: cards this cheap are rarely faked.`
    : 'Nothing about this card or price stands out.')
  return { score, label, reasons }
}
