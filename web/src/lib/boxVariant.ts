/**
 * Deterministic visual variant (1 of 6) for a storage box, keyed off its
 * ID so it's stable across renders instead of picked randomly each time.
 *
 * USED BY: OwnedPage (Shelf view)
 */
const THEME_COUNT = 6

/** Simple string hash (djb2-style) — deterministic, unlike Math.random(). */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++)
    h = (h * 31 + s.charCodeAt(i)) >>> 0  // >>> 0 keeps it a positive 32-bit int
  return h
}

/** "box-t0".."box-t5" — pair with the same suffix for the sidebar thumb. */
export function boxTheme(id: string): string {
  return `box-t${hashStr(id) % THEME_COUNT}`
}
