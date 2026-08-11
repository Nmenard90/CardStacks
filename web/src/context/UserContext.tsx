/**
 * UserContext — tracks the signed-in collector and makes it available to
 * every page without prop-drilling.
 *
 * HOW IT WORKS
 *   Supabase Auth owns the actual session (and the password) — this
 *   context just mirrors it. On mount, and on every Supabase auth state
 *   change (sign in, sign out, token refresh), it calls GET /api/auth/me
 *   with the current access token; the backend verifies that token and
 *   returns (creating on first sign-in) this collector's profile row.
 *   `user` is null whenever there is no active Supabase session.
 *
 * USED BY: App.tsx (wraps the whole app), every page via useUser()
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMe } from '../api/users'
import type { User } from '../types'

interface UserContextValue {
  user: User | null
  /** True until the initial session check (and, if signed in, the
   *  follow-up profile fetch) finishes — lets LoginScreen avoid flashing
   *  the sign-in form for someone who's actually already logged in. */
  loading: boolean
  /** Pass null to sign out. Pass a User only to update the cached profile
   *  locally (e.g. after an edit) — sign-in itself is handled entirely by
   *  Supabase; this context picks the new session up on its own. */
  setUser: (user: User | null) => void
}

const UserContext = createContext<UserContextValue>({ user: null, loading: true, setUser: () => {} })

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const syncProfile = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        if (!cancelled) { setUserState(null); setLoading(false) }
        return
      }
      try {
        const profile = await fetchMe()
        if (!cancelled) setUserState(profile)
      } catch {
        if (!cancelled) setUserState(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    syncProfile()

    const { data: subscription } = supabase.auth.onAuthStateChange(() => { syncProfile() })
    return () => { cancelled = true; subscription.subscription.unsubscribe() }
  }, [])

  const setUser = (u: User | null) => {
    if (u === null) {
      setUserState(null)
      supabase.auth.signOut()
    } else {
      setUserState(u)
    }
  }

  return <UserContext.Provider value={{ user, loading, setUser }}>{children}</UserContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUser = () => useContext(UserContext)
