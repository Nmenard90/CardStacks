/**
 * Global bottom-right toast notification (ported from the old app). One
 * shared instance app-wide — each call to `toast(...)` replaces whatever
 * message is currently showing rather than queueing.
 *
 * USED BY: every page, via useToast()
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

// Default no-op guards against a page calling useToast() outside of ToastProvider.
const ToastContext = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)

  // Tracks the pending auto-hide timer so a new toast can cancel a
  // still-running one instead of both racing to hide/show.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toast = useCallback((m: string) => {
    setMsg(m)
    setShow(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShow(false), 2200)
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={'toast' + (show ? ' show' : '')}>{msg}</div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext)
