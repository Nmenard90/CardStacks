/**
 * MessageThread — the one chat used everywhere on CardStacks (trade offers, shop requests from both sides), so every
 * conversation looks and works the same.
 *
 * WHAT IT LOOKS LIKE
 *   A card with a title, then a scrolling log of message bubbles — yours on the right in the site's accent colour,
 *   theirs on the left beside a round initial — grouped by day ("Today", "Yesterday", "Nov 4") with the time under each
 *   run of bubbles. The log scrolls to the newest message when one arrives. Below it, a rounded box that grows as you
 *   type: Enter sends, Shift+Enter starts a new line.
 *   The parent loads and polls the messages; this only draws them and hands back what's typed.
 *
 * USED BY: components/OfferInbox, components/ShopRequestChat, pages/ShopRequestStatusPage
 * STYLES: styles/chat.css
 */

import { useEffect, useRef, useState } from 'react'
import '../styles/chat.css'

export interface ThreadMessage {
  id: string
  /** Written by whoever is looking. */
  mine: boolean
  /** Who wrote it, for the other side's messages. */
  who: string
  body: string
  createdAt: string
}

/** "Today", "Yesterday", or "Nov 4" (with the year when it isn't this year). */
function dayLabel(date: Date): string {
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}
const timeLabel = (date: Date) => date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

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
  const log = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Newest message in view whenever one arrives (or the chat first opens).
  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // The box grows with what's typed, up to about five lines, then scrolls.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try { if (await onSend(body)) setDraft('') } finally { setBusy(false) }
  }

  // Runs of messages from the same side on the same day share one time line and one avatar.
  const rows = messages.map((m, i) => {
    const at = new Date(m.createdAt)
    const prev = messages[i - 1]
    const next = messages[i + 1]
    const day = dayLabel(at)
    const newDay = !prev || dayLabel(new Date(prev.createdAt)) !== day
    const lastOfRun = !next || next.mine !== m.mine || dayLabel(new Date(next.createdAt)) !== day
    return { m, at, day, newDay, lastOfRun }
  })
  const initial = (otherName.trim()[0] ?? '?').toUpperCase()

  return (
    <section className="chat" aria-label={title}>
      {/* A div, not <header>: the site styles every <header> as the page's top bar (zigzag edge). */}
      <div className="chat__head">
        <h4>{title}</h4>
        {messages.length > 0 && <span>{messages.length} message{messages.length === 1 ? '' : 's'}</span>}
      </div>
      <div className="chat__log" ref={log} role="log" aria-live="polite">
        {messages.length === 0 && <p className="chat__empty"><span aria-hidden="true">💬</span>{empty}</p>}
        {rows.map(({ m, at, day, newDay, lastOfRun }) => (
          <div key={m.id}>
            {newDay && <div className="chat__day"><span>{day}</span></div>}
            <div className={`chat__row${m.mine ? ' chat__row--mine' : ''}${lastOfRun ? ' chat__row--last' : ''}`}>
              {!m.mine && <span className="chat__avatar" aria-hidden="true">{lastOfRun ? (m.who.trim()[0] ?? initial).toUpperCase() : ''}</span>}
              <div className="chat__col">
                <p className="chat__bubble">{m.body}</p>
                {lastOfRun && <small className="chat__meta">{m.mine ? 'You' : m.who} · {timeLabel(at)}</small>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <form className="chat__compose" onSubmit={e => { e.preventDefault(); void send() }}>
        <textarea
          ref={box}
          value={draft} maxLength={2000} rows={1}
          placeholder={`Message ${otherName}…`}
          aria-label={`Message ${otherName}`}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
        />
        <button type="submit" className="chat__send" disabled={busy || !draft.trim()} aria-label="Send">
          {busy ? '…' : 'Send'}
        </button>
      </form>
      <p className="chat__hint">Enter to send · Shift+Enter for a new line</p>
    </section>
  )
}
