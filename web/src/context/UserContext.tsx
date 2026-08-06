/**
 * UserContext — tracks which user is "logged in" and makes it available
 * to every page without prop-drilling.
 *
 * HOW IT WORKS
 *   There are no real passwords — logging in just means picking a name
 *   (see LoginScreen.tsx). The logged-in user is persisted to
 *   localStorage so it survives a page refresh.
 *
 * USED BY: App.tsx (wraps the whole app), every page via useUser()
 */

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { User } from '../types'

interface UserContextValue {
  user: User | null
  setUser: (user: User | null) => void
}

// "Nobody logged in" — used only if a component reads this without a Provider above it.
const UserContext = createContext<UserContextValue>({ user: null, setUser: () => {} })

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('poketracker_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const setUser = (u: User | null) => {
    setUserState(u)
    if (u) localStorage.setItem('poketracker_user', JSON.stringify(u))
    else localStorage.removeItem('poketracker_user')
  }

  return <UserContext.Provider value={{ user, setUser }}>{children}</UserContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUser = () => useContext(UserContext)
