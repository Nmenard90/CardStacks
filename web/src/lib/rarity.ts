/**
 * FILE: rarity.ts
 * LOCATION: src/lib/rarity.ts
 *
 * PURPOSE:
 *   Classifies a card's printed rarity as "holo-worthy" for the shine effect
 *   on its thumbnail. Rarity naming isn't consistent across the TCG's history —
 *   older sets say "Rare Holo", newer ones say "Double Rare"/"Ultra Rare" for
 *   cards that are just as foil in real life without "Holo" anywhere in the
 *   name — so this is a maintained list rather than a substring check.
 *
 *   Reverse holo is NOT covered here: it's a print variant a specific physical
 *   copy either is or isn't, not a property of the card's catalog rarity, and
 *   the app doesn't track per-copy print variants today.
 *
 * USED BY: CardTile
 */

const HOLO_RARITIES = new Set([
  'rare holo', 'rare holo ex', 'rare holo gx', 'rare holo v', 'rare holo vmax',
  'rare holo vstar', 'rare holo lv.x', 'rare holo star',
  'amazing rare', 'radiant rare', 'rare ace spec', 'rare break', 'rare prime',
  'rare prism star', 'rare rainbow', 'rare secret', 'rare shining', 'rare shiny',
  'rare shiny gx', 'rare ultra',
  'double rare', 'ultra rare', 'illustration rare', 'special illustration rare',
  'hyper rare', 'trainer gallery rare holo',
  // Mega Evolution era (me3 "Perfect Order", me4 "Chaos Rising") — confirmed
  // live against both sets' actual card data.
  'mega hyper rare',
])

/** Whether a card's printed rarity is a foil/holo treatment worth a shine effect. */
export function isHolo(rarity: string | undefined | null): boolean {
  if (!rarity) return false
  return HOLO_RARITIES.has(rarity.trim().toLowerCase())
}
