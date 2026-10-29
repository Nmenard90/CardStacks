/**
 * RoomPage — the landing page ("/"): the signed-in user's collection as a 3D room.
 *
 * HOW IT WORKS
 *   The site header (logo, user, HeaderNav) sits on top as on every page; the rest of the screen is the room, which
 *   fills exactly the space left between the header and, on phones, the bottom tab bar (styles/room-page.css).
 *   The 3D code (three.js + the room, ~1 MB) is lazy-loaded so no other page pays for it. A first-visit guide shows
 *   how to use the room and can be reopened from the "?" on the room's status chip.
 *
 * IMPORTS EXPLAINED
 *   RoomScene  — the room itself (room3d/), loaded on demand
 *   RoomGuide  — the illustrated how-to overlay
 *
 * USED BY: App.tsx ("/" route)
 * DEPENDS ON: context/UserContext, components/HeaderNav, components/LoginScreen, room3d/RoomScene, room3d/RoomGuide,
 *   room3d/useRoomGuide
 */
import { Component, lazy, Suspense, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { HeaderNav } from '../components/HeaderNav'
import { LoginScreen } from '../components/LoginScreen'
import { useUser } from '../context/UserContext'
import { RoomGuide } from '../room3d/RoomGuide'
import { useRoomGuide } from '../room3d/useRoomGuide'
import '../styles/room-page.css'

const RoomScene = lazy(() => import('../room3d/RoomScene.jsx'))

let webglSupport: boolean | null = null // checked once: every probe creates a GL context, and browsers cap how many exist

/** True when this browser can draw WebGL at all; without it the room can't render, so the page says so instead. */
function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    webglSupport = Boolean(gl)
    gl?.getExtension('WEBGL_lose_context')?.loseContext() // hand the probe's context straight back
  } catch {
    webglSupport = false
  }
  return webglSupport
}

/** Shown instead of the room when it can't run (no WebGL, or the 3D code failed to load or crashed). */
function RoomUnavailable({ reason }: { reason: string }) {
  return (
    <div className="room-page__fallback" role="alert">
      <h2>The 3D room can't open here</h2>
      <p>{reason}</p>
      <Link to="/spaces" className="room-page__fallback-link">Open your collection in Spaces →</Link>
    </div>
  )
}

/** Catches a crash inside the 3D scene (e.g. a lost graphics context) so the rest of the page keeps working. */
class RoomErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <RoomUnavailable reason="Something went wrong drawing the room. Reloading the page usually fixes it." />
      : this.props.children
  }
}

/**
 * PURPOSE: Keeps `--bottom-nav-h` on the page equal to the phone tab bar's real height (0 when it's hidden), so the
 *          room ends exactly where the fixed tab bar begins whatever its font size or the phone's safe area.
 * @param page  the page element the variable is set on
 */
function useBottomNavHeight(page: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const nav = page.current?.querySelector<HTMLElement>('.bottom-nav')
    if (!nav || !page.current) return
    const apply = () => page.current?.style.setProperty('--bottom-nav-h', `${nav.offsetHeight}px`)
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(nav)
    window.addEventListener('resize', apply)
    return () => { observer.disconnect(); window.removeEventListener('resize', apply) }
  })
}

export function RoomPage() {
  const { user, loading } = useUser()
  const [guideOpen, showGuide, hideGuide] = useRoomGuide()
  const page = useRef<HTMLElement>(null)
  useBottomNavHeight(page)

  // "/" is the landing page, so it gates on login itself (same as Spaces did when it was "/") — after the saved
  // session has been checked, so a signed-in visitor doesn't see the login screen flash first.
  if (!user && loading) return <main className="page-tracker room-page"><div className="room3d"><div className="room-page__loading" role="status"><span className="room-page__spinner" aria-hidden="true" />Opening CardStacks…</div></div></main>
  if (!user) return <main className="page-tracker spaces-concept"><LoginScreen /></main>

  return (
    <main className="page-tracker room-page" ref={page}>
      <header className="room-page__header">
        <Link to="/" className="logo">CARD<span>STACKS</span></Link>
        <div className="user-badge">● <b>{user.username || 'Collector'}</b></div>
        <HeaderNav />
      </header>
      <div className="room3d ui-site">
        {hasWebGL() ? (
          <RoomErrorBoundary>
            <Suspense fallback={<div className="room-page__loading" role="status"><span className="room-page__spinner" aria-hidden="true" />Building your room…</div>}>
              <RoomScene userId={user.id} onHelp={showGuide} />
            </Suspense>
          </RoomErrorBoundary>
        ) : (
          <RoomUnavailable reason="This browser has 3D graphics (WebGL) turned off or unavailable." />
        )}
        <RoomGuide open={guideOpen} onClose={hideGuide} />
      </div>
    </main>
  )
}
