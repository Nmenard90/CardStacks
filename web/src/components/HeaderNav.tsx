/**
 * Shared top-of-page navigation: always-visible links to every page plus
 * "Switch user." Replaces the old hamburger menu so navigation is one tap
 * instead of two. Renders as a header row on wide screens and a bottom
 * tab bar on narrow ones (CSS decides which shows); the current page is
 * auto-highlighted from the router location.
 *
 * USED BY: every page (CollectionPage, OwnedPage, BulkAddPage,
 *   BinderShelfPage, BinderViewPage, AnalyzerPage, ConventionModePage)
 */

import { Link, useLocation } from 'react-router-dom'
import { useUser } from '../context/UserContext'

interface NavItem { to: string; label: string }

const ITEMS: NavItem[] = [
  { to: '/',           label: '🗂 Sets' },
  { to: '/owned',      label: '📦 My Collection' },
  { to: '/bulk',       label: '⚡ Bulk Add' },
  { to: '/shelf',      label: '📒 Binders' },
  { to: '/analyzer',   label: '⚖️ Analyzer' },
  { to: '/convention', label: '🎪 Convention' },
]

export function HeaderNav() {
  const { pathname } = useLocation()
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
          // "🗂 Sets" -> icon "🗂" + label "Sets", so the tab shows a big
          // icon with a small label under it.
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
