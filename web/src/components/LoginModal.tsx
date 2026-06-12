import { useState } from 'react'
import { Modal } from './Modal'
import { getUserByUsername, registerUser } from '../api/users'
import { useUser } from '../context/UserContext'

interface Props {
  open: boolean
  onClose: () => void
}

export function LoginModal({ open, onClose }: Props) {
  const { setUser } = useUser()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!username.trim()) return
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const user = await getUserByUsername(username.trim())
        setUser(user)
        onClose()
      } else {
        if (!email.trim()) { setError('Email is required'); setLoading(false); return }
        const user = await registerUser(username.trim(), email.trim())
        setUser(user)
        onClose()
      }
    } catch (e: any) {
      const status = e?.response?.status
      if (status === 404) setError('Username not found')
      else if (status === 409) setError('Username or email already taken')
      else setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === 'login' ? 'Sign In' : 'Create Account'}>
      <div className="flex flex-col gap-4">
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError('') }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === m ? 'bg-[#ffcb05] text-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Username"
          className="w-full bg-[#13111e] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#ffcb05]/50"
        />

        {mode === 'register' && (
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Email"
            type="email"
            className="w-full bg-[#13111e] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#ffcb05]/50"
          />
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={submit}
          disabled={loading}
          className="w-full bg-[#ffcb05] hover:bg-yellow-400 text-black font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </div>
    </Modal>
  )
}
