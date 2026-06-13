/**
 * FILE: Toast.tsx — the little bottom-right notification from the old app.
 * One global toast; each call replaces the previous message.
 * USED BY: every page, via useToast()
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

const ToastContext = createContext<(msg: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)
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

// Hook exported beside its provider on purpose — they are one unit.
// Only HMR fast-refresh granularity is affected.
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext)
