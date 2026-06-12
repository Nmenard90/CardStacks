import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { LoginModal } from './LoginModal'

interface Props {
  children: ReactNode
}

const navLinks = [
  { to: '/', label: '🃏 Collection' },
  { to: '/binders', label: '📚 Binders' },
  { to: '/analyzer', label: '⚖️ Analyzer' },
  { to: '/search', label: '🔍 Search' },
]

export function Layout({ children }: Props) {
  const { user, setUser } = useUser()
  const location = useLocation()
  const [loginOpen, setLoginOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#0f0f11] text-white">
      {/* Top nav */}
      <header className="sticky top-0 z-40 h-[52px] bg-[#13111e]/90 backdrop-blur border-b border-white/[0.06] flex items-center px-4 gap-6">
        <span className="text-[#ffcb05] font-bold text-lg tracking-tight select-none">
          PokéTracker
        </span>

        <nav className="flex items-center gap-1">
          {navLinks.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                location.pathname === link.to
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-slate-400">
                👤 <span className="text-white font-medium">{user.username}</span>
              </span>
              <button
                onClick={() => setUser(null)}
                className="text-xs text-slate-500 hover:text-white transition-colors"
              >
                Switch
              </button>
            </>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              className="px-3 py-1.5 bg-[#ffcb05] hover:bg-yellow-400 text-black text-sm font-semibold rounded-lg transition-colors"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <main>{children}</main>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
