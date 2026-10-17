/**
 * Small helpers shared by the trading pages.
 * USED BY: TradePage, SharePage
 */
import type { Card, TradeCardView } from '../types'

/** sessionStorage key: share page to return to after an OAuth sign-in. */
export const RETURN_KEY = 'cardstacks.returnTo'

export const money = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)

/** A trading card view as a catalog Card, so trade pages can use the same
 *  tile (CardThumb: holo shimmer, price ribbon, zoom) as the rest of the site.
 *  Its one price is the market price for the view's condition. */
export const viewCard = (v: TradeCardView): Card => ({
  id: v.cardId, setId: v.setId, name: v.name, number: v.number, rarity: v.rarity, artist: v.artist,
  images: { small: v.imageSmall, large: v.imageLarge },
  prices: v.marketPrice != null ? { nm: v.marketPrice } : undefined,
})

/** Where share links point. Inside the Android app the page origin is the
 *  local Capacitor shell, which nobody else can open — fall back to the
 *  hosted site there. VITE_SHARE_ORIGIN overrides both. */
export const shareOrigin = (): string => {
  const env = import.meta.env.VITE_SHARE_ORIGIN as string | undefined
  if (env) return env
  const { protocol, hostname, origin } = window.location
  return protocol.startsWith('http') && hostname !== 'localhost' ? origin : 'https://cardstacks.up.railway.app'
}
