/**
 * myShopRequests — the requests this browser sent to a shop, so a buyer (who has no account) can get back to them.
 *
 * HOW IT WORKS
 *   Each sent request's id is kept in localStorage under "cardstacks.shopRequests.<slug>" as [{ id, at }], newest
 *   first, at most 20. The id is the buyer's private link (/shop/<slug>/request/<id>). Storage can be missing or
 *   blocked (private windows), so every read and write is guarded: nothing breaks, the list is just empty.
 *
 * USED BY: pages/ShopPage.tsx (remember after sending, "Your requests" link), pages/ShopRequestStatusPage.tsx (the list)
 */

/** One request this browser sent: its id and when (ISO date). */
export interface SentRequest { id: string; at: string }

const key = (slug: string) => `cardstacks.shopRequests.${slug.toLowerCase()}`

/** The requests this browser sent to the shop `slug`, newest first; empty when storage is unavailable. */
export function myShopRequests(slug: string): SentRequest[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key(slug)) ?? '[]')
    return Array.isArray(list) ? list.filter((r): r is SentRequest => typeof r?.id === 'string' && typeof r?.at === 'string') : []
  } catch { return [] }
}

/** Remembers a request just sent (or opened from its link) to the shop `slug`; one already listed keeps its place. */
export function rememberShopRequest(slug: string, id: string) {
  if (!id) return
  const known = myShopRequests(slug)
  if (known.some(r => r.id === id)) return
  const list = [{ id, at: new Date().toISOString() }, ...known].slice(0, 20)
  try { localStorage.setItem(key(slug), JSON.stringify(list)) } catch { /* storage blocked: the link still works */ }
}
