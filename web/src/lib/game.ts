/**
 * Which card game the app is currently showing. Each game is its own world
 * (collection, Spaces, boxes, binders, trades), so this is read on every API
 * call — api/client.ts adds it as `?game=` — and switching it reloads the app
 * so nothing from the previous game lingers in memory or the query cache.
 *
 * USED BY: api/client.ts, context/GameContext, HeaderNav
 */

/** English Pokémon — what every pre-multi-game account's data belongs to. */
export const DEFAULT_GAME = 'pokemon'

const KEY = 'cardstacks.game'

export function currentGame(): string {
  try {
    const g = localStorage.getItem(KEY)
    return g && /^[a-z0-9-]{1,32}$/.test(g) ? g : DEFAULT_GAME
  } catch {
    return DEFAULT_GAME
  }
}

/** Saves the choice and reloads into that game's world. */
export function switchGame(id: string, to = '/'): void {
  try { localStorage.setItem(KEY, id) } catch { /* storage blocked: stays on default */ }
  window.location.assign(to)
}
