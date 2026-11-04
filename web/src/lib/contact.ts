/**
 * contact.ts — how a shop buyer wants to be contacted, and making that usable by the seller.
 *
 * PURPOSE
 *   The request form asks the buyer to pick a way to be reached (text, call, email, Facebook, or something else) and
 *   fill in the one detail it needs. It is stored as one line, "<Method>: <detail>" ("Text: 555-123-4567"), in the
 *   request's existing contact field, so nothing in the database changes. My Shop reads it back and offers the
 *   matching button: text them, call them, email them, open or search their Facebook. Older requests have no
 *   "<Method>:" prefix; for those a link is followed when there is one, and otherwise a Facebook search for the name.
 *
 * USED BY: pages/ShopRequestsPage.tsx (My Shop), pages/ShopPage.tsx (the request form)
 */

/** Hosts whose links lead to a Facebook profile or a Messenger chat. */
const FACEBOOK_HOSTS = /^(?:[a-z0-9-]+\.)?(?:facebook\.com|fb\.com|fb\.me|m\.me|messenger\.com)$/i

/** The ways a buyer can ask to be contacted. */
export type ContactMethod = 'text' | 'call' | 'email' | 'facebook' | 'other'

interface MethodInfo {
  id: ContactMethod
  /** The choice's button text, and the "<Method>:" word stored in front of the detail. */
  label: string
  icon: string
  /** The detail box's label and placeholder. */
  field: string
  placeholder: string
  inputType: 'tel' | 'email' | 'text'
  autoComplete: string
  /** Finishes "I'll … to confirm availability" after sending. */
  reply: string
  /** How My Shop introduces the detail. */
  sellerLabel: string
}

export const CONTACT_METHODS: MethodInfo[] = [
  { id: 'text', label: 'Text', icon: '💬', field: 'Your phone number', placeholder: '555-123-4567', inputType: 'tel', autoComplete: 'tel', reply: 'text you', sellerLabel: 'Wants a text at' },
  { id: 'call', label: 'Call', icon: '📞', field: 'Your phone number', placeholder: '555-123-4567', inputType: 'tel', autoComplete: 'tel', reply: 'call you', sellerLabel: 'Wants a call at' },
  { id: 'email', label: 'Email', icon: '✉️', field: 'Your email', placeholder: 'you@example.com', inputType: 'email', autoComplete: 'email', reply: 'email you', sellerLabel: 'Wants an email at' },
  { id: 'facebook', label: 'Facebook', icon: '👥', field: 'Your name on Facebook (or a link to your profile)', placeholder: 'Jane Doe', inputType: 'text', autoComplete: 'off', reply: 'message you on Facebook', sellerLabel: 'Wants a Facebook message:' },
  { id: 'other', label: 'Other', icon: '💭', field: 'How should I reach you?', placeholder: 'Instagram @name, Discord, …', inputType: 'text', autoComplete: 'off', reply: 'reach out the way you asked', sellerLabel: 'Reach them by' },
]

/** PURPOSE: The method's details by id. */
export function contactMethod(id: ContactMethod): MethodInfo {
  return CONTACT_METHODS.find(m => m.id === id)!
}

/** The digits of a phone number, keeping a leading +; null unless it looks like a phone number (7-15 digits). */
function phoneDigits(value: string): string | null {
  const v = value.trim()
  if (!/^\+?[\d\s().-]+$/.test(v)) return null
  const digits = v.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15 ? (v.startsWith('+') ? '+' : '') + digits : null
}

/** A plain address; no ?, &, = or / so it can't add a subject, cc or bcc to the seller's "Email them" (mailto:) link. */
const EMAIL = /^[^\s@<>,;"?&=/:]+@[^\s@<>,;"?&=/:]+\.[^\s@<>,;"?&=/:]+$/

/** PURPOSE: What's wrong with the detail the buyer typed for their chosen method, or null when it's usable. */
export function contactProblem(method: ContactMethod, value: string): string | null {
  const v = value.trim()
  if (!v) return `Please fill in ${contactMethod(method).field.replace(/^Your/, 'your').replace(/ \(.*\)$/, '')}.`
  if (v.length > 150) return 'That is too long. Please shorten it.'
  if ((method === 'text' || method === 'call') && !phoneDigits(v)) return 'That phone number doesn\'t look right. Use digits, like 555-123-4567.'
  if (method === 'email' && !EMAIL.test(v)) return 'That email doesn\'t look right. It should look like you@example.com.'
  return null
}

/** PURPOSE: The one line stored with the request ("Text: 555-123-4567"). */
export function formatContact(method: ContactMethod, value: string): string {
  return `${contactMethod(method).label}: ${value.trim()}`
}

/** PURPOSE: The method and detail back out of a stored contact; method is null for older requests with no prefix. */
export function parseContact(contact: string): { method: ContactMethod | null; value: string } {
  const t = contact.trim()
  for (const m of CONTACT_METHODS) {
    if (t.toLowerCase().startsWith(m.label.toLowerCase() + ':')) return { method: m.id, value: t.slice(m.label.length + 1).trim() }
  }
  return { method: null, value: t }
}

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

/** PURPOSE: A Facebook people search for a name, for contacts that came without a usable link. */
export function facebookSearchUrl(name: string): string {
  return `https://www.facebook.com/search/people/?q=${encodeURIComponent(name.trim())}`
}

/**
 * PURPOSE: The seller's one-tap way to reach the buyer: { href, label, external } or null when there's nothing to tap.
 * @param contact  the stored contact line
 * @param name     the buyer's name, for a Facebook search when there's no link
 */
export function contactAction(contact: string, name: string): { href: string; label: string; external: boolean } | null {
  const { method, value } = parseContact(contact)
  const url = contactUrl(value)
  const phone = phoneDigits(value)
  switch (method) {
    case 'text': return phone ? { href: `sms:${phone}`, label: '💬 Text them', external: false } : null
    case 'call': return phone ? { href: `tel:${phone}`, label: '📞 Call them', external: false } : null
    case 'email': return EMAIL.test(value) ? { href: `mailto:${value}`, label: '✉️ Email them', external: false } : null
    case 'facebook': return url
      ? { href: url.href, label: 'Open their Facebook ↗', external: true }
      : { href: facebookSearchUrl(value || name), label: `Search “${value || name}” on Facebook ↗`, external: true }
    case 'other': return url ? { href: url.href, label: 'Open link ↗', external: true } : null
    default: return url
      ? { href: url.href, label: `${url.hostname.replace(/^www\./, '')}${url.pathname} ↗`, external: true }
      : { href: facebookSearchUrl(name), label: `Search “${name}” on Facebook ↗`, external: true }
  }
}
