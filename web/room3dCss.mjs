/**
 * room3dCss.mjs — keeps the 3D room's stylesheets from styling the rest of the site.
 *
 * PURPOSE
 *   The room's CSS (src/room3d/**) was written for a page of its own: bare class names (.hud, .back-btn, .item-panel),
 *   `html, body, #root` rules and a fluid `:root` font size. Vite never unloads CSS, so after one visit to the room
 *   those rules would apply site-wide. Every room selector is rewritten to live under the room's root element
 *   (`.room3d`, which also carries `.ui-site`), and the `:root` size only applies while the room is on screen.
 *
 * IMPORTS EXPLAINED: none.
 * USED BY: vite.config.ts (postcss-prefix-selector transform for files under src/room3d)
 * DEPENDS ON: nothing
 */

export const ROOM_ROOT = '.room3d'

/**
 * PURPOSE: The scoped form of one selector from a room stylesheet.
 * @param {string} selector  a single selector (no commas), as postcss-prefix-selector passes it
 * @return {string}
 */
export function scopeRoomSelector(selector) {
  const s = selector.trim()
  if (s === ':root') return `html:has(${ROOM_ROOT})` // rem units follow the room's fluid size only on the room page
  if (s === 'html' || s === 'body' || s === '#root') return ROOM_ROOT
  if (s.startsWith('.ui-site')) return `${ROOM_ROOT}${s}` // .ui-site sits on the same element as .room3d
  if (s.startsWith(ROOM_ROOT) || s.startsWith('html:has(')) return s
  return `${ROOM_ROOT} ${s}`
}
