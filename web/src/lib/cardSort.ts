/**
 * cardSort — one set of card sorts shared by every card list (Collection,
 * My Collection, a box's inside, trade lists), so "sort by artist" etc.
 * means the same thing everywhere.
 *
 * Each list maps its rows to SortFields; compareBy() orders them. A row
 * missing the sorted-on value (no artist, no price…) always goes last,
 * whichever direction. Ties fall back to set release date, then card
 * number, then name, so the order never jumps around.
 *
 * USED BY: CollectionPage, OwnedPage, SpacesLivePage (BoxInventory), CardBrowser, SortControl
 */

export type SortKey = 'number' | 'name' | 'value' | 'qty' | 'rarity' | 'artist' | 'set' | 'condition' | 'recent'
export type SortDir = 'asc' | 'desc'

export const SORT_LABELS: Record<SortKey, string> = {
  number: 'Card #',
  name: 'Name',
  value: 'Value',
  qty: 'Quantity',
  rarity: 'Rarity',
  artist: 'Artist',
  set: 'Set release date',
  condition: 'Condition',
  recent: 'Recently added',
}

/** The direction a sort starts in when picked: most valuable / most copies
 *  / rarest / newest-added first; everything else A→Z, oldest set first. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  number: 'asc', name: 'asc', value: 'desc', qty: 'desc', rarity: 'desc',
  artist: 'asc', set: 'asc', condition: 'asc', recent: 'desc',
}

/** What a list row exposes for sorting. Leave a field out if the list doesn't have it. */
export interface SortFields {
  name: string
  setId: string
  number: string
  value?: number | null
  qty?: number
  rarity?: string | null
  artist?: string | null
  /** A condition key ("NM", "LP · reverse"); orders NM → DMG. */
  condition?: string
  /** ISO timestamp. */
  addedAt?: string
}

const CONDITION_ORDER = ['NM', 'LP', 'MP', 'HP', 'DMG']

/** Exact rarity names and abbreviations used by Pokémon (English and
 *  Japanese) and One Piece, rarest = highest. */
const RARITY_RANK: Record<string, number> = {
  'common': 1, 'c': 1,
  'uncommon': 2, 'u': 2, 'uc': 2,
  'rare': 3, 'r': 3, 'promo': 3, 'pr': 3, 'p': 3, 'l': 3, 'leader': 3,
  'rare holo': 4, 'holo rare': 4, 'h': 4,
  'double rare': 5, 'rr': 5, 'rare holo ex': 5, 'rare holo gx': 5, 'rare holo v': 5, 'rare holo vmax': 5, 'rare holo vstar': 5,
  'rrr': 6, 'ace spec rare': 6, 'radiant rare': 6, 'amazing rare': 6, 'shiny rare': 6, 's': 6, 'k': 6, 'a': 6,
  'ultra rare': 7, 'rare ultra': 7, 'ur': 7, 'sr': 7, 'chr': 7, 'csr': 8, 'ar': 7, 'illustration rare': 7, 'tr': 7,
  'special illustration rare': 8, 'sar': 8, 'ssr': 8, 'shiny ultra rare': 8, 'sp': 8,
  'hyper rare': 9, 'hr': 9, 'secret rare': 9, 'rare secret': 9, 'rare rainbow': 9, 'sec': 9, 'mega hyper rare': 10, 'mur': 10,
}

/** Rank for a rarity name; unknown names are placed by their wording. */
export function rarityRank(rarity: string | null | undefined): number | undefined {
  const r = rarity?.trim().toLowerCase()
  if (!r) return undefined
  if (RARITY_RANK[r] !== undefined) return RARITY_RANK[r]
  if (/secret|hyper|rainbow/.test(r)) return 9
  if (/special illustration|special art/.test(r)) return 8
  if (/ultra|illustration|full art|gold/.test(r)) return 7
  if (/double|ex|gx|vmax|vstar|\bv\b/.test(r)) return 5
  if (/holo/.test(r)) return 4
  if (/uncommon/.test(r)) return 2
  if (/common/.test(r)) return 1
  if (/rare|promo/.test(r)) return 3
  return undefined
}

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/**
 * @param setDate release date (YYYY-MM-DD) for a set id, if known.
 * @returns a comparator for Array.sort.
 */
export function compareBy<T>(fields: (row: T) => SortFields, key: SortKey, dir: SortDir, setDate: (setId: string) => string | undefined = () => undefined) {
  const sign = dir === 'asc' ? 1 : -1
  const date = (f: SortFields) => setDate(f.setId) ?? ''
  const tie = (a: SortFields, b: SortFields) =>
    date(a).localeCompare(date(b)) || a.setId.localeCompare(b.setId) || byNumber(a.number, b.number) || a.name.localeCompare(b.name)

  /** Compares possibly-missing values: missing always last. */
  function cmp<V>(a: V | undefined | null, b: V | undefined | null, by: (x: V, y: V) => number): number {
    const am = a == null || a === '', bm = b == null || b === ''
    if (am || bm) return am === bm ? 0 : am ? 1 : -1
    return sign * by(a as V, b as V)
  }
  const num = (x: number, y: number) => x - y
  const text = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' })

  return (ra: T, rb: T): number => {
    const a = fields(ra), b = fields(rb)
    let r = 0
    switch (key) {
      case 'number':    r = sign * byNumber(a.number, b.number); break
      case 'name':      r = sign * text(a.name, b.name); break
      case 'value':     r = cmp(a.value, b.value, num); break
      case 'qty':       r = cmp(a.qty, b.qty, num); break
      case 'rarity':    r = cmp(rarityRank(a.rarity), rarityRank(b.rarity), num) || cmp(a.rarity, b.rarity, text); break
      case 'artist':    r = cmp(a.artist, b.artist, text); break
      case 'set':       r = cmp(setDate(a.setId), setDate(b.setId), text); break
      case 'condition': r = cmp(a.condition, b.condition, (x, y) =>
                          CONDITION_ORDER.indexOf(x.split(' ')[0]) - CONDITION_ORDER.indexOf(y.split(' ')[0]) || x.localeCompare(y)); break
      case 'recent':    r = cmp(a.addedAt, b.addedAt, text); break
    }
    return r || tie(a, b)
  }
}
