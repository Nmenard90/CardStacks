/**
 * MessageThread — the one chat box used everywhere on CardStacks (trade offers, shop requests from both sides), so
 * every conversation looks and works the same: messages oldest first (yours on the right), then a box and Send.
 * Ctrl/⌘+Enter sends. The parent loads and polls the messages; this only draws them and hands back what's typed.
 *
 * USED BY: components/OfferInbox, components/ShopRequestChat, pages/ShopRequestStatusPage
 * STYLES: styles/trading.css (.offer-thread / .offer-msg / .offer-compose)
 */

import { useState } from 'react'
import '../styles/trading.css'

export interface ThreadMessage {
  id: string
  /** Written by whoever is looking. */
  mine: boolean
  /** Who wrote it, for the other side's messages. */
  who: string
  body: string
  createdAt: string
}

export function MessageThread({ messages, otherName, onSend, title = 'Messages', empty = 'No messages yet.' }: {
  messages: ThreadMessage[]
  otherName: string
  /** Sends the text; resolves true when it went (the box then clears). */
  onSend: (body: string) => Promise<boolean>
  title?: string
  empty?: string
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try { if (await onSend(body)) setDraft('') } finally { setBusy(false) }
  }
  return (
    <section className="offer-thread">
      <h4>{title}</h4>
      {messages.length === 0 && <p className="muted">{empty}</p>}
      {messages.map(m => (
        <div key={m.id} className={`offer-msg ${m.mine ? 'mine' : ''}`}>
          <small>{m.mine ? 'You' : m.who} · {new Date(m.createdAt).toLocaleString()}</small>
          <p>{m.body}</p>
        </div>
      ))}
      <div className="offer-compose">
        <textarea
          value={draft} maxLength={2000} rows={2}
          placeholder={`Message ${otherName}…`}
          aria-label={`Message ${otherName}`}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send() }}
        />
        <button className="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>Send</button>
      </div>
    </section>
  )
}
