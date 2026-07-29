/**
 * FILE: HeaderNav.tsx
 * LOCATION: src/components/HeaderNav.tsx
 *
 * PURPOSE:
 *   Single source of truth for top-of-page navigation. Renders a row of
 *   large, always-visible links to every page, plus a "Switch user" action.
 *   Replaces the old hamburger NavMenu so navigation is one tap (not two)
 *   and identical on every page. The current page is auto-highlighted from
 *   the router location, so callers pass nothing.
 *
 * IMPORTS EXPLAINED:
 *   Link/useLocation — client-side navigation + detecting the active route
 *   useUser          — to clear the session for the "Switch user" button
 *
 * USED BY: every page (CollectionPage, OwnedPage, BulkAddPage,
 *   BinderShelfPage, BinderViewPage, AnalyzerPage, ConventionModePage)
 * DEPENDS ON: routes defined in App.tsx; .nav-link/.bottom-nav styles in index.css
 */
import { Link, useLocation } from 'react-router-dom'
import { useUser } from '../context/UserContext'

/** One nav destination: route path + the label shown on the button. */
interface NavItem { to: string; label: string }

/**
 * VALUE: ITEMS
 * PURPOSE: The full navigation, in display order. Editing this list changes
 *          the nav on every page at once — the reason this lives in one file.
 */
const ITEMS: NavItem[] = [
  { to: '/',           label: '🗂 Sets' },
  { to: '/owned',      label: '📦 My Collection' },
  { to: '/bulk',       label: '⚡ Bulk Add' },
  { to: '/shelf',      label: '📒 Binders' },
  { to: '/analyzer',   label: '⚖️ Analyzer' },
  { to: '/convention', label: '🎪 Convention' },
]

/**
 * COMPONENT: HeaderNav
 * PURPOSE: Render the shared navigation — a link row in the header on wide
 *          screens, and a fixed bottom tab bar on narrow ones (the header
 *          row used to be the only option, and on a phone it wrapped into
 *          several rows and ate half the screen). Highlights the link whose
 *          path matches the current location so the user always knows where
 *          they are.
 * @returns The navigation elements for a page header.
 */
export function HeaderNav() {
  // Current route path — used only to mark the active link.
  const { pathname } = useLocation()
  // setUser(null) signs out / returns to the login screen.
  const { setUser } = useUser()

  return (
    <>
      <div className="app-nav">
        {ITEMS.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className={'nav-link' + (pathname === item.to ? ' active' : '')}
          >
            {item.label}
          </Link>
        ))}
        <button className="nav-link switch-user" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>
          Switch user
        </button>
      </div>
      <nav className="bottom-nav" aria-label="Main navigation">
        {ITEMS.map(item => {
          // Labels are "emoji label text" — split so the tab can show a big
          // icon with a small caption under it instead of one cramped line.
          const [icon, ...rest] = item.label.split(' ')
          return (
            <Link
              key={item.to}
              to={item.to}
              className={'bottom-nav-link' + (pathname === item.to ? ' active' : '')}
            >
              <span className="bnl-icon">{icon}</span>
              <span className="bnl-label">{rest.join(' ')}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
