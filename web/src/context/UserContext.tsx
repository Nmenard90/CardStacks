import { createContext, useContext, useState, type ReactNode } from 'react'
import type { User } from '../types'

interface UserContextValue {
  user: User | null
  setUser: (user: User | null) => void
}

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

export const useUser = () => useContext(UserContext)
