/**
 * FILE: NavMenu.tsx
 * LOCATION: src/components/NavMenu.tsx
 *
 * PURPOSE:
 *   Hamburger-style navigation dropdown used in every page header.
 *   Replaces the long row of nav links that overflowed off-screen.
 *
 * USED BY: CollectionPage, BulkAddPage
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../context/UserContext'

const STYLE = `
.nav-menu { position: relative; }
.nav-dropdown {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 100;
  min-width: 190px; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: 0 8px 28px rgba(0,0,0,.55); overflow: hidden;
}
.nav-item {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 11px 15px;
  text-align: left; text-decoration: none; color: var(--text); font-size: 14px;
  cursor: pointer; background: transparent; border: 0;
  border-bottom: 1px solid var(--border); font-family: inherit;
}
.nav-item:last-child { border-bottom: 0; }
.nav-item:hover { background: rgba(255,255,255,.07); }
.nav-item.active { color: var(--accent); font-weight: 700; }
`

interface Props {
  current: string
}

export function NavMenu({ current }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { setUser } = useUser()

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const close = () => setOpen(false)

  return (
    <div className="nav-menu" ref={ref}>
      <style>{STYLE}</style>
      <button className="tb-btn" onClick={() => setOpen(o => !o)} style={{ whiteSpace: 'nowrap' }}>
        ☰ Menu
      </button>
      {open && (
        <div className="nav-dropdown">
          <Link to="/" className={'nav-item' + (current === '/' ? ' active' : '')} onClick={close}>
            🗂 Collection
          </Link>
          <Link to="/bulk" className={'nav-item' + (current === '/bulk' ? ' active' : '')} onClick={close}>
            ⚡ Bulk Add
          </Link>
          <Link to="/shelf" className={'nav-item' + (current === '/shelf' ? ' active' : '')} onClick={close}>
            📒 Binders
          </Link>
          <Link to="/analyzer" className={'nav-item' + (current === '/analyzer' ? ' active' : '')} onClick={close}>
            ⚖️ Analyzer
          </Link>
          <Link to="/convention" className={'nav-item' + (current === '/convention' ? ' active' : '')} onClick={close}>
            🎪 Convention
          </Link>
          <button className="nav-item" onClick={() => { setUser(null); close() }}>
            👤 Switch User
          </button>
        </div>
      )}
    </div>
  )
}
