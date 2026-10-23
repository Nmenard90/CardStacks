/**
 * Shared top-of-page navigation: always-visible links to every page plus
 * "Log out." Replaces the old hamburger menu so navigation is one tap
 * instead of two. Renders as a header row on wide screens and a bottom
 * tab bar on narrow ones (CSS decides which shows); the current page is
 * auto-highlighted from the router location.
 *
 * "Tools" isn't a page of its own — it's a dropdown grouping every
 * single-purpose utility page (Trade Analyzer, Convention Mode) under one
 * nav slot instead of each getting its own top-level link.
 *
 * USED BY: every page (CollectionPage, OwnedPage, BulkAddPage,
 *   ShelfPage, BinderViewPage, AnalyzerPage, ConventionModePage)
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useUser } from '../context/UserContext'
import { getUnreadOffers } from '../api/trading'
import { getGames } from '../api/cards'
import { DEFAULT_GAME, currentGame, switchGame } from '../lib/game'

interface NavItem { to: string; label: string }

const ITEMS: NavItem[] = [
  { to: '/',                   label: '🏠 Spaces' },
  { to: '/explore',            label: '🗂 Explore' },
  { to: '/add',                label: '⚡ Add Cards' },
  { to: '/trade',              label: '🤝 Trade' },
]

/** Offers with activity the user hasn't seen — shown as a badge on Trade.
 *  Polls once a minute; demo accounts can't trade, so they never ask. */
function useUnreadOffers(): number {
  const { user } = useUser()
  const { data = 0 } = useQuery({
    queryKey: ['unread-offers', user?.id],
    queryFn: () => getUnreadOffers(user!.id),
    enabled: !!user && !user.isAnonymous,
    refetchInterval: 60_000,
    retry: false,
  })
  return data
}

const TOOLS_ITEMS: NavItem[] = [
  { to: '/analyzer',           label: '🧪 Trade Analyzer' },
  { to: '/convention',         label: '🎪 Convention Mode' },
  { to: '/shop/requests',      label: '🛍 My Shop' },
]

/** Shared by both the desktop row and the mobile bottom bar — only the
 *  trigger's own className/children differ between the two. */
function ToolsMenu({ triggerClassName, trigger, menuClassName }: {
  triggerClassName: string; trigger: React.ReactNode; menuClassName: string
}) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const isActive = TOOLS_ITEMS.some(i => i.to === pathname)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  return (
    <div className="tools-menu" ref={wrap}>
      <button
        type="button"
        className={triggerClassName + (isActive ? ' active' : '') + (open ? ' open' : '')}
        onClick={() => setOpen(o => !o)}
      >
        {trigger}
      </button>
      <div className={menuClassName + (open ? ' open' : '')}>
        {TOOLS_ITEMS.map(item => (
          <Link key={item.to} to={item.to} className={'tools-menu-item' + (pathname === item.to ? ' active' : '')} onClick={() => setOpen(false)}>
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Which card game the app shows. Each game is its own world (collection,
 *  Spaces, trades), so switching reloads into that game. Hidden while only
 *  one game is enabled. */
function GameSwitcher() {
  const { data: games = [] } = useQuery({ queryKey: ['games'], queryFn: getGames, staleTime: 60 * 60 * 1000 })
  const game = currentGame()
  // A remembered game that's since been disabled falls back to the default.
  useEffect(() => {
    if (games.length > 0 && game !== DEFAULT_GAME && !games.some(g => g.id === game)) switchGame(DEFAULT_GAME)
  }, [games, game])
  if (games.length < 2) return null
  return (
    <select className="game-switch" value={game} onChange={e => switchGame(e.target.value)} aria-label="Card game">
      {games.map(g => <option key={g.id} value={g.id}>{g.shortName}</option>)}
    </select>
  )
}

export function HeaderNav() {
  const { pathname } = useLocation()
  const { setUser } = useUser()
  const unread = useUnreadOffers()
  const badge = (to: string) => (to === '/trade' && unread > 0 ? <span className="nav-badge">{unread}</span> : null)

  return (
    <>
      <div className="app-nav">
        <GameSwitcher />
        {ITEMS.map(item => (
          <Link
            key={item.to}
            to={item.to}
            className={'nav-link' + (pathname === item.to || (item.to === '/' && pathname.startsWith('/spaces/')) ? ' active' : '')}
          >
            {item.label}{badge(item.to)}
          </Link>
        ))}
        <ToolsMenu
          triggerClassName="nav-link tools-trigger"
          trigger={<>🧰 Tools <span className="tools-chevron">▾</span></>}
          menuClassName="tools-dropdown"
        />
        <button className="nav-link switch-user" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>
          Log out
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
              className={'bottom-nav-link' + (pathname === item.to || (item.to === '/' && pathname.startsWith('/spaces/')) ? ' active' : '')}
            >
              <span className="bnl-icon">{icon}</span>
              <span className="bnl-label">{rest.join(' ')}</span>
              {badge(item.to)}
            </Link>
          )
        })}
        <ToolsMenu
          triggerClassName="bottom-nav-link tools-trigger"
          trigger={<><span className="bnl-icon">🧰</span><span className="bnl-label">Tools</span></>}
          menuClassName="tools-dropdown tools-dropdown-up"
        />
      </nav>
    </>
  )
}
