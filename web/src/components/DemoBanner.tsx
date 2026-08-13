/**
 * DemoBanner — thin, dismiss-free strip shown while a "try the demo"
 * (Supabase anonymous-auth) session is active, on every page. Renders
 * nothing for a real account or a signed-out visitor.
 *
 * USED BY: App.tsx (mounted once, above the router)
 */

import { useUser } from '../context/UserContext'

export function DemoBanner() {
  const { user, setUser } = useUser()
  if (!user?.isAnonymous) return null

  return (
    <div className="demo-banner">
      <span>You're in demo mode — this account and its data are cleared after 24 hours.</span>
      <button type="button" onClick={() => setUser(null)}>Sign out</button>
    </div>
  )
}
