/**
 * RoomGuide.tsx — the "how to use your room" walkthrough on the landing page.
 *
 * PURPOSE
 *   The room is the first thing people see after signing in, and a 3D scene doesn't explain itself. This shows four
 *   short illustrated steps (tap furniture → open things → swipe through cards → the rest of the site is in the room
 *   too), each with a small looping animation. It opens by itself on someone's first visit (useRoomGuide) and from
 *   the "?" on the room's status chip any time after.
 *
 * HOW IT WORKS
 *   Whether it is open lives in useRoomGuide.ts (a per-browser "seen" flag). The illustrations are inline SVG animated with CSS (guide.css), so they cost no
 *   downloads, and stand still under prefers-reduced-motion. Esc closes the guide before the room sees the key.
 *
 * IMPORTS EXPLAINED
 *   guide.css — the overlay, the illustrations and their animations (scoped under .room3d by vite.config.ts)
 *
 * USED BY: pages/RoomPage.tsx
 * DEPENDS ON: room3d/useRoomGuide.ts (open/seen state)
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import './guide.css'

/** A fingertip with a ripple — the "tap here" mark the illustrations share. */
const Tap = ({ className }: { className: string }) => (
  <g className={`guide-tap ${className}`}>
    <circle className="guide-tap__ring" r="15" />
    <circle className="guide-tap__dot" r="7" />
  </g>
)

/** Step 1: the three collection pieces, with a tap hopping from one to the next. */
const FurnitureArt = () => (
  <svg viewBox="0 0 320 170" className="guide-art" aria-hidden="true">
    <rect className="guide-floor" x="0" y="146" width="320" height="24" />
    <g className="guide-piece guide-piece--1">
      <rect x="18" y="40" width="82" height="106" rx="6" className="guide-wood" />
      {[0, 1, 2].map(r => [0, 1].map(c => <rect key={`${r}${c}`} x={26 + c * 36} y={48 + r * 32} width="30" height="24" rx="3" className={`guide-box guide-box--${(r + c) % 3}`} />))}
    </g>
    <g className="guide-piece guide-piece--2">
      <rect x="116" y="26" width="92" height="120" rx="6" className="guide-wood" />
      {[0, 1, 2].map(r => Array.from({ length: 7 }, (_, i) => <rect key={`${r}${i}`} x={124 + i * 11} y={34 + r * 37} width="8" height={26 + ((i * 7 + r) % 3) * 3} rx="2" className={`guide-spine guide-spine--${(i + r) % 4}`} />))}
    </g>
    <g className="guide-piece guide-piece--3">
      <rect x="224" y="34" width="78" height="112" rx="6" className="guide-wood" />
      <rect x="232" y="42" width="62" height="96" rx="4" className="guide-glass" />
      {[0, 1].map(r => [0, 1].map(c => <rect key={`${r}${c}`} x={242 + c * 24} y={52 + r * 42} width="18" height="26" rx="2" className="guide-card" />))}
    </g>
    <Tap className="guide-tap--hop" />
  </svg>
)

/** Step 2: a binder opening, then a tap on one of its cards. */
const OpenArt = () => (
  <svg viewBox="0 0 320 170" className="guide-art" aria-hidden="true">
    <g className="guide-binder">
      <rect x="66" y="22" width="188" height="128" rx="8" className="guide-binder__cover" />
      <rect x="74" y="30" width="84" height="112" rx="4" className="guide-page" />
      <g className="guide-binder__right">
        <rect x="162" y="30" width="84" height="112" rx="4" className="guide-page" />
      </g>
      {[0, 1, 2].map(r => [0, 1, 2].map(c => <rect key={`l${r}${c}`} x={80 + c * 25} y={36 + r * 35} width="22" height="31" rx="2" className={`guide-card guide-card--${(r * 3 + c) % 4}`} />))}
      {[0, 1, 2].map(r => [0, 1, 2].map(c => <rect key={`r${r}${c}`} x={168 + c * 25} y={36 + r * 35} width="22" height="31" rx="2" className={`guide-card guide-card--${(r + c * 2) % 4}`} />))}
    </g>
    <Tap className="guide-tap--open" />
  </svg>
)

/** Step 3: a fan of cards sliding past under a swiping finger. */
const SwipeArt = () => (
  <svg viewBox="0 0 320 170" className="guide-art" aria-hidden="true">
    <g className="guide-fan">
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={40 + i * 36} y={46 + Math.abs(3 - i) * 8} width="54" height="76" rx="5" className={`guide-card guide-card--${i % 4}${i === 3 ? ' guide-card--front' : ''}`} />
      ))}
    </g>
    <g className="guide-swipe">
      <path d="M118 150 h84" className="guide-swipe__trail" />
      <circle cx="160" cy="150" r="9" className="guide-tap__dot" />
    </g>
  </svg>
)

/** Step 4: desk, pinboard and window — the pieces that open other pages. */
const SiteArt = () => (
  <svg viewBox="0 0 320 170" className="guide-art" aria-hidden="true">
    <g className="guide-piece guide-piece--1">
      <rect x="16" y="96" width="86" height="12" rx="3" className="guide-wood" />
      <rect x="24" y="108" width="8" height="38" className="guide-wood" /><rect x="86" y="108" width="8" height="38" className="guide-wood" />
      <rect x="40" y="80" width="30" height="16" rx="2" className="guide-card guide-card--1" />
      <text x="59" y="134" className="guide-label">Add</text>
    </g>
    <g className="guide-piece guide-piece--2">
      <rect x="124" y="30" width="78" height="56" rx="4" className="guide-cork" />
      <rect x="134" y="38" width="18" height="24" rx="2" className="guide-card guide-card--2" />
      <rect x="160" y="44" width="18" height="24" rx="2" className="guide-card guide-card--0" />
      <rect x="182" y="36" width="12" height="16" rx="2" className="guide-card guide-card--3" />
      <text x="163" y="108" className="guide-label">Shop</text>
    </g>
    <g className="guide-piece guide-piece--3">
      <rect x="226" y="24" width="76" height="76" rx="6" className="guide-window" />
      <path d="M264 24 v76 M226 62 h76" className="guide-window__bars" />
      <circle cx="286" cy="44" r="8" className="guide-sun" />
      <text x="264" y="122" className="guide-label">Explore</text>
    </g>
    <Tap className="guide-tap--hop" />
  </svg>
)

interface Step { title: string; art: ReactNode; text: ReactNode }

const STEPS: Step[] = [
  {
    title: 'This is your collection room',
    art: <FurnitureArt />,
    text: <>The <b>box shelf</b> holds your card boxes, the <b>bookcase</b> your binders and the <b>cabinet</b> your display cards. <b>Tap one</b> to walk over to it.</>,
  },
  {
    title: 'Open anything',
    art: <OpenArt />,
    text: <>Tap a <b>binder</b> to open it, a <b>box</b> to flip through it, or a <b>display card</b> to read it up close. Tap any card for its price and details.</>,
  },
  {
    title: 'Swipe through your cards',
    art: <SwipeArt />,
    text: <><b>Swipe</b> to turn binder pages and flip through a box — on a computer, <b>scroll</b> or use the <b>← →</b> keys. Tap an empty pocket to fill it.</>,
  },
  {
    title: 'The rest of CardStacks is in here too',
    art: <SiteArt />,
    text: <>The <b>desk</b> adds cards, the <b>pinboard</b> opens your Shop and the <b>window</b> looks out on Explore. <b>← Back</b> (or Esc) steps out — and give Graton a pat.</>,
  },
]

/**
 * PURPOSE: The guide overlay.
 * @param open     whether it is showing
 * @param onClose  called when it is finished, skipped or dismissed with Esc
 */
export function RoomGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const primary = useRef<HTMLButtonElement>(null)
  const opener = useRef<Element | null>(null) // what had focus before, so closing hands it back

  const close = useCallback(() => {
    setStep(0); onClose()
    if (opener.current instanceof HTMLElement) opener.current.focus()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    // Capture phase + preventDefault: the room's own Esc handler (RoomScene) skips handled keys.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setStep(s => Math.min(STEPS.length - 1, s + 1)) }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); setStep(s => Math.max(0, s - 1)) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])
  useEffect(() => { if (open) primary.current?.focus() }, [open, step])

  const current = STEPS[step]
  const last = step === STEPS.length - 1
  return (
    <>
      {open && (
        <div className="room-guide" role="dialog" aria-modal="true" aria-labelledby="room-guide-title">
          <div className="room-guide__card">
            <button type="button" className="room-guide__skip" onClick={close}>Skip</button>
            <div className="room-guide__art" key={step}>{current.art}</div>
            <p className="room-guide__count">Step {step + 1} of {STEPS.length}</p>
            <h2 id="room-guide-title">{current.title}</h2>
            <p className="room-guide__text">{current.text}</p>
            <div className="room-guide__dots" role="tablist" aria-label="Guide steps">
              {STEPS.map((s, i) => (
                <button key={s.title} type="button" role="tab" aria-selected={i === step} aria-label={`Step ${i + 1}: ${s.title}`} className={i === step ? 'active' : ''} onClick={() => setStep(i)} />
              ))}
            </div>
            <div className="room-guide__actions">
              {step > 0 ? <button type="button" className="room-guide__back" onClick={() => setStep(step - 1)}>‹ Back</button> : <span />}
              <button ref={primary} type="button" className="room-guide__next" onClick={() => (last ? close() : setStep(step + 1))}>{last ? "Let's go!" : 'Next ›'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
