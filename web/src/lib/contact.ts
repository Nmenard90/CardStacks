/**
 * contact.ts — making a shop buyer's contact details usable by the seller.
 *
 * PURPOSE
 *   Buyers type how to reach them. Older requests say things like "Facebook", which can't be followed; new requests
 *   ask for a Facebook profile or Messenger link. These helpers turn whatever was typed into a link when it is one,
 *   and otherwise offer a Facebook people search for the buyer's name.
 *
 * USED BY: pages/ShopRequestsPage.tsx (My Shop), pages/ShopPage.tsx (the request form)
 */

/** Hosts whose links lead to a Facebook profile or a Messenger chat. */
const FACEBOOK_HOSTS = /^(?:[a-z0-9-]+\.)?(?:facebook\.com|fb\.com|fb\.me|m\.me|messenger\.com)$/i

/**
 * PURPOSE: The https link in a contact text, or null when there isn't one ("Facebook", a phone number…).
 *          Accepts links typed without "https://" ("facebook.com/jane.doe", "m.me/jane").
 * @param contact  what the buyer typed
 */
export function contactUrl(contact: string): URL | null {
  const match = contact.trim().match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/i)
  if (!match) return null
  try {
    const url = new URL(/^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** PURPOSE: True when the contact text holds a Facebook profile or Messenger link with something after the host. */
export function isFacebookLink(contact: string): boolean {
  const url = contactUrl(contact)
  return Boolean(url && FACEBOOK_HOSTS.test(url.hostname) && url.pathname.replace(/\//g, '').length > 0)
}

/** PURPOSE: A Facebook people search for a buyer's name, for requests that came without a usable link. */
export function facebookSearchUrl(name: string): string {
  return `https://www.facebook.com/search/people/?q=${encodeURIComponent(name.trim())}`
}
