/**
 * shopPending.ts — what a signed-out buyer was doing on a shop when they were asked to sign in, so they land back
 * exactly there afterwards: the cards they picked, and whether they were sending a request or asking for photos of
 * one card. Also where to return after a Google sign-in (which always comes back to the site's home page).
 *
 * Kept in sessionStorage (this tab only, gone when it closes). Every read and write is wrapped, so a browser that
 * blocks storage just means starting over, never an error.
 *
 * USED BY: pages/ShopPage (save before sign-in, take after), App.tsx Home (return after a Google sign-in)
 */

export interface PendingShopAction {
  /** The picked cards: card id, condition, how many. */
  cart: { cardId: string; cond: string; qty: number }[]
  /** What to do once signed in: open the request form, or ask for photos of one card's condition. */
  then: 'send' | { photo: { cardId: string; cond: string } }
}

const pendingKey = (slug: string) => `cardstacks.shop.pending.${slug.toLowerCase()}`
const RETURN_KEY = 'cardstacks.returnTo'

/** PURPOSE: Remembers what the buyer was doing on this shop, and to come back here after signing in. */
export function savePending(slug: string, pending: PendingShopAction, returnTo: string): void {
  try {
    sessionStorage.setItem(pendingKey(slug), JSON.stringify(pending))
    sessionStorage.setItem(RETURN_KEY, returnTo)
  } catch { /* storage blocked: they'll pick again */ }
}

/** PURPOSE: What the buyer was doing on this shop (once; it's forgotten as it's read), or null. */
export function takePending(slug: string): PendingShopAction | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(slug))
    sessionStorage.removeItem(pendingKey(slug))
    sessionStorage.removeItem(RETURN_KEY)
    return raw ? (JSON.parse(raw) as PendingShopAction) : null
  } catch {
    return null
  }
}

/** PURPOSE: Forgets a sign-in the buyer backed out of, so a later sign-in elsewhere doesn't jump to the shop. */
export function dropPending(slug: string): void {
  try {
    sessionStorage.removeItem(pendingKey(slug))
    sessionStorage.removeItem(RETURN_KEY)
  } catch { /* nothing to forget */ }
}

/** PURPOSE: Where to go after signing in (once), or null. */
export function takeReturnTo(): string | null {
  try {
    const to = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return to && to.startsWith('/shop/') ? to : null
  } catch {
    return null
  }
}
