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
 * USED BY: CollectionPage, BulkAddPage
 * DEPENDS ON: routes defined in App.tsx; the .nav-link styles in tracker.css
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
 * PURPOSE: Render the shared navigation row. Highlights the link whose path
 *          matches the current location so the user always knows where they are.
 * @returns The navigation element for a page header.
 */
export function HeaderNav() {
  // Current route path — used only to mark the active link.
  const { pathname } = useLocation()
  // setUser(null) signs out / returns to the login screen.
  const { setUser } = useUser()

  return (
    <div className="header-right">
      {ITEMS.map(item => (
        <Link
          key={item.to}
          to={item.to}
          className={'nav-link' + (pathname === item.to ? ' active' : '')}
        >
          {item.label}
        </Link>
      ))}
      <button className="nav-link" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>
        Switch user
      </button>
    </div>
  )
}
