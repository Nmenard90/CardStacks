/**
 * Decides whether a card's printed rarity gets the shiny "holo" thumbnail
 * effect. Rarity naming isn't consistent across the TCG's history — older
 * sets say "Rare Holo", newer ones say "Double Rare"/"Ultra Rare" for
 * cards that are just as foil, with no "Holo" in the name — so this is a
 * hand-kept list rather than a text pattern.
 *
 * Reverse holo is NOT covered here — it's a per-physical-copy property,
 * not part of the catalog rarity, and isn't tracked per copy yet.
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

export function isHolo(rarity: string | undefined | null): boolean {
  if (!rarity) return false
  return HOLO_RARITIES.has(rarity.trim().toLowerCase())
}
